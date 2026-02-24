const CACHE_NAME = 'ycopy-static-v5';
const STATIC_ASSETS = [
  '.',
  'index.html',
  'share.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'icon.svg',
];

const DB_NAME = 'clip-vault';
const STORE = 'items';
const DB_VERSION = 1;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
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

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
