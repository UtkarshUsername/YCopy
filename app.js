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
const openSettingsButton = document.getElementById('open-settings');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const settingsForm = document.getElementById('settings-form');
const expiryDurationSelect = document.getElementById('expiry-duration');
const maxEntriesInput = document.getElementById('max-entries');
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
let appliedBodyPaddingRight = false;
const LONG_PRESS_MS = 500;
const TOUCH_MOUSE_SUPPRESSION_MS = 800;
let suppressMouseEventsUntil = 0;

const MAX_TEXT_LENGTH = 320;
const MAX_FILE_NAME_LENGTH = 56;
const EMPTY_STATE_FALLBACK_TEXT = 'No clips yet. Tap + to add one or share to YCopy.';
const DAY_IN_MS = 86400000;
const SETTINGS_STORAGE_KEY = 'ycopy-settings';
const AUTO_EXPIRE_DISABLED_MS = 0;
const MAX_ENTRIES_UNLIMITED = 0;
const MAX_ENTRIES_MIN = 0;
const MAX_ENTRIES_MAX = 500;
const AUTO_EXPIRE_OPTIONS_MS = [
  AUTO_EXPIRE_DISABLED_MS,
  DAY_IN_MS,
  3 * DAY_IN_MS,
  7 * DAY_IN_MS,
  14 * DAY_IN_MS,
  30 * DAY_IN_MS,
  90 * DAY_IN_MS,
];
const AUTO_EXPIRE_LABELS = {
  [AUTO_EXPIRE_DISABLED_MS]: 'Off',
  [DAY_IN_MS]: '1 day',
  [3 * DAY_IN_MS]: '3 days',
  [7 * DAY_IN_MS]: '7 days',
  [14 * DAY_IN_MS]: '14 days',
  [30 * DAY_IN_MS]: '30 days',
  [90 * DAY_IN_MS]: '90 days',
};
const DEFAULT_SETTINGS = Object.freeze({
  autoExpireMs: AUTO_EXPIRE_DISABLED_MS,
  maxEntries: MAX_ENTRIES_UNLIMITED,
});
let appSettings = { ...DEFAULT_SETTINGS };
let autoExpireIntervalId = null;
let autoExpireInProgress = false;
let maxEntriesPruneInProgress = false;

function syncSearchStickyOffset() {
  const activeHeader = headerSelection && !headerSelection.hidden
    ? headerSelection
    : headerDefault;
  if (!activeHeader) return;
  const headerHeight = Math.ceil(activeHeader.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--search-sticky-top', `${headerHeight}px`);
}

function escapeHtml(value = '') {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function markTouchInteraction() {
  suppressMouseEventsUntil = Date.now() + TOUCH_MOUSE_SUPPRESSION_MS;
}

function isSyntheticMouseEvent() {
  return Date.now() < suppressMouseEventsUntil;
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

function normalizeAutoExpireMs(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_SETTINGS.autoExpireMs;
  return AUTO_EXPIRE_OPTIONS_MS.includes(numericValue) ? numericValue : DEFAULT_SETTINGS.autoExpireMs;
}

function normalizeMaxEntries(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_SETTINGS.maxEntries;
  const rounded = Math.floor(numericValue);
  if (rounded <= MAX_ENTRIES_MIN) return MAX_ENTRIES_UNLIMITED;
  return Math.min(rounded, MAX_ENTRIES_MAX);
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      autoExpireMs: normalizeAutoExpireMs(parsed?.autoExpireMs),
      maxEntries: normalizeMaxEntries(parsed?.maxEntries),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));
  } catch {
    // Ignore storage failures; settings stay in-memory for this session.
  }
}

function getAutoExpireLabel(autoExpireMs = appSettings.autoExpireMs) {
  return AUTO_EXPIRE_LABELS[autoExpireMs] || AUTO_EXPIRE_LABELS[AUTO_EXPIRE_DISABLED_MS];
}

function syncSettingsForm() {
  if (!expiryDurationSelect) return;
  expiryDurationSelect.value = String(appSettings.autoExpireMs);
  if (maxEntriesInput) {
    maxEntriesInput.value = String(appSettings.maxEntries);
  }
}

function getClipCountLabel(count) {
  return `${count} clip${count === 1 ? '' : 's'}`;
}

function getMaxEntriesLabel(maxEntries = appSettings.maxEntries) {
  return maxEntries === MAX_ENTRIES_UNLIMITED ? 'Unlimited' : `${maxEntries}`;
}

function getExpiryStatus(item, now = Date.now()) {
  if (appSettings.autoExpireMs <= AUTO_EXPIRE_DISABLED_MS) return null;
  if (!item || isItemPinned(item) || !Number.isFinite(item.createdAt)) return null;
  const expiresAt = item.createdAt + appSettings.autoExpireMs;
  const msLeft = expiresAt - now;
  if (msLeft <= 0) {
    return {
      label: 'Expiring today',
      isUrgent: true,
    };
  }
  const daysLeft = Math.ceil(msLeft / DAY_IN_MS);
  return {
    label: daysLeft === 1 ? 'Expiring in 1 day' : `Expiring in ${daysLeft} days`,
    isUrgent: daysLeft <= 7,
  };
}

appSettings = loadSettings();

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

function normalizeStoredText(value = '') {
  return value?.toString().trim() || '';
}

function normalizeStoredUrl(value = '') {
  return value?.toString().trim() || '';
}

function normalizeStoredFiles(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function getFileDedupSignature(file = {}) {
  const blobSize = Number.isFinite(file?.blob?.size) ? file.blob.size : null;
  const rawSize = Number.isFinite(file?.size) ? file.size : null;
  return JSON.stringify([
    file?.name || '',
    file?.type || '',
    blobSize ?? rawSize ?? 0,
  ]);
}

function getItemDedupSignature(item = {}) {
  return JSON.stringify([
    normalizeStoredText(item.text),
    normalizeStoredUrl(item.url),
    normalizeStoredFiles(item.files).map(getFileDedupSignature),
  ]);
}

async function addItem(item) {
  const normalizedItem = {
    ...item,
    text: normalizeStoredText(item.text),
    url: normalizeStoredUrl(item.url),
    files: normalizeStoredFiles(item.files),
  };
  const incomingSignature = getItemDedupSignature(normalizedItem);

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const existingRequest = store.getAll();
    let settled = false;

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const resolveOnce = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    existingRequest.onsuccess = () => {
      const existingItems = existingRequest.result || [];
      const existing = existingItems.find((savedItem) => getItemDedupSignature(savedItem) === incomingSignature);
      const now = Date.now();

      if (existing) {
        const updatedItem = {
          ...existing,
          text: normalizedItem.text,
          url: normalizedItem.url,
          files: normalizedItem.files,
          createdAt: now,
        };
        if (Number.isFinite(existing.pinnedAt) && existing.pinnedAt > 0) {
          updatedItem.pinnedAt = now;
        }
        const putRequest = store.put(updatedItem);
        putRequest.onsuccess = () => resolveOnce({ id: existing.id, deduplicated: true });
        putRequest.onerror = () => rejectOnce(putRequest.error || tx.error);
        return;
      }

      const addRequest = store.add({
        ...normalizedItem,
        createdAt: Number.isFinite(normalizedItem.createdAt) ? normalizedItem.createdAt : now,
        pinnedAt: normalizedItem.pinnedAt ?? null,
      });
      addRequest.onsuccess = () => resolveOnce({ id: Number(addRequest.result), deduplicated: false });
      addRequest.onerror = () => rejectOnce(addRequest.error || tx.error);
    };

    existingRequest.onerror = () => rejectOnce(existingRequest.error || tx.error);
    tx.onerror = () => rejectOnce(tx.error);
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

async function deleteItems(ids = []) {
  if (!ids.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    ids.forEach((id) => store.delete(id));
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

function getAutoExpireCutoff(now = Date.now()) {
  if (appSettings.autoExpireMs <= AUTO_EXPIRE_DISABLED_MS) return null;
  return now - appSettings.autoExpireMs;
}

async function pruneExpiredItems() {
  if (autoExpireInProgress) return 0;
  const cutoff = getAutoExpireCutoff();
  if (cutoff === null) return 0;

  autoExpireInProgress = true;
  try {
    const items = await getItems();
    const expiredIds = items
      .filter((item) => {
        if (!Number.isFinite(item?.id)) return false;
        if (isItemPinned(item)) return false;
        return Number.isFinite(item?.createdAt) && item.createdAt <= cutoff;
      })
      .map((item) => item.id);

    if (!expiredIds.length) return 0;
    await deleteItems(expiredIds);
    return expiredIds.length;
  } finally {
    autoExpireInProgress = false;
  }
}

function getOverflowItemsToDelete(items = []) {
  const maxEntries = appSettings.maxEntries;
  if (maxEntries <= MAX_ENTRIES_UNLIMITED) return [];
  if (items.length <= maxEntries) return [];
  const overflow = items.length - maxEntries;
  return [...items]
    .sort((a, b) => {
      const aCreatedAt = Number.isFinite(a?.createdAt) ? a.createdAt : 0;
      const bCreatedAt = Number.isFinite(b?.createdAt) ? b.createdAt : 0;
      if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;
      return (Number(a?.id) || 0) - (Number(b?.id) || 0);
    })
    .slice(0, overflow)
    .map((item) => item.id)
    .filter((id) => Number.isFinite(id));
}

async function pruneItemsOverLimit() {
  if (maxEntriesPruneInProgress) return 0;
  if (appSettings.maxEntries <= MAX_ENTRIES_UNLIMITED) return 0;

  maxEntriesPruneInProgress = true;
  try {
    const items = await getItems();
    const idsToDelete = getOverflowItemsToDelete(items);
    if (!idsToDelete.length) return 0;
    await deleteItems(idsToDelete);
    return idsToDelete.length;
  } finally {
    maxEntriesPruneInProgress = false;
  }
}

function stopAutoExpireTimer() {
  if (autoExpireIntervalId === null) return;
  window.clearInterval(autoExpireIntervalId);
  autoExpireIntervalId = null;
}

function startAutoExpireTimer() {
  stopAutoExpireTimer();
  if (appSettings.autoExpireMs <= AUTO_EXPIRE_DISABLED_MS) return;
  const intervalMs = Math.min(Math.max(Math.floor(appSettings.autoExpireMs / 8), 60000), 900000);
  autoExpireIntervalId = window.setInterval(async () => {
    try {
      const removedCount = await pruneExpiredItems();
      if (removedCount > 0) {
        await loadItems({ skipPrune: true });
      }
    } catch {
      // Ignore timer cleanup errors to avoid interrupting the UI.
    }
  }, intervalMs);
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
  appliedBodyPaddingRight = false;

  // Desktop browsers with persistent scrollbars need compensation to prevent
  // layout shift; touch devices typically do not, and can misreport very wide
  // values that create a visible right-side gutter.
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  const shouldCompensateScrollbar = window.matchMedia('(pointer: fine)').matches && scrollbarWidth > 0 && scrollbarWidth <= 64;
  if (shouldCompensateScrollbar) {
    const computedPaddingRight = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
    appliedBodyPaddingRight = true;
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
  if (appliedBodyPaddingRight) {
    document.body.style.paddingRight = savedBodyPaddingRight;
  }
  window.scrollTo(0, lockedScrollY);
  savedBodyPaddingRight = '';
  appliedBodyPaddingRight = false;
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

function openSettingsModal() {
  syncSettingsForm();
  openOverlay(settingsOverlay);
  expiryDurationSelect?.focus();
}

function closeSettingsModal() {
  closeOverlay(settingsOverlay);
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
  syncSearchStickyOffset();
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
  const shouldHide = allItems.length === 0 || currentSearchQuery.trim() || !isAllFilterActive(currentSearchFilter);
  clearAllButton.classList.toggle('header-btn-hidden', shouldHide);
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
  const now = Date.now();
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
    const expiryStatus = getExpiryStatus(item, now);
    const li = document.createElement('li');
    li.className = `item${pinned ? ' item-pinned' : ''}${selectedIds.has(item.id) ? ' item-selected' : ''}`;
    li.dataset.itemId = item.id;
    const safeText = item.text
      ? escapeHtml(truncateText(item.text, MAX_TEXT_LENGTH))
      : '';
    const safeTextFull = item.text ? escapeHtml(item.text) : '';
    const safeUrl = item.url ? escapeHtml(item.url) : '';
    const safeUrlLabel = safeUrl;
    li.innerHTML = `
        ${item.text ? `<p class="item-text" title="${safeTextFull}">${safeText}</p>` : ''}
        ${item.url ? `<a class="item-link" href="${safeUrl}" target="_blank" rel="noopener" title="${safeUrl}">${safeUrlLabel}</a>` : ''}
        ${buildFilePreview(item.files)}
        <div class="item-meta">
          <small class="item-time">${pinned ? '<svg class="pin-indicator" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg> · ' : ''}${formatDate(item.createdAt)}</small>
          ${expiryStatus ? `<small class="item-expiry${expiryStatus.isUrgent ? ' item-expiry-urgent' : ''}"><svg class="expiry-indicator" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg><em>${expiryStatus.label}</em></small>` : ''}
        </div>
      `;

    // Long press to enter selection mode
    let pressStarted = false;
    const startLongPress = (e) => {
      // Don't interfere with links or images
      if (e.target.closest('a, .img-preview')) return;
      if (e.type === 'touchstart') {
        markTouchInteraction();
      }
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
      if (e.type === 'touchend') {
        markTouchInteraction();
      }
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
      if (isSyntheticMouseEvent()) return;
      startLongPress(e);
    });
    li.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (isSyntheticMouseEvent()) return;
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

async function loadItems({ skipPrune = false } = {}) {
  if (!skipPrune) {
    await pruneExpiredItems();
    await pruneItemsOverLimit();
  }
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

openSettingsButton?.addEventListener('click', () => {
  openSettingsModal();
});

modalClose.addEventListener('click', () => {
  closeAddModal();
});

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeAddModal();
});

settingsClose?.addEventListener('click', () => {
  closeSettingsModal();
});

settingsOverlay?.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettingsModal();
});

settingsForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const nextAutoExpireMs = normalizeAutoExpireMs(expiryDurationSelect?.value);
  const nextMaxEntries = normalizeMaxEntries(maxEntriesInput?.value);
  appSettings = {
    ...appSettings,
    autoExpireMs: nextAutoExpireMs,
    maxEntries: nextMaxEntries,
  };
  saveSettings();
  startAutoExpireTimer();
  const removedCountByExpiry = await pruneExpiredItems();
  const removedCountByLimit = await pruneItemsOverLimit();
  const removedCount = removedCountByExpiry + removedCountByLimit;
  await loadItems({ skipPrune: true });
  closeSettingsModal();

  const autoClearLabel = nextAutoExpireMs === AUTO_EXPIRE_DISABLED_MS
    ? 'Off'
    : getAutoExpireLabel(nextAutoExpireMs);
  const maxEntriesLabel = getMaxEntriesLabel(nextMaxEntries);
  if (removedCount > 0) {
    showToast(`Saved: auto-clear ${autoClearLabel}, max ${maxEntriesLabel}. Removed ${getClipCountLabel(removedCount)}.`);
    return;
  }
  showToast(`Saved: auto-clear ${autoClearLabel}, max ${maxEntriesLabel}.`);
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
  await deleteItems(ids);
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
syncSettingsForm();
startAutoExpireTimer();
syncSearchStickyOffset();
window.addEventListener('resize', syncSearchStickyOffset);
document.fonts?.ready?.then(syncSearchStickyOffset);

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
      const registration = await navigator.serviceWorker.register('service-worker.js', {
        updateViaCache: 'none',
      });

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
