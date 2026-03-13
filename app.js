import {
  DEFAULT_SETTINGS as STORE_DEFAULT_SETTINGS,
  clearAllClips,
  deleteClips,
  getClips,
  normalizeSettings,
  persistClipRecord,
  repairStoredData,
  saveClipRecord,
  saveIncomingClip,
} from './clip-store.mjs';
import {
  DEFAULT_GITHUB_SYNC_SETTINGS,
  normalizeGitHubSyncSettings,
  syncClipsToGitHub,
  validateGitHubSyncSettings,
} from './github-sync.mjs';

const form = document.getElementById('add-form');
const list = document.getElementById('items');
const emptyState = document.getElementById('empty-state');
const clearAllButton = document.getElementById('clear-all');
const syncNowButton = document.getElementById('sync-now');
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
const markdownSyncEnabledInput = document.getElementById('markdown-sync-enabled');
const githubOwnerInput = document.getElementById('github-owner');
const githubRepoInput = document.getElementById('github-repo');
const githubBranchInput = document.getElementById('github-branch');
const githubTokenInput = document.getElementById('github-token');
const syncStatus = document.getElementById('sync-status');
const syncFromSettingsButton = document.getElementById('sync-from-settings');
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
const GITHUB_SYNC_STORAGE_KEY = 'ycopy-github-sync';
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
  ...STORE_DEFAULT_SETTINGS,
  autoExpireMs: AUTO_EXPIRE_DISABLED_MS,
  maxEntries: MAX_ENTRIES_UNLIMITED,
});
const KEYBOARD_OPEN_THRESHOLD = 80;
const FILE_EXTENSION_MIME_TYPES = Object.freeze({
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odt: 'application/vnd.oasis.opendocument.text',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});
const CHROMIUM_WEB_SHARE_MIME_TYPES = new Set([
  'application/pdf',
  'audio/flac',
  'audio/mp3',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/tiff',
  'image/webp',
  'image/x-icon',
  'image/x-ms-bmp',
  'image/x-xbitmap',
  'text/comma-separated-values',
  'text/css',
  'text/csv',
  'text/html',
  'text/plain',
  'video/mp4',
  'video/mpeg',
  'video/ogg',
  'video/webm',
]);
let appSettings = { ...DEFAULT_SETTINGS };
let autoExpireIntervalId = null;
let autoExpireInProgress = false;
let maxEntriesPruneInProgress = false;
let dataRepairPromise = null;
let syncInProgress = false;
let gitHubSyncSettings = { ...DEFAULT_GITHUB_SYNC_SETTINGS };
let lastSyncMessage = 'Git sync is off.';

function syncSearchStickyOffset() {
  const activeHeader = headerSelection && !headerSelection.hidden
    ? headerSelection
    : headerDefault;
  if (!activeHeader) return;
  const headerHeight = Math.ceil(activeHeader.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--search-sticky-top', `${headerHeight}px`);
}

function syncViewportMetrics() {
  const visualViewport = window.visualViewport;
  const layoutViewportHeight = Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
  const visibleViewportHeight = Math.round(visualViewport?.height || layoutViewportHeight);
  const viewportOffsetTop = Math.max(0, Math.round(visualViewport?.offsetTop || 0));
  const keyboardHeight = visualViewport
    ? Math.max(0, Math.round(layoutViewportHeight - visualViewport.height - visualViewport.offsetTop))
    : 0;
  const effectiveKeyboardHeight = keyboardHeight >= KEYBOARD_OPEN_THRESHOLD ? keyboardHeight : 0;
  const effectiveViewportHeight = Math.max(visibleViewportHeight, 0);

  document.documentElement.style.setProperty('--app-height', `${effectiveViewportHeight}px`);
  document.documentElement.style.setProperty('--modal-viewport-height', `${effectiveViewportHeight}px`);
  document.documentElement.style.setProperty('--modal-viewport-top', `${viewportOffsetTop}px`);
  document.documentElement.style.setProperty('--keyboard-offset', `${effectiveKeyboardHeight}px`);
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
    const parsed = normalizeSettings(JSON.parse(raw));
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
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

function loadGitHubSyncSettings() {
  try {
    const raw = localStorage.getItem(GITHUB_SYNC_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GITHUB_SYNC_SETTINGS };
    return {
      ...DEFAULT_GITHUB_SYNC_SETTINGS,
      ...normalizeGitHubSyncSettings(JSON.parse(raw)),
    };
  } catch {
    return { ...DEFAULT_GITHUB_SYNC_SETTINGS };
  }
}

function saveGitHubSyncSettings() {
  try {
    localStorage.setItem(GITHUB_SYNC_STORAGE_KEY, JSON.stringify(gitHubSyncSettings));
  } catch {
    // Ignore storage failures; settings stay in-memory for this session.
  }
}

function getMaskedTokenLabel(token = '') {
  if (!token) return 'No token saved';
  const visibleTail = token.slice(-4);
  return `Token saved (${visibleTail.padStart(4, '•')})`;
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
  if (markdownSyncEnabledInput) {
    markdownSyncEnabledInput.checked = Boolean(appSettings.markdownSyncEnabled);
  }
  if (githubOwnerInput) {
    githubOwnerInput.value = gitHubSyncSettings.repoOwner;
  }
  if (githubRepoInput) {
    githubRepoInput.value = gitHubSyncSettings.repoName;
  }
  if (githubBranchInput) {
    githubBranchInput.value = gitHubSyncSettings.branch;
  }
  if (githubTokenInput) {
    githubTokenInput.value = gitHubSyncSettings.token;
    githubTokenInput.placeholder = gitHubSyncSettings.token ? getMaskedTokenLabel(gitHubSyncSettings.token) : 'github_pat_...';
  }
  updateSyncControls();
}

function readGitHubSyncDraft() {
  return normalizeGitHubSyncSettings({
    repoOwner: githubOwnerInput?.value ?? gitHubSyncSettings.repoOwner,
    repoName: githubRepoInput?.value ?? gitHubSyncSettings.repoName,
    branch: githubBranchInput?.value ?? gitHubSyncSettings.branch,
    token: githubTokenInput?.value ?? gitHubSyncSettings.token,
  });
}

function getSyncValidationResult({ useDraft = false } = {}) {
  const markdownSyncEnabled = useDraft
    ? Boolean(markdownSyncEnabledInput?.checked)
    : Boolean(appSettings.markdownSyncEnabled);

  if (!markdownSyncEnabled) {
    return {
      isValid: false,
      message: 'Git sync is off.',
    };
  }

  const validation = validateGitHubSyncSettings(useDraft ? readGitHubSyncDraft() : gitHubSyncSettings);
  if (!validation.isValid) {
    return {
      isValid: false,
      message: validation.errors[0],
    };
  }

  return {
    isValid: true,
    message: lastSyncMessage === 'Git sync is off.' ? 'Ready to sync to GitHub.' : lastSyncMessage,
  };
}

function updateSyncControls() {
  const validation = getSyncValidationResult();
  const draftValidation = getSyncValidationResult({ useDraft: true });
  if (syncStatus) {
    syncStatus.textContent = syncInProgress
      ? 'Syncing with GitHub…'
      : settingsOverlay && !settingsOverlay.hidden
        ? draftValidation.message
        : validation.message;
  }
  if (syncNowButton) {
    syncNowButton.disabled = syncInProgress || !validation.isValid;
    syncNowButton.title = syncInProgress ? 'Sync in progress' : validation.message;
  }
  if (syncFromSettingsButton) {
    syncFromSettingsButton.disabled = syncInProgress || !draftValidation.isValid;
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
  if (daysLeft > 10) {
    return null;
  }
  return {
    label: daysLeft === 1 ? 'Expires in 1 day' : `Expires in ${daysLeft} days`,
    isUrgent: daysLeft <= 7,
  };
}

appSettings = loadSettings();
gitHubSyncSettings = loadGitHubSyncSettings();

async function ensureDataReady() {
  if (!dataRepairPromise) {
    dataRepairPromise = repairStoredData().catch((error) => {
      dataRepairPromise = null;
      throw error;
    });
  }
  return dataRepairPromise;
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

async function addItem(item) {
  await ensureDataReady();
  return saveIncomingClip({
    ...item,
    text: normalizeStoredText(item.text),
    url: normalizeStoredUrl(item.url),
    files: normalizeStoredFiles(item.files),
    captureSource: item.captureSource || 'manual',
  });
}

async function getItems() {
  await ensureDataReady();
  return getClips();
}

async function deleteItem(id) {
  return deleteItems([id]);
}

async function deleteItems(ids = []) {
  if (!ids.length) return;
  await ensureDataReady();
  return deleteClips(ids);
}

async function updateItem(item) {
  await ensureDataReady();
  return saveClipRecord(item);
}

async function clearItems() {
  await ensureDataReady();
  return clearAllClips();
}

async function persistSyncedClip(item) {
  await ensureDataReady();
  return persistClipRecord(item);
}

function getSyncSuccessMessage(result) {
  const totalChanges = (result?.additions || 0) + (result?.deletions || 0);
  if (!totalChanges) return 'GitHub already matches local clips';
  if (result?.commitUrl) {
    return totalChanges === 1
      ? 'Synced 1 change to GitHub'
      : `Synced ${totalChanges} changes to GitHub`;
  }
  return totalChanges === 1
    ? 'Prepared 1 GitHub change'
    : `Prepared ${totalChanges} GitHub changes`;
}

async function runGitSync({ closeSettings = false } = {}) {
  if (syncInProgress) return;

  const validation = getSyncValidationResult();
  if (!validation.isValid) {
    showToast(validation.message);
    if (!appSettings.markdownSyncEnabled) {
      openSettingsModal();
    }
    return;
  }

  syncInProgress = true;
  lastSyncMessage = 'Syncing with GitHub…';
  updateSyncControls();

  try {
    await ensureDataReady();
    const clips = await getClips({ includeDeleted: true });
    const result = await syncClipsToGitHub({
      config: gitHubSyncSettings,
      clips,
      persistClip: persistSyncedClip,
    });
    lastSyncMessage = result.status === 'noop'
      ? 'GitHub already matches local clips.'
      : result.commitUrl
        ? `Last sync succeeded. ${result.commitUrl}`
        : 'Last sync succeeded.';
    await loadItems({ skipPrune: true });
    if (closeSettings) {
      closeSettingsModal();
    }
    showToast(getSyncSuccessMessage(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub sync failed';
    lastSyncMessage = `Sync failed: ${message}`;
    showToast(lastSyncMessage);
  } finally {
    syncInProgress = false;
    updateSyncControls();
  }
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
        if (!item?.id) return false;
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
  const unpinnedItems = items.filter((item) => !isItemPinned(item));
  if (unpinnedItems.length <= maxEntries) return [];
  const overflow = unpinnedItems.length - maxEntries;
  return [...unpinnedItems]
    .sort((a, b) => {
      const aCreatedAt = Number.isFinite(a?.createdAt) ? a.createdAt : 0;
      const bCreatedAt = Number.isFinite(b?.createdAt) ? b.createdAt : 0;
      if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;
      return (a?.id || '').localeCompare(b?.id || '');
    })
    .slice(0, overflow)
    .map((item) => item.id)
    .filter(Boolean);
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
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && overlay.contains(activeElement)) {
    activeElement.blur();
  }
  overlay.hidden = true;
  unlockBodyScroll();
  window.setTimeout(syncViewportMetrics, 0);
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
        if (isImageFile(file)) {
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

function downloadBlobFile(blob, fileName = 'download') {
  if (!(blob instanceof Blob)) return false;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return true;
}

function isImageFile(file) {
  const type = (file?.type || file?.blob?.type || '').toString().toLowerCase();
  return type.startsWith('image/');
}

function getDocumentClipboardMimeType(file) {
  const type = (file?.type || file?.blob?.type || '').toString().trim().toLowerCase();
  if (!type || type === 'application/octet-stream') return '';
  return type;
}

function getClipboardTypeCandidates(mimeType = '', { includeWebCustomFormats = true } = {}) {
  const normalizedType = mimeType.toString().trim().toLowerCase();
  if (!normalizedType) return [];

  const candidates = [normalizedType];
  if (includeWebCustomFormats && !normalizedType.startsWith('web ')) {
    candidates.push(`web ${normalizedType}`);
  }

  const supports = typeof ClipboardItem === 'function' && typeof ClipboardItem.supports === 'function'
    ? ClipboardItem.supports.bind(ClipboardItem)
    : null;
  const supportedCandidates = supports
    ? candidates.filter((candidate) => supports(candidate))
    : candidates;

  return supportedCandidates.length ? supportedCandidates : candidates;
}

function maybeShowClipboardToast(message, toastEnabled = true) {
  if (toastEnabled && message) {
    showToast(message);
  }
}

async function copyToClipboard(value, {
  successMessage = 'Copied to clipboard',
  unavailableMessage = 'Clipboard not available',
  blockedMessage = 'Clipboard blocked',
  toastEnabled = true,
} = {}) {
  if (!navigator.clipboard?.writeText) {
    maybeShowClipboardToast(unavailableMessage, toastEnabled);
    return 'unavailable';
  }

  try {
    await navigator.clipboard.writeText(value);
    maybeShowClipboardToast(successMessage, toastEnabled);
    return 'copied';
  } catch {
    maybeShowClipboardToast(blockedMessage, toastEnabled);
    return 'blocked';
  }
}

async function writeBlobToClipboard(blob, {
  mimeType = blob?.type || '',
  successMessage = 'Copied to clipboard',
  webSuccessMessage = successMessage,
  unsupportedMessage = 'Clipboard copy not supported',
  blockedMessage = 'Clipboard blocked',
  toastEnabled = true,
  includeWebCustomFormats = true,
} = {}) {
  if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function') {
    maybeShowClipboardToast(unsupportedMessage, toastEnabled);
    return 'unsupported';
  }

  const typeCandidates = getClipboardTypeCandidates(mimeType, { includeWebCustomFormats });
  if (!typeCandidates.length) {
    maybeShowClipboardToast(unsupportedMessage, toastEnabled);
    return 'unsupported';
  }

  let lastError = null;
  for (const type of typeCandidates) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
      const copiedAsWebFormat = type.startsWith('web ');
      maybeShowClipboardToast(
        copiedAsWebFormat ? webSuccessMessage : successMessage,
        toastEnabled,
      );
      return copiedAsWebFormat ? 'copied-web' : 'copied';
    } catch (error) {
      lastError = error;
    }
  }

  const failureMessage = lastError?.name === 'NotAllowedError'
    ? blockedMessage
    : unsupportedMessage;
  maybeShowClipboardToast(failureMessage, toastEnabled);
  return lastError?.name === 'NotAllowedError' ? 'blocked' : 'unsupported';
}

async function copyImageToClipboard(blob, options = {}) {
  const type = blob.type === 'image/png' ? 'image/png' : 'image/png';
  let pngBlob = blob;
  if (blob.type !== 'image/png') {
    try {
      pngBlob = await convertToPngBlob(blob);
    } catch {
      maybeShowClipboardToast(options.unsupportedMessage || 'Image copy not supported', options.toastEnabled ?? true);
      return 'unsupported';
    }
  }
  return writeBlobToClipboard(pngBlob, {
    mimeType: type,
    successMessage: 'Image copied to clipboard',
    unsupportedMessage: 'Image copy not supported',
    blockedMessage: 'Image copy blocked',
    ...options,
  });
}

async function copyDocumentToClipboard(file, options = {}) {
  const mimeType = getDocumentClipboardMimeType(file);
  if (!file?.blob || !mimeType) {
    maybeShowClipboardToast(options.unsupportedMessage || 'Document clipboard copy is not supported here. Use Share or download instead.', options.toastEnabled ?? true);
    return 'unsupported';
  }

  return writeBlobToClipboard(file.blob, {
    mimeType,
    successMessage: 'Document copied to clipboard',
    unsupportedMessage: 'Document clipboard copy is not supported here. Use Share or download instead.',
    blockedMessage: 'Document copy blocked',
    includeWebCustomFormats: false,
    ...options,
  });
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

function isChromiumWebShareFileType(file = {}) {
  const mimeType = getShareFileMimeType(file);
  return CHROMIUM_WEB_SHARE_MIME_TYPES.has(mimeType);
}

function isOfficeDocumentFile(file = {}) {
  const mimeType = getShareFileMimeType(file);
  return mimeType === 'application/msword'
    || mimeType === 'application/vnd.ms-excel'
    || mimeType === 'application/vnd.ms-powerpoint'
    || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function isPdfFile(file = {}) {
  return getShareFileMimeType(file) === 'application/pdf';
}

function normalizeShareUrl(value = '') {
  if (!value) return '';
  try {
    return new URL(value).toString();
  } catch {
    return '';
  }
}

function inferMimeTypeFromFileName(name = '') {
  const trimmedName = name.toString().trim().toLowerCase();
  const extension = trimmedName.includes('.')
    ? trimmedName.slice(trimmedName.lastIndexOf('.') + 1)
    : '';
  return FILE_EXTENSION_MIME_TYPES[extension] || '';
}

function getShareFileMimeType(file = {}) {
  const rawType = (file.type || file.blob?.type || '').toString().trim().toLowerCase();
  if (rawType && rawType !== 'application/octet-stream') return rawType;
  return inferMimeTypeFromFileName(file.name || '') || rawType || 'application/octet-stream';
}

function hasSharePayload(data = {}) {
  return Boolean(
    data?.title
    || data?.text
    || data?.url
    || (Array.isArray(data?.files) && data.files.length),
  );
}

function canShareData(data = {}) {
  if (!hasSharePayload(data)) return false;
  if (typeof navigator.canShare !== 'function') return true;
  try {
    return navigator.canShare(data);
  } catch {
    return false;
  }
}

function createShareFiles(files = []) {
  return files
    .filter((file) => file?.blob)
    .map((file, index) => {
      const blob = file.blob;
      const name = file.name || `attachment-${index + 1}`;
      const type = getShareFileMimeType(file);
      return new File([blob], name, { type, lastModified: Date.now() });
    });
}

function collectShareFiles(items = []) {
  return items.flatMap((item) => createShareFiles(item?.files || []));
}

function buildSharePayloadVariants(items = []) {
  const title = items.length === 1 ? 'YCopy clip' : `${items.length} YCopy clips`;
  const combinedText = buildCombinedClipboardText(items);
  const shareUrl = items.length === 1 ? normalizeShareUrl(items[0]?.url || '') : '';
  const shareFiles = collectShareFiles(items);
  const variants = [];

  if (shareFiles.length) {
    variants.push({
      title,
      files: shareFiles,
    });

    if (combinedText) {
      variants.push({
        title,
        text: combinedText,
        files: shareFiles,
      });
    }

    variants.push({
      files: shareFiles,
    });
  }

  const textVariant = { title };
  if (combinedText) textVariant.text = combinedText;
  if (shareUrl) textVariant.url = shareUrl;
  if (textVariant.text || textVariant.url) {
    variants.push(textVariant);
  }

  return variants.filter((variant) => hasSharePayload(variant));
}

function prioritizeSharePayloadVariants(variants = []) {
  if (typeof navigator.canShare !== 'function') return variants;

  const shareableVariants = [];
  const fallbackVariants = [];

  variants.forEach((variant) => {
    if (canShareData(variant)) {
      shareableVariants.push(variant);
      return;
    }
    fallbackVariants.push(variant);
  });

  return [...shareableVariants, ...fallbackVariants];
}

function selectionIncludesFiles(items = []) {
  return items.some((item) => Array.isArray(item?.files) && item.files.some((file) => file?.blob));
}

function downloadSingleSelectedFile(items = []) {
  if (items.length !== 1) return false;
  const files = items[0]?.files || [];
  if (files.length !== 1) return false;
  const [file] = files;
  if (!file?.blob) return false;
  return downloadBlobFile(file.blob, file.name || 'attachment');
}

async function shareItems(items = []) {
  if (!items.length || !navigator.share) return 'unsupported';

  const sharePayloadVariants = prioritizeSharePayloadVariants(buildSharePayloadVariants(items));
  if (!sharePayloadVariants.length) return 'unsupported';
  let attemptedFileShare = false;

  for (const shareData of sharePayloadVariants) {
    if (Array.isArray(shareData?.files) && shareData.files.length) {
      attemptedFileShare = true;
    }
    try {
      await navigator.share(shareData);
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }

  if (attemptedFileShare) return 'unsupported-files';
  return 'unsupported';
}

async function copyForShareFallback(text) {
  if (!text) return 'empty';
  return copyToClipboard(text, {
    successMessage: 'Sharing unavailable, copied instead',
    unavailableMessage: 'Sharing unavailable on this device',
    blockedMessage: 'Sharing unavailable',
  });
}

function getPinnedTimestamp(item) {
  return Number.isFinite(item?.pinnedAt) ? item.pinnedAt : 0;
}

function isItemPinned(item) {
  return getPinnedTimestamp(item) > 0;
}

function getItemSortTimestamp(item) {
  if (Number.isFinite(item?.updatedAt)) return item.updatedAt;
  if (Number.isFinite(item?.createdAt)) return item.createdAt;
  return 0;
}

function sortItemsForDisplay(items = []) {
  return [...items].sort((a, b) => {
    const aPinnedAt = getPinnedTimestamp(a);
    const bPinnedAt = getPinnedTimestamp(b);
    const aPinned = aPinnedAt > 0;
    const bPinned = bPinnedAt > 0;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    if (aPinned && bPinned && aPinnedAt !== bPinnedAt) return bPinnedAt - aPinnedAt;
    return getItemSortTimestamp(b) - getItemSortTimestamp(a);
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
      { name: 'text', weight: 0.25 },
      { name: 'url', weight: 0.2 },
      { name: 'meta.title', weight: 0.2 },
      { name: 'meta.tags', weight: 0.15 },
      { name: 'capture.plainText', weight: 0.15 },
      { name: 'files.name', weight: 0.05 },
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
        const tagText = Array.isArray(item?.meta?.tags) ? item.meta.tags.join(' ') : '';
        const haystack = [
          item.text || '',
          item.url || '',
          item?.meta?.title || '',
          tagText,
          item?.capture?.plainText || '',
          fileText,
        ].join('\n').toLowerCase();
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
    const id = el.dataset.itemId;
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

async function copyItemToClipboard(item, {
  textOptions = {},
  imageOptions = {},
  documentOptions = {},
  toastEnabled = true,
} = {}) {
  const clipboardText = buildClipboardText(item);
  if (clipboardText) {
    return copyToClipboard(clipboardText, {
      toastEnabled,
      ...textOptions,
    });
  }

  const imageFile = item.files?.find((file) => isImageFile(file) && file.blob);
  if (imageFile) {
    return copyImageToClipboard(imageFile.blob, {
      toastEnabled,
      ...imageOptions,
    });
  }

  const documentFile = item.files?.find((file) => !isImageFile(file) && file.blob);
  if (documentFile) {
    return copyDocumentToClipboard(documentFile, {
      toastEnabled,
      ...documentOptions,
    });
  }

  maybeShowClipboardToast('Nothing to copy', toastEnabled);
  return 'empty';
}

function getSharedCopyToastMessage(status) {
  if (status === 'copied') return 'Shared content saved and copied';
  if (status === 'blocked') return 'Shared content saved (clipboard blocked)';
  if (status === 'unsupported' || status === 'unavailable') return 'Shared content saved (document clipboard copy unsupported)';
  return 'Shared content saved';
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
    return getItemSortTimestamp(item) > getItemSortTimestamp(latest) ? item : latest;
  }, null);
}

async function handleSharedContent(items) {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('shared')) return;

  const sharedId = params.get('sharedId')?.trim() || '';
  const sharedItem = sharedId
    ? (items.find((item) => item.id === sharedId) || getLatestItem(items))
    : getLatestItem(items);
  const status = sharedItem
    ? await copyItemToClipboard(sharedItem, {
      textOptions: { toastEnabled: false },
      imageOptions: { toastEnabled: false },
      documentOptions: { toastEnabled: false },
      toastEnabled: false,
    })
    : 'empty';

  showToast(getSharedCopyToastMessage(status));

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

syncNowButton?.addEventListener('click', async () => {
  if (!appSettings.markdownSyncEnabled) {
    openSettingsModal();
    showToast('Enable Git sync in Settings first');
    return;
  }
  await runGitSync();
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

[markdownSyncEnabledInput, githubOwnerInput, githubRepoInput, githubBranchInput, githubTokenInput].forEach((field) => {
  field?.addEventListener('input', updateSyncControls);
  field?.addEventListener('change', updateSyncControls);
});

syncFromSettingsButton?.addEventListener('click', async () => {
  const draftSettings = normalizeGitHubSyncSettings({
    repoOwner: githubOwnerInput?.value,
    repoName: githubRepoInput?.value,
    branch: githubBranchInput?.value,
    token: githubTokenInput?.value,
  });
  appSettings = {
    ...appSettings,
    markdownSyncEnabled: Boolean(markdownSyncEnabledInput?.checked),
  };
  gitHubSyncSettings = draftSettings;
  saveSettings();
  saveGitHubSyncSettings();
  updateSyncControls();
  await runGitSync({ closeSettings: true });
});

settingsForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const nextAutoExpireMs = normalizeAutoExpireMs(expiryDurationSelect?.value);
  const nextMaxEntries = normalizeMaxEntries(maxEntriesInput?.value);
  const nextMarkdownSyncEnabled = Boolean(markdownSyncEnabledInput?.checked);
  const nextGitHubSyncSettings = normalizeGitHubSyncSettings({
    repoOwner: githubOwnerInput?.value,
    repoName: githubRepoInput?.value,
    branch: githubBranchInput?.value,
    token: githubTokenInput?.value,
  });
  appSettings = {
    ...appSettings,
    autoExpireMs: nextAutoExpireMs,
    maxEntries: nextMaxEntries,
    markdownSyncEnabled: nextMarkdownSyncEnabled,
  };
  gitHubSyncSettings = nextGitHubSyncSettings;
  saveSettings();
  saveGitHubSyncSettings();
  startAutoExpireTimer();
  const removedCountByExpiry = await pruneExpiredItems();
  const removedCountByLimit = await pruneItemsOverLimit();
  const removedCount = removedCountByExpiry + removedCountByLimit;
  await loadItems({ skipPrune: true });
  closeSettingsModal();
  lastSyncMessage = nextMarkdownSyncEnabled
    ? getSyncValidationResult().message
    : 'Git sync is off.';
  updateSyncControls();

  const autoClearLabel = nextAutoExpireMs === AUTO_EXPIRE_DISABLED_MS
    ? 'Off'
    : getAutoExpireLabel(nextAutoExpireMs);
  const maxEntriesLabel = getMaxEntriesLabel(nextMaxEntries);
  const gitSyncLabel = nextMarkdownSyncEnabled ? 'Git sync on' : 'Git sync off';
  if (removedCount > 0) {
    showToast(`Saved: auto-clear ${autoClearLabel}, max ${maxEntriesLabel}, ${gitSyncLabel}. Removed ${getClipCountLabel(removedCount)}.`);
    return;
  }
  showToast(`Saved: auto-clear ${autoClearLabel}, max ${maxEntriesLabel}, ${gitSyncLabel}.`);
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
  const items = [...selectedIds]
    .map((id) => itemsById.get(id))
    .filter(Boolean);
  if (!items.length) return;

  const texts = items
    .map((item) => buildClipboardText(item))
    .filter(Boolean);

  let status = 'empty';
  if (texts.length) {
    status = await copyToClipboard(texts.join('\n\n'));
  } else if (items.length === 1) {
    status = await copyItemToClipboard(items[0]);
  } else {
    showToast('Select a single file clip to copy its document');
  }

  if (status === 'copied' || status === 'copied-web') {
    exitSelectionMode();
  }
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

  if (fallbackStatus === 'empty' && downloadSingleSelectedFile(items)) {
    const file = items[0]?.files?.[0];
    const message = status === 'unsupported-files'
      ? (file && isPdfFile(file)
        ? 'Chrome on Android rejected this PDF share. Downloaded instead.'
        : file && !isChromiumWebShareFileType(file)
          ? (isOfficeDocumentFile(file)
            ? 'Chrome on Android cannot share DOCX and other Office files directly. Downloaded instead.'
            : 'Chrome on Android cannot share this file type directly. Downloaded instead.')
          : 'Chrome on Android rejected this file share. Downloaded instead.')
      : 'Downloaded file because sharing is unavailable.';
    exitSelectionMode();
    showToast(message);
    return;
  }

  if (fallbackStatus === 'empty') {
    showToast(selectionIncludesFiles(items)
      ? 'Document sharing unavailable on this device. Use download instead.'
      : 'Nothing shareable in selection');
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
syncViewportMetrics();
window.addEventListener('resize', syncSearchStickyOffset);
window.addEventListener('resize', syncViewportMetrics);
window.visualViewport?.addEventListener('resize', syncViewportMetrics);
window.visualViewport?.addEventListener('scroll', syncViewportMetrics);
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
        type: 'module',
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
