const DB_NAME = 'clip-vault';
const STORE = 'items';
const DB_VERSION = 1;

const form = document.getElementById('add-form');
const list = document.getElementById('items');
const emptyState = document.getElementById('empty-state');
const refreshButton = document.getElementById('refresh');
const clearAllButton = document.getElementById('clear-all');
const toast = document.getElementById('toast');

let activeObjectUrls = [];
let itemsById = new Map();

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
      if (file.blob) {
        const url = URL.createObjectURL(file.blob);
        activeObjectUrls.push(url);
        if (file.type?.startsWith('image/')) {
          return `
            <figure class="file-item">
              <img src="${url}" alt="${file.name}" loading="lazy" />
              <figcaption>${file.name}</figcaption>
            </figure>
          `;
        }
        return `
          <div class="file-item">
            <a href="${url}" download="${file.name}">${file.name}</a>
            <small>${file.type || 'unknown'}</small>
          </div>
        `;
      }
      return `
        <div class="file-item">
          <span>${file.name}</span>
          <small>${file.type || 'unknown'}</small>
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
      const copyTextButton = item.text
        ? `<button data-id="${item.id}" data-action="copy-text" class="ghost">Copy text</button>`
        : '';
      const copyUrlButton = item.url
        ? `<button data-id="${item.id}" data-action="copy-url" class="ghost">Copy link</button>`
        : '';
      li.innerHTML = `
        <div>
          <h3>${item.title || 'Untitled clip'}</h3>
          <small>${formatDate(item.createdAt)}</small>
        </div>
        ${item.text ? `<p>${item.text}</p>` : ''}
        ${item.url ? `<a href="${item.url}" target="_blank" rel="noopener">${item.url}</a>` : ''}
        ${buildFilePreview(item.files)}
        <div class="actions">
          ${copyTextButton}
          ${copyUrlButton}
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
        case 'copy-text':
          if (item.text) await copyToClipboard(item.text);
          break;
        case 'copy-url':
          if (item.url) await copyToClipboard(item.url);
          break;
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
  const title = data.get('title')?.toString().trim();
  const text = data.get('text')?.toString().trim();
  const url = data.get('url')?.toString().trim();

  if (!title && !text && !url) {
    showToast('Add at least one field');
    return;
  }

  await addItem({
    title,
    text,
    url,
    createdAt: Date.now(),
    files: [],
  });
  form.reset();
  await loadItems();
  showToast('Saved clip');
});

refreshButton.addEventListener('click', loadItems);
clearAllButton.addEventListener('click', async () => {
  await clearItems();
  await loadItems();
  showToast('Cleared all clips');
});

if (new URLSearchParams(window.location.search).get('shared')) {
  showToast('Shared content saved');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}

loadItems();
