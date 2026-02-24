const DB_NAME = 'clip-vault';
const STORE = 'items';
const DB_VERSION = 1;

const form = document.getElementById('add-form');
const list = document.getElementById('items');
const emptyState = document.getElementById('empty-state');
const refreshButton = document.getElementById('refresh');
const clearAllButton = document.getElementById('clear-all');
const toast = document.getElementById('toast');
const fab = document.getElementById('fab');
const modalOverlay = document.getElementById('modal-overlay');
const modalClose = document.getElementById('modal-close');

let activeObjectUrls = [];
let itemsById = new Map();

const MAX_TEXT_LENGTH = 320;
const MAX_URL_LENGTH = 88;
const MAX_FILE_NAME_LENGTH = 56;

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
              <img src="${url}" alt="${safeFileName}" loading="lazy" />
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

function buildClipboardText(item) {
  const parts = [];
  if (item.text) parts.push(item.text);
  if (item.url) parts.push(item.url);
  return parts.join('\n');
}

function renderItems(items) {
  clearObjectUrls();
  list.innerHTML = '';
  itemsById = new Map(items.map((item) => [item.id, item]));

  if (!items.length) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';
  items
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach((item) => {
      const li = document.createElement('li');
      li.className = 'item';
      const displayTitle = item.text
        ? truncateText(item.text, MAX_TEXT_LENGTH)
        : item.url
          ? truncateMiddle(item.url, MAX_URL_LENGTH)
          : item.files?.length
            ? (item.files.length === 1 ? item.files[0]?.name || '1 file' : `${item.files.length} files`)
            : 'Saved clip';
      const safeTitle = escapeHtml(displayTitle);
      const safeTitleFull = escapeHtml(displayTitle);
      const safeText = item.text
        ? escapeHtml(truncateText(item.text, MAX_TEXT_LENGTH))
        : '';
      const safeTextFull = item.text ? escapeHtml(item.text) : '';
      const safeUrl = item.url ? escapeHtml(item.url) : '';
      const safeUrlLabel = item.url
        ? escapeHtml(truncateMiddle(item.url, MAX_URL_LENGTH))
        : '';
      const copyButton = item.text || item.url
        ? `<button data-id="${item.id}" data-action="copy" class="ghost">Copy</button>`
        : '';
      li.innerHTML = `
        <div>
          <h3 title="${safeTitleFull}">${safeTitle}</h3>
          <small>${formatDate(item.createdAt)}</small>
        </div>
        ${item.text ? `<p class="item-text" title="${safeTextFull}">${safeText}</p>` : ''}
        ${item.url ? `<a class="item-link" href="${safeUrl}" target="_blank" rel="noopener" title="${safeUrl}">${safeUrlLabel}</a>` : ''}
        ${buildFilePreview(item.files)}
        <div class="actions">
          ${copyButton}
          <button data-id="${item.id}" data-action="delete" class="ghost">Delete</button>
        </div>
      `;
      list.appendChild(li);
    });

  list.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = itemsById.get(Number(button.dataset.id));
      if (!item) return;
      switch (button.dataset.action) {
        case 'delete':
          await deleteItem(item.id);
          await loadItems();
          showToast('Deleted clip');
          break;
        case 'copy': {
          const clipboardText = buildClipboardText(item);
          if (clipboardText) {
            await copyToClipboard(clipboardText);
          }
          break;
        }
        default:
          break;
      }
    });
  });
}

async function loadItems() {
  const items = await getItems();
  renderItems(items);
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

refreshButton.addEventListener('click', loadItems);
clearAllButton.addEventListener('click', async () => {
  const shouldClear = window.confirm('Clear all saved clips? This cannot be undone.');
  if (!shouldClear) return;

  await clearItems();
  await loadItems();
  showToast('Cleared all clips');
});

if (new URLSearchParams(window.location.search).get('shared')) {
  showToast('Shared content saved');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then((registration) => registration.update())
    .catch(() => {});
}

loadItems();
