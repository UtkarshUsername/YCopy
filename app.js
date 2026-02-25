const DB_NAME = 'clip-vault';
const STORE = 'items';
const DB_VERSION = 1;

const form = document.getElementById('add-form');
const list = document.getElementById('items');
const emptyState = document.getElementById('empty-state');
const clearAllButton = document.getElementById('clear-all');
const searchInput = document.getElementById('search');
const searchFilters = document.getElementById('search-filters');
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
const selectionShare = document.getElementById('selection-share');
const selectionDelete = document.getElementById('selection-delete');
const emptyStateDefault = emptyState?.querySelector('[data-empty-default]');
const emptyStateSearch = emptyState?.querySelector('[data-empty-search]');
const supportsNativeShare = typeof navigator.share === 'function';

let activeObjectUrls = [];
let itemsById = new Map();
let allItems = [];
let currentSearchQuery = '';
let currentSearchFilter = 'all';
let fuseIndex = null;
let selectedIds = new Set();
let selectionMode = false;
let longPressTimer = null;
let modalOpenCount = 0;
let lockedScrollY = 0;
let savedBodyPaddingRight = '';
const LONG_PRESS_MS = 500;

const MAX_TEXT_LENGTH = 320;
const MAX_URL_LENGTH = 88;
const MAX_FILE_NAME_LENGTH = 56;
const EMPTY_STATE_FALLBACK_TEXT = 'No clips yet. Tap + to add one or share to YCopy.';

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
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  let hourValue = date.getHours();
  const meridiem = hourValue >= 12 ? 'PM' : 'AM';
  hourValue = hourValue % 12 || 12;
  const hours = String(hourValue).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${day}/${month}/${year} ${hours}:${minutes} ${meridiem}`;
}

function lockBodyScroll() {
  if (modalOpenCount > 0) {
    modalOpenCount += 1;
    return;
  }

  lockedScrollY = window.scrollY || window.pageYOffset || 0;
  savedBodyPaddingRight = document.body.style.paddingRight;

  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) {
    const computedPaddingRight = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
  }

  document.body.style.top = `-${lockedScrollY}px`;
  document.body.classList.add('scroll-locked');
  modalOpenCount = 1;
}

function unlockBodyScroll() {
  if (modalOpenCount === 0) return;

  modalOpenCount -= 1;
  if (modalOpenCount > 0) return;

  document.body.classList.remove('scroll-locked');
  document.body.style.top = '';
  document.body.style.paddingRight = savedBodyPaddingRight;
  window.scrollTo(0, lockedScrollY);
  savedBodyPaddingRight = '';
  lockedScrollY = 0;
}

function openOverlay(overlay) {
  if (!overlay || !overlay.hidden) return;
  overlay.hidden = false;
  lockBodyScroll();
}

function closeOverlay(overlay) {
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  unlockBodyScroll();
}

function openAddModal() {
  openOverlay(modalOverlay);
  form.querySelector('input, textarea')?.focus();
}

function closeAddModal() {
  closeOverlay(modalOverlay);
}

function openLightbox(src) {
  lightboxImg.src = src;
  openOverlay(lightbox);
}

function closeLightbox() {
  closeOverlay(lightbox);
  lightboxImg.src = '';
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

function buildCombinedClipboardText(items = []) {
  return items
    .map((item) => buildClipboardText(item))
    .filter(Boolean)
    .join('\n\n');
}

function normalizeShareUrl(value = '') {
  if (!value) return '';
  try {
    return new URL(value).toString();
  } catch {
    return '';
  }
}

function createShareFiles(files = []) {
  return files
    .filter((file) => file?.blob)
    .map((file, index) => {
      const blob = file.blob;
      const type = file.type || blob.type || 'application/octet-stream';
      const name = file.name || `attachment-${index + 1}`;
      return new File([blob], name, { type, lastModified: Date.now() });
    });
}

async function shareItems(items = []) {
  if (!items.length || !navigator.share) return 'unsupported';

  const combinedText = buildCombinedClipboardText(items);
  const shareData = {
    title: items.length === 1 ? 'YCopy clip' : `${items.length} YCopy clips`,
  };

  if (combinedText) shareData.text = combinedText;

  if (items.length === 1) {
    const shareUrl = normalizeShareUrl(items[0]?.url || '');
    if (shareUrl) shareData.url = shareUrl;

    const shareFiles = createShareFiles(items[0]?.files || []);
    if (shareFiles.length && navigator.canShare?.({ files: shareFiles })) {
      shareData.files = shareFiles;
    }
  }

  const hasPayload = Boolean(shareData.text || shareData.url || (shareData.files && shareData.files.length));
  if (!hasPayload) return 'unsupported';

  try {
    await navigator.share(shareData);
    return 'shared';
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled';
    return 'unsupported';
  }
}

async function copyForShareFallback(text) {
  if (!text) return 'empty';
  if (!navigator.clipboard) {
    showToast('Sharing unavailable on this device');
    return 'unavailable';
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Sharing unavailable, copied instead');
    return 'copied';
  } catch {
    showToast('Sharing unavailable');
    return 'unavailable';
  }
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

function isAllFilterActive(filter) {
  return !filter || filter === 'all';
}

function itemMatchesSearchFilter(item, filter) {
  if (isAllFilterActive(filter)) return true;
  const hasText = Boolean(item?.text && item.text.trim());
  const hasLink = Boolean(item?.url && item.url.trim());
  const hasFiles = Array.isArray(item?.files) && item.files.length > 0;
  const hasImages = hasFiles && item.files.some((file) => {
    const type = file?.type || file?.blob?.type || '';
    return typeof type === 'string' && type.startsWith('image/');
  });

  if (filter === 'text') return hasText;
  if (filter === 'link') return hasLink;
  if (filter === 'file') return hasFiles;
  if (filter === 'image') return hasImages;
  return true;
}

function getFilterSummary(filter) {
  if (isAllFilterActive(filter)) return '';
  if (filter === 'text') return 'Text';
  if (filter === 'link') return 'Link';
  if (filter === 'file') return 'File';
  if (filter === 'image') return 'Image';
  return '';
}

function filterItems(items = [], query = '', filter = currentSearchFilter) {
  const normalizedQuery = query.trim();
  let results = items;

  if (normalizedQuery) {
    if (fuseIndex) {
      results = fuseIndex.search(normalizedQuery).map((result) => result.item);
    } else {
      const needle = normalizedQuery.toLowerCase();
      results = items.filter((item) => {
        const fileText = (item.files || [])
          .map((file) => `${file?.name || ''} ${file?.type || ''}`)
          .join(' ');
        const haystack = `${item.text || ''}\n${item.url || ''}\n${fileText}`.toLowerCase();
        return haystack.includes(needle);
      });
    }
  }

  if (isAllFilterActive(filter)) return results;
  return results.filter((item) => itemMatchesSearchFilter(item, filter));
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

function configureSelectionShareButton() {
  if (!selectionShare) return;
  selectionShare.disabled = !supportsNativeShare;
  if (!supportsNativeShare) {
    selectionShare.title = 'Share is not supported on this device';
  } else {
    selectionShare.title = '';
  }
}

function updateClearAllVisibility() {
  clearAllButton.style.display = (allItems.length === 0 || currentSearchQuery.trim() || !isAllFilterActive(currentSearchFilter))
    ? 'none'
    : '';
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

function showEmptyState(query = '', filterSummary = '') {
  const trimmedQuery = query.trim();
  const hasQuery = Boolean(trimmedQuery);
  const hasFilters = Boolean(filterSummary);
  emptyState.style.display = 'block';

  if (emptyStateDefault && emptyStateSearch) {
    emptyStateDefault.hidden = hasQuery || hasFilters;
    emptyStateSearch.hidden = !(hasQuery || hasFilters);
    emptyStateSearch.textContent = hasQuery
      ? `No clips match "${truncateText(trimmedQuery, 48)}".`
      : hasFilters
        ? `No clips match filter: ${filterSummary}.`
      : '';
    return;
  }

  emptyState.textContent = hasQuery
    ? `No clips match "${truncateText(trimmedQuery, 48)}".`
    : hasFilters
      ? `No clips match filter: ${filterSummary}.`
    : EMPTY_STATE_FALLBACK_TEXT;
}

function renderItems(items, query = '', filterSummary = '') {
  clearObjectUrls();
  list.innerHTML = '';
  const sortedItems = sortItemsForDisplay(items);
  itemsById = new Map(sortedItems.map((item) => [item.id, item]));

  if (!sortedItems.length) {
    showEmptyState(query, filterSummary);
    updateClearAllVisibility();
    return;
  }
  emptyState.style.display = 'none';
  if (emptyStateDefault) {
    emptyStateDefault.hidden = false;
  }
  if (emptyStateSearch) {
    emptyStateSearch.hidden = true;
    emptyStateSearch.textContent = '';
  }
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
        ${item.text ? `<p class="item-text" title="${safeTextFull}">${safeText}</p>` : ''}
        ${item.url ? `<a class="item-link" href="${safeUrl}" target="_blank" rel="noopener" title="${safeUrl}">${safeUrlLabel}</a>` : ''}
        ${buildFilePreview(item.files)}
        <small class="item-time">${pinned ? '<svg class="pin-indicator" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg> · ' : ''}${formatDate(item.createdAt)}</small>
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
  const filteredItems = filterItems(allItems, currentSearchQuery, currentSearchFilter);
  renderItems(filteredItems, currentSearchQuery, getFilterSummary(currentSearchFilter));
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
  closeAddModal();
  await loadItems();
  showToast('Saved clip');
});

fab.addEventListener('click', () => {
  openAddModal();
});

modalClose.addEventListener('click', () => {
  closeAddModal();
});

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeAddModal();
});

list.addEventListener('click', (e) => {
  const img = e.target.closest('.img-preview');
  if (!img) return;
  openLightbox(img.dataset.full);
});

lightboxClose.addEventListener('click', () => {
  closeLightbox();
});

lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) {
    closeLightbox();
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

selectionShare.addEventListener('click', async () => {
  const ids = [...selectedIds];
  const items = ids
    .map((id) => itemsById.get(id))
    .filter(Boolean);
  if (!items.length) return;

  const status = await shareItems(items);
  if (status === 'shared') {
    exitSelectionMode();
    showToast(items.length === 1 ? 'Shared clip' : `Shared ${items.length} clips`);
    return;
  }
  if (status === 'cancelled') {
    return;
  }

  const fallbackText = buildCombinedClipboardText(items);
  const fallbackStatus = await copyForShareFallback(fallbackText);
  if (fallbackStatus === 'copied') {
    exitSelectionMode();
    return;
  }

  if (fallbackStatus === 'empty') {
    showToast('Nothing shareable in selection');
  }
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

function syncSearchFilterChips() {
  if (!searchFilters) return;
  searchFilters.querySelectorAll('[data-filter]').forEach((el) => {
    const key = el.dataset.filter;
    const isActive = key === currentSearchFilter;
    el.classList.toggle('is-active', isActive);
    el.setAttribute('aria-pressed', String(isActive));
  });
}

if (searchFilters) {
  searchFilters.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    const key = button.dataset.filter;
    if (!key) return;

    currentSearchFilter = key;
    syncSearchFilterChips();
    renderFilteredItems();
  });

  syncSearchFilterChips();
}

configureSelectionShareButton();

if ('serviceWorker' in navigator) {
  let hasRefreshedForNewWorker = false;

  // When a new service worker takes control (after skipWaiting + clients.claim),
  // reload once so the page immediately uses the latest cached assets.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasRefreshedForNewWorker) return;
    hasRefreshedForNewWorker = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('service-worker.js');

      // Force an update check at startup to pick up new deployments quickly.
      await registration.update();
    } catch {
      // Ignore registration errors in production UI flow.
    }
  });
}

async function init() {
  const items = await loadItems();
  await handleSharedContent(items);
}

init();
