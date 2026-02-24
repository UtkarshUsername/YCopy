// Bump this value on every production deploy.
// The cache name is derived from this constant so it updates automatically.
const CACHE_VERSION = 'v9';
const CACHE_PREFIX = 'ycopy-static';
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;

// Core app shell assets needed for first paint/offline boot.
const CORE_ASSETS = [
  '.',
  'index.html',
  'share.html',
  'styles.css',
  'app.js',
  'fuse.min.js',
  'manifest.json',
  'icon.svg',
];

const DB_NAME = 'clip-vault';
const STORE = 'items';
const DB_VERSION = 1;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Pre-cache core assets for reliable startup.
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);

    // Activate the new worker as soon as install completes.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Remove all prior app caches so users do not keep stale bundles.
    const keys = await caches.keys();
    const oldKeys = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
    await Promise.all(oldKeys.map((key) => caches.delete(key)));

    // Start controlling all open tabs immediately.
    await self.clients.claim();
  })());
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveShare(formData) {
  const text = formData.get('text')?.toString().trim();
  const url = formData.get('url')?.toString().trim();
  const files = formData.getAll('files').map((file) => ({
    name: file.name,
    type: file.type,
    blob: file,
  }));
  const createdAt = Date.now();

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const request = tx.objectStore(STORE).add({
      text,
      url,
      files,
      createdAt,
      pinnedAt: null,
    });
    tx.oncomplete = () => {
      resolve({
        id: Number(request.result),
        createdAt,
      });
    };
    tx.onerror = () => reject(tx.error);
  });
}

function isCacheableResponse(response) {
  return Boolean(response) && (response.ok || response.type === 'opaque');
}

function isHtmlRequest(request, url) {
  if (request.mode === 'navigate' || request.destination === 'document') {
    return true;
  }
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html') || url.pathname.endsWith('.html');
}

function isStaticAssetRequest(request, url) {
  if (request.destination === 'style' || request.destination === 'script') return true;
  if (request.destination === 'image' || request.destination === 'font') return true;
  return (
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.gif') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2')
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('Network unavailable and no cached HTML response found.');
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.endsWith('/share.html') && event.request.method === 'POST') {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const savedItem = await saveShare(formData);
        const redirectUrl = new URL('index.html', self.registration.scope);
        redirectUrl.searchParams.set('shared', '1');
        if (Number.isFinite(savedItem?.id)) {
          redirectUrl.searchParams.set('sharedId', String(savedItem.id));
        }
        return Response.redirect(redirectUrl.toString(), 303);
      })()
    );
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  // Only apply app caching strategies for same-origin requests.
  if (url.origin !== self.location.origin) {
    return;
  }

  if (isHtmlRequest(event.request, url)) {
    // HTML is network-first so deploys are picked up immediately.
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (isStaticAssetRequest(event.request, url)) {
    // Static assets are cache-first for speed and offline resilience.
    event.respondWith(cacheFirst(event.request));
  }
});
