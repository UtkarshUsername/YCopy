const DB_NAME = 'clip-vault';
const STORE = 'items';
const DB_VERSION = 1;

const form = document.getElementById('add-form');
const list = document.getElementById('items');
const emptyState = document.getElementById('empty-state');
const clearAllButton = document.getElementById('clear-all');
const searchInput = document.getElementById('search');
const toast = document.getElementById('toast');
const fab = document.getElementById('fab');
const modalOverlay = document.getElementById('modal-overlay');
const modalClose = document.getElementById('modal-close');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');
const headerDefault = document.getElementById('header-default');
const headerSelection = document.getElementById('header-selection');
const selectionCount = document.getElementById('selection-count');
const selectionClose = document.getElementById('selection-close');
const selectionPin = document.getElementById('selection-pin');
const selectionCopy = document.getElementById('selection-copy');
const selectionDelete = document.getElementById('selection-delete');

let activeObjectUrls = [];
let itemsById = new Map();
let allItems = [];
let currentSearchQuery = '';
let fuseIndex = null;
let selectedIds = new Set();
let selectionMode = false;
let longPressTimer = null;
const LONG_PRESS_MS = 500;

const MAX_TEXT_LENGTH = 320;
const MAX_URL_LENGTH = 88;
const MAX_FILE_NAME_LENGTH = 56;
const EMPTY_STATE_TEXT = emptyState.textContent;

function escapeHtml(value = '') {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function truncateText(value = '', maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function truncateMiddle(value = '', maxLength) {
  if (value.length <= maxLength) return value;
  const sideLength = Math.max(1, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, sideLength)}…${value.slice(-sideLength)}`;
}

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

async function addItem(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getItems() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deleteItem(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function updateItem(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearItems() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function clearObjectUrls() {
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  activeObjectUrls = [];
}

function buildFilePreview(files = []) {
  if (!files.length) return '';

  const parts = files
    .map((file) => {
      if (!file) return '';
      const fileName = file.name || 'file';
      const safeFileName = escapeHtml(fileName);
      const shortFileName = escapeHtml(truncateMiddle(fileName, MAX_FILE_NAME_LENGTH));
      const safeFileType = escapeHtml(file.type || 'unknown');
      if (file.blob) {
        const url = URL.createObjectURL(file.blob);
        activeObjectUrls.push(url);
        if (file.type?.startsWith('image/')) {
          return `
            <figure class="file-item">
              <img src="${url}" alt="${safeFileName}" loading="lazy" class="img-preview" data-full="${url}" />
              <figcaption title="${safeFileName}">${shortFileName}</figcaption>
            </figure>
          `;
        }
        return `
          <div class="file-item">
            <a href="${url}" download="${safeFileName}" title="${safeFileName}">${shortFileName}</a>
            <small>${safeFileType}</small>
          </div>
        `;
      }
      return `
        <div class="file-item">
          <span title="${safeFileName}">${shortFileName}</span>
          <small>${safeFileType}</small>
        </div>
      `;
    })
    .join('');

  return `<div class="file-preview">${parts}</div>`;
}

async function copyToClipboard(value) {
  if (!navigator.clipboard) {
    showToast('Clipboard not available');
    return;
  }
  await navigator.clipboard.writeText(value);
  showToast('Copied to clipboard');
}

async function copyImageToClipboard(blob) {
  if (!navigator.clipboard?.write) {
    showToast('Image copy not supported');
    return;
  }
  const type = blob.type === 'image/png' ? 'image/png' : 'image/png';
  let pngBlob = blob;
  if (blob.type !== 'image/png') {
    pngBlob = await convertToPngBlob(blob);
  }
  await navigator.clipboard.write([new ClipboardItem({ [type]: pngBlob })]);
  showToast('Image copied to clipboard');
}

function convertToPngBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob((pngBlob) => {
        URL.revokeObjectURL(img.src);
        pngBlob ? resolve(pngBlob) : reject(new Error('PNG conversion failed'));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Image load failed'));
    };
    img.src = URL.createObjectURL(blob);
  });
}

function buildClipboardText(item) {
  const parts = [];
  if (item.text) parts.push(item.text);
  if (item.url) parts.push(item.url);
  return parts.join('\n');
}

function getPinnedTimestamp(item) {
  return Number.isFinite(item?.pinnedAt) ? item.pinnedAt : 0;
}

function isItemPinned(item) {
  return getPinnedTimestamp(item) > 0;
}

function sortItemsForDisplay(items = []) {
  return [...items].sort((a, b) => {
    const aPinnedAt = getPinnedTimestamp(a);
    const bPinnedAt = getPinnedTimestamp(b);
    const aPinned = aPinnedAt > 0;
    const bPinned = bPinnedAt > 0;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    if (aPinned && bPinned && aPinnedAt !== bPinnedAt) return bPinnedAt - aPinnedAt;
    return b.createdAt - a.createdAt;
  });
}

function rebuildSearchIndex(items = []) {
  if (typeof window.Fuse !== 'function') {
    fuseIndex = null;
    return;
  }

  fuseIndex = new window.Fuse(items, {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.35,
    minMatchCharLength: 2,
    keys: [
      { name: 'text', weight: 0.45 },
      { name: 'url', weight: 0.35 },
      { name: 'files.name', weight: 0.15 },
      { name: 'files.type', weight: 0.05 },
    ],
  });
}

function filterItems(items = [], query = '') {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return items;

  if (fuseIndex) {
    return fuseIndex.search(normalizedQuery).map((result) => result.item);
  }

  const needle = normalizedQuery.toLowerCase();
  return items.filter((item) => {
    const fileText = (item.files || [])
      .map((file) => `${file?.name || ''} ${file?.type || ''}`)
      .join(' ');
    const haystack = `${item.text || ''}\n${item.url || ''}\n${fileText}`.toLowerCase();
    return haystack.includes(needle);
  });
}

function enterSelectionMode(id) {
  selectionMode = true;
  selectedIds.clear();
  selectedIds.add(id);
  updateSelectionUI();
}

function exitSelectionMode() {
  selectionMode = false;
  selectedIds.clear();
  updateSelectionUI();
  document.querySelectorAll('.item.item-selected').forEach((el) => el.classList.remove('item-selected'));
}

function toggleSelection(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  if (selectedIds.size === 0) {
    exitSelectionMode();
    return;
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  headerDefault.hidden = selectionMode;
  headerSelection.hidden = !selectionMode;
  selectionCount.textContent = selectedIds.size;
  document.querySelectorAll('.item[data-item-id]').forEach((el) => {
    const id = Number(el.dataset.itemId);
    el.classList.toggle('item-selected', selectedIds.has(id));
  });
}

function updateClearAllVisibility() {
  clearAllButton.style.display = (allItems.length === 0 || currentSearchQuery.trim()) ? 'none' : '';
}

async function copyItemToClipboard(item) {
  const clipboardText = buildClipboardText(item);
  if (clipboardText) {
    await copyToClipboard(clipboardText);
  } else {
    const imageFile = item.files?.find((f) => f?.type?.startsWith('image/') && f.blob);
    if (imageFile) {
      await copyImageToClipboard(imageFile.blob);
    }
  }
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function renderItems(items, query = '') {
  clearObjectUrls();
  list.innerHTML = '';
  const sortedItems = sortItemsForDisplay(items);
  itemsById = new Map(sortedItems.map((item) => [item.id, item]));

  if (!sortedItems.length) {
    emptyState.style.display = 'block';
    if (query.trim()) {
      emptyState.textContent = `No clips match "${truncateText(query.trim(), 48)}".`;
    } else {
      emptyState.textContent = EMPTY_STATE_TEXT;
    }
    updateClearAllVisibility();
    return;
  }
  emptyState.style.display = 'none';
  emptyState.textContent = EMPTY_STATE_TEXT;
  updateClearAllVisibility();

  sortedItems.forEach((item) => {
    const pinned = isItemPinned(item);
    const li = document.createElement('li');
    li.className = `item${pinned ? ' item-pinned' : ''}${selectedIds.has(item.id) ? ' item-selected' : ''}`;
    li.dataset.itemId = item.id;
    const safeText = item.text
      ? escapeHtml(truncateText(item.text, MAX_TEXT_LENGTH))
      : '';
    const safeTextFull = item.text ? escapeHtml(item.text) : '';
    const safeUrl = item.url ? escapeHtml(item.url) : '';
    const safeUrlLabel = item.url
      ? escapeHtml(truncateMiddle(item.url, MAX_URL_LENGTH))
      : '';
    li.innerHTML = `
        <div>
          <small>${pinned ? '📌 · ' : ''}${formatDate(item.createdAt)}</small>
        </div>
        ${item.text ? `<p class="item-text" title="${safeTextFull}">${safeText}</p>` : ''}
        ${item.url ? `<a class="item-link" href="${safeUrl}" target="_blank" rel="noopener" title="${safeUrl}">${safeUrlLabel}</a>` : ''}
        ${buildFilePreview(item.files)}
      `;

    // Long press to enter selection mode
    let pressStarted = false;
    const startLongPress = (e) => {
      // Don't interfere with links or images
      if (e.target.closest('a, .img-preview')) return;
      pressStarted = true;
      cancelLongPress();
      longPressTimer = setTimeout(() => {
        pressStarted = false;
        if (!selectionMode) {
          enterSelectionMode(item.id);
        } else {
          toggleSelection(item.id);
        }
        // Vibrate on supported devices
        if (navigator.vibrate) navigator.vibrate(30);
      }, LONG_PRESS_MS);
    };

    const endPress = (e) => {
      cancelLongPress();
      if (!pressStarted) return;
      pressStarted = false;
      // Don't handle taps on links or images
      if (e.target.closest('a, .img-preview')) return;
      if (selectionMode) {
        toggleSelection(item.id);
      } else {
        copyItemToClipboard(item);
      }
    };

    const cancelPress = () => {
      cancelLongPress();
      pressStarted = false;
    };

    // Touch events
    li.addEventListener('touchstart', startLongPress, { passive: true });
    li.addEventListener('touchend', (e) => { endPress(e); });
    li.addEventListener('touchmove', cancelPress, { passive: true });
    li.addEventListener('touchcancel', cancelPress);

    // Mouse events for desktop
    li.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      startLongPress(e);
    });
    li.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      endPress(e);
    });
    li.addEventListener('mouseleave', cancelPress);

    // Prevent context menu on long press
    li.addEventListener('contextmenu', (e) => {
      if (selectionMode) e.preventDefault();
    });

    list.appendChild(li);
  });
}

function renderFilteredItems() {
  const filteredItems = filterItems(allItems, currentSearchQuery);
  renderItems(filteredItems, currentSearchQuery);
}

async function loadItems() {
  const items = await getItems();
  allItems = items;
  rebuildSearchIndex(allItems);
  renderFilteredItems();
  return items;
}

function clearSharedParamsFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('shared');
  url.searchParams.delete('sharedId');
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, '', nextUrl);
}

function getLatestItem(items = []) {
  return items.reduce((latest, item) => {
    if (!latest) return item;
    return item.createdAt > latest.createdAt ? item : latest;
  }, null);
}

async function handleSharedContent(items) {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('shared')) return;

  const sharedId = Number(params.get('sharedId'));
  const sharedItem = Number.isInteger(sharedId)
    ? (items.find((item) => item.id === sharedId) || getLatestItem(items))
    : getLatestItem(items);
  const clipboardText = sharedItem ? buildClipboardText(sharedItem) : '';

  if (!navigator.clipboard) {
    showToast('Shared content saved (clipboard unavailable)');
    clearSharedParamsFromUrl();
    return;
  }

  if (clipboardText) {
    try {
      await navigator.clipboard.writeText(clipboardText);
      showToast('Shared content saved and copied');
    } catch {
      showToast('Shared content saved (clipboard blocked)');
    }
  } else {
    const imageFile = sharedItem?.files?.find((f) => f?.type?.startsWith('image/') && f.blob);
    if (imageFile) {
      try {
        await copyImageToClipboard(imageFile.blob);
        showToast('Shared image saved and copied');
      } catch {
        showToast('Shared image saved (clipboard blocked)');
      }
    } else {
      showToast('Shared content saved');
    }
  }

  clearSharedParamsFromUrl();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const text = data.get('text')?.toString().trim();
  const url = data.get('url')?.toString().trim();

  if (!text && !url) {
    showToast('Add at least one field');
    return;
  }

  await addItem({
    text,
    url,
    createdAt: Date.now(),
    files: [],
    pinnedAt: null,
  });
  form.reset();
  modalOverlay.hidden = true;
  await loadItems();
  showToast('Saved clip');
});

fab.addEventListener('click', () => {
  modalOverlay.hidden = false;
  form.querySelector('input, textarea').focus();
});

modalClose.addEventListener('click', () => {
  modalOverlay.hidden = true;
});

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) modalOverlay.hidden = true;
});

list.addEventListener('click', (e) => {
  const img = e.target.closest('.img-preview');
  if (!img) return;
  lightboxImg.src = img.dataset.full;
  lightbox.hidden = false;
});

lightboxClose.addEventListener('click', () => {
  lightbox.hidden = true;
  lightboxImg.src = '';
});

lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) {
    lightbox.hidden = true;
    lightboxImg.src = '';
  }
});

// Selection header actions
selectionClose.addEventListener('click', exitSelectionMode);

selectionPin.addEventListener('click', async () => {
  const ids = [...selectedIds];
  for (const id of ids) {
    const item = itemsById.get(id);
    if (!item) continue;
    const pinned = isItemPinned(item);
    await updateItem({ ...item, pinnedAt: pinned ? null : Date.now() });
  }
  const count = ids.length;
  exitSelectionMode();
  await loadItems();
  showToast(count === 1 ? 'Toggled pin' : `Toggled pin for ${count} clips`);
});

selectionCopy.addEventListener('click', async () => {
  const ids = [...selectedIds];
  const texts = [];
  for (const id of ids) {
    const item = itemsById.get(id);
    if (!item) continue;
    const t = buildClipboardText(item);
    if (t) texts.push(t);
  }
  if (texts.length) {
    await copyToClipboard(texts.join('\n\n'));
  }
  exitSelectionMode();
});

selectionDelete.addEventListener('click', async () => {
  const ids = [...selectedIds];
  const count = ids.length;
  const shouldDelete = window.confirm(`Delete ${count} clip${count > 1 ? 's' : ''}?`);
  if (!shouldDelete) return;
  for (const id of ids) {
    await deleteItem(id);
  }
  exitSelectionMode();
  await loadItems();
  showToast(`Deleted ${count} clip${count > 1 ? 's' : ''}`);
});

clearAllButton.addEventListener('click', async () => {
  const shouldClear = window.confirm('Clear all saved clips? This cannot be undone.');
  if (!shouldClear) return;

  await clearItems();
  await loadItems();
  showToast('Cleared all clips');
});

if (searchInput) {
  searchInput.addEventListener('input', () => {
    currentSearchQuery = searchInput.value;
    renderFilteredItems();
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then((registration) => registration.update())
    .catch(() => {});
}

async function init() {
  const items = await loadItems();
  await handleSharedContent(items);
}

init();
