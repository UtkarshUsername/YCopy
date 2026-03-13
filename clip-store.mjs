export const DB_NAME = 'clip-vault';
export const LEGACY_STORE = 'items';
export const CLIPS_STORE = 'clips';
export const ASSETS_STORE = 'assets';
export const DB_VERSION = 2;
export const MARKDOWN_SYNC_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  autoExpireMs: 0,
  maxEntries: 0,
  markdownSyncEnabled: false,
  markdownExportRoot: 'clips',
  markdownNamingPattern: 'date-slug-id',
});

const EMPTY_META = Object.freeze({
  title: '',
  tags: [],
  sourceApp: '',
  sourceDevice: '',
  importedFrom: '',
});

const EMPTY_CAPTURE = Object.freeze({
  markdown: '',
  plainText: '',
  excerpt: '',
  capturedAt: null,
  captureSource: 'none',
});

const EMPTY_EXPORT_STATE = Object.freeze({
  slug: 'clip',
  relativePath: '',
  markdownHash: '',
  lastExportedAt: null,
  lastSyncedAt: null,
  syncStatus: 'pending',
  lastSyncError: '',
});

const MIME_TYPE_FILE_EXTENSIONS = Object.freeze({
  'application/msword': 'doc',
  'application/pdf': 'pdf',
  'application/rtf': 'rtf',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/csv': 'csv',
  'text/plain': 'txt',
});

/**
 * @typedef {Object} ClipRecord
 * @property {string} id
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {number|null} pinnedAt
 * @property {number|null} deletedAt
 * @property {string} text
 * @property {string} url
 * @property {string[]} fileIds
 * @property {{title: string, tags: string[], sourceApp: string, sourceDevice: string, importedFrom: string}} meta
 * @property {{markdown: string, plainText: string, excerpt: string, capturedAt: number|null, captureSource: 'none'|'manual'|'share_target'|'future_defuddle'}} capture
 * @property {{slug: string, relativePath: string, markdownHash: string, lastExportedAt: number|null, lastSyncedAt: number|null, syncStatus: 'pending'|'synced'|'modified'|'failed', lastSyncError: string}} exportState
 */

/**
 * @typedef {Object} AssetRecord
 * @property {string} id
 * @property {string} clipId
 * @property {number} createdAt
 * @property {string} name
 * @property {string} mimeType
 * @property {number} size
 * @property {Blob} blob
 * @property {string} sha256
 */

/**
 * @typedef {Object} AppSettings
 * @property {number} autoExpireMs
 * @property {number} maxEntries
 * @property {boolean} markdownSyncEnabled
 * @property {string} markdownExportRoot
 * @property {'date-slug-id'} markdownNamingPattern
 */

/**
 * @typedef {Object} MarkdownExport
 * @property {string} clipId
 * @property {string} relativePath
 * @property {string} content
 * @property {string} contentHash
 */

/**
 * @typedef {Object} ClipFrontmatter
 * @property {string} id
 * @property {string} created_at
 * @property {string} updated_at
 * @property {boolean} pinned
 * @property {string} source_url
 * @property {string} title
 * @property {string[]} tags
 * @property {boolean} has_text
 * @property {boolean} has_url
 * @property {boolean} has_files
 * @property {number} file_count
 * @property {string} capture_source
 * @property {number} sync_version
 * @property {string=} excerpt
 * @property {string=} source_app
 * @property {string=} source_device
 */

export function normalizeSettings(raw = {}) {
  const candidate = raw && typeof raw === 'object' ? raw : {};
  return {
    autoExpireMs: Number.isFinite(candidate.autoExpireMs) ? candidate.autoExpireMs : DEFAULT_SETTINGS.autoExpireMs,
    maxEntries: Number.isFinite(candidate.maxEntries) ? candidate.maxEntries : DEFAULT_SETTINGS.maxEntries,
    markdownSyncEnabled: Boolean(candidate.markdownSyncEnabled),
    markdownExportRoot: normalizeExportRoot(candidate.markdownExportRoot),
    markdownNamingPattern: candidate.markdownNamingPattern === 'date-slug-id'
      ? 'date-slug-id'
      : DEFAULT_SETTINGS.markdownNamingPattern,
  };
}

export function normalizeStoredText(value = '') {
  return normalizeMultilineText(value?.toString() || '');
}

export function normalizeStoredUrl(value = '') {
  return value?.toString().trim() || '';
}

export function normalizeShareUrlCandidate(value = '') {
  const raw = value?.toString().trim();
  if (!raw) return '';

  let candidate = raw
    .replace(/^<+/, '')
    .replace(/>+$/, '')
    .replace(/^"+/, '')
    .replace(/"+$/, '')
    .replace(/^'+/, '')
    .replace(/'+$/, '')
    .replace(/[)\]}>'".,!?;:]+$/g, '');

  if (/^www\./i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function appendExtensionFromMimeType(name = '', mimeType = '') {
  const normalizedName = name.toString().trim() || 'attachment';
  if (fileNameHasExtension(normalizedName)) return normalizedName;

  const normalizedMimeType = mimeType.toString().trim().toLowerCase();
  const extension = MIME_TYPE_FILE_EXTENSIONS[normalizedMimeType];
  if (!extension) return normalizedName;

  const baseName = normalizedName.replace(/\.+$/g, '') || 'attachment';
  return `${baseName}.${extension}`;
}

export function deriveCapturePlainText({
  text = '',
  captureMarkdown = '',
} = {}) {
  if (captureMarkdown) {
    return normalizeStoredText(stripMarkdown(captureMarkdown));
  }
  return normalizeStoredText(text);
}

export function deriveExcerpt({
  plainText = '',
  text = '',
  url = '',
} = {}) {
  const source = plainText || normalizeStoredText(text) || normalizeStoredUrl(url);
  if (!source) return '';
  return source
    .replace(/\r\n?/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function deriveSlug({
  title = '',
  text = '',
  url = '',
} = {}) {
  const titleCandidate = normalizeSimpleText(title);
  const textCandidate = getFirstNonEmptyLine(text);
  const urlCandidate = extractHostname(url);
  const source = titleCandidate || textCandidate || urlCandidate || 'clip';
  const asciiSource = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase();
  const slug = asciiSource
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48)
    .replace(/^-+|-+$/g, '');
  return slug || 'clip';
}

export function buildRelativePath({
  createdAt = Date.now(),
  slug = 'clip',
  clipId = createClipId(createdAt),
  root = DEFAULT_SETTINGS.markdownExportRoot,
} = {}) {
  const date = new Date(createdAt);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const normalizedRoot = normalizeExportRoot(root);
  return `${normalizedRoot}/${year}/${month}/${year}-${month}-${day}--${slug || 'clip'}--${clipId}.md`;
}

export function getContentDedupSignature({
  text = '',
  url = '',
  assets = [],
} = {}) {
  return JSON.stringify([
    normalizeStoredText(text),
    normalizeStoredUrl(url),
    assets.map((asset) => getAssetDedupSignature(asset)),
  ]);
}

export function hydrateClip(clip = {}, assets = []) {
  const normalizedAssets = assets.map(normalizeStoredAsset);
  return {
    ...stripHydratedClip(clip),
    assets: normalizedAssets,
    files: normalizedAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.mimeType,
      mimeType: asset.mimeType,
      size: asset.size,
      blob: asset.blob,
      sha256: asset.sha256,
    })),
  };
}

export function stripHydratedClip(clip = {}) {
  const {
    assets,
    files,
    ...rest
  } = clip || {};
  return {
    id: rest?.id?.toString().trim() || '',
    createdAt: normalizeTimestamp(rest.createdAt, Date.now()),
    updatedAt: normalizeTimestamp(rest.updatedAt, normalizeTimestamp(rest.createdAt, Date.now())),
    pinnedAt: normalizeNullableTimestamp(rest.pinnedAt),
    deletedAt: normalizeNullableTimestamp(rest.deletedAt),
    text: normalizeStoredText(rest.text),
    url: normalizeStoredUrl(rest.url),
    fileIds: normalizeFileIds(rest.fileIds),
    meta: normalizeMeta(rest.meta),
    capture: normalizeCapture(rest.capture, rest.text),
    exportState: normalizeExportState(rest.exportState),
  };
}

export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;

      if (!db.objectStoreNames.contains(CLIPS_STORE)) {
        db.createObjectStore(CLIPS_STORE, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        const assetStore = db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
        assetStore.createIndex('byClipId', 'clipId', { unique: false });
      }

      if (request.oldVersion >= 2 || !db.objectStoreNames.contains(LEGACY_STORE) || !tx) {
        return;
      }

      const legacyStore = tx.objectStore(LEGACY_STORE);
      const clipStore = tx.objectStore(CLIPS_STORE);
      const assetStore = tx.objectStore(ASSETS_STORE);
      const readLegacyRequest = legacyStore.getAll();

      readLegacyRequest.onsuccess = () => {
        const legacyItems = Array.isArray(readLegacyRequest.result) ? readLegacyRequest.result : [];
        legacyItems.forEach((legacyItem) => {
          const migrated = migrateLegacyItem(legacyItem);
          migrated.assets.forEach((asset) => assetStore.put(asset));
          clipStore.put(migrated.clip);
        });
      };
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveIncomingClip({
  text = '',
  url = '',
  files = [],
  createdAt = Date.now(),
  pinnedAt = null,
  captureSource = 'none',
  meta = {},
} = {}) {
  const normalizedText = normalizeStoredText(text);
  const normalizedUrl = normalizeStoredUrl(url);
  const normalizedFiles = normalizeIncomingFiles(files);
  const db = await openDb();
  const [clips, assets] = await Promise.all([
    getAllRecords(db, CLIPS_STORE),
    getAllRecords(db, ASSETS_STORE),
  ]);
  const assetsByClipId = groupAssetsByClipId(assets);

  const newAssetRecords = [];
  for (const file of normalizedFiles) {
    newAssetRecords.push(await createAssetRecord({
      clipId: '',
      createdAt,
      file,
    }));
  }

  const incomingSignature = getContentDedupSignature({
    text: normalizedText,
    url: normalizedUrl,
    assets: newAssetRecords,
  });

  const existingClip = clips.find((clip) => {
    if (isClipDeleted(clip)) return false;
    const clipAssets = assetsByClipId.get(clip.id) || [];
    return getContentDedupSignature({
      text: clip.text,
      url: clip.url,
      assets: clipAssets,
    }) === incomingSignature;
  });

  if (existingClip) {
    const existingAssets = assetsByClipId.get(existingClip.id) || [];
    const refreshedClip = await finalizeClipRecord({
      ...existingClip,
      text: normalizedText,
      url: normalizedUrl,
      updatedAt: createdAt,
      pinnedAt: existingClip.pinnedAt ? createdAt : existingClip.pinnedAt,
    }, existingAssets, { markDirty: true });
    await putClipAndAssets(db, refreshedClip, existingAssets);
    return {
      id: refreshedClip.id,
      deduplicated: true,
      createdAt: refreshedClip.createdAt,
    };
  }

  const clipId = createClipId(createdAt);
  const assetsForClip = newAssetRecords.map((asset) => ({
    ...asset,
    clipId,
  }));
  const clip = await finalizeClipRecord({
    id: clipId,
    createdAt,
    updatedAt: createdAt,
    pinnedAt: normalizeNullableTimestamp(pinnedAt),
    deletedAt: null,
    text: normalizedText,
    url: normalizedUrl,
    fileIds: assetsForClip.map((asset) => asset.id),
    meta: {
      ...meta,
      importedFrom: normalizeSimpleText(meta.importedFrom),
    },
    capture: {
      captureSource,
    },
    exportState: {},
  }, assetsForClip);

  await putClipAndAssets(db, clip, assetsForClip);

  return {
    id: clip.id,
    deduplicated: false,
    createdAt: clip.createdAt,
  };
}

export async function getClips({ includeDeleted = false } = {}) {
  const db = await openDb();
  const [clips, assets] = await Promise.all([
    getAllRecords(db, CLIPS_STORE),
    getAllRecords(db, ASSETS_STORE),
  ]);
  const assetsByClipId = groupAssetsByClipId(assets);
  return clips
    .filter((clip) => includeDeleted || !isClipDeleted(clip))
    .map((clip) => hydrateClip(clip, assetsByClipId.get(clip.id) || []));
}

export async function saveClipRecord(clipLike) {
  const db = await openDb();
  const clip = stripHydratedClip(clipLike);
  const assets = Array.isArray(clipLike?.assets)
    ? clipLike.assets.map(normalizeStoredAsset)
    : await getAssetsForClipIds(db, clip.fileIds);
  const finalized = await finalizeClipRecord({
    ...clip,
    updatedAt: normalizeTimestamp(clipLike?.updatedAt, Date.now()),
  }, assets, { markDirty: true });
  await putClipAndAssets(db, finalized, assets);
  return hydrateClip(finalized, assets);
}

export async function deleteClips(ids = []) {
  const normalizedIds = ids
    .map((id) => id?.toString().trim())
    .filter(Boolean);
  if (!normalizedIds.length) return 0;

  const db = await openDb();
  const clips = await getAllRecords(db, CLIPS_STORE);
  const clipMap = new Map(clips.map((clip) => [clip.id, clip]));
  const assets = await getAllRecords(db, ASSETS_STORE);
  const assetsByClipId = groupAssetsByClipId(assets);
  const deletedAt = Date.now();
  const clipsToUpdate = normalizedIds
    .map((id) => clipMap.get(id))
    .filter((clip) => clip && !isClipDeleted(clip))
    .map((clip) => markClipDeleted(clip, assetsByClipId.get(clip.id) || [], deletedAt));

  if (!clipsToUpdate.length) return 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, 'readwrite');
    const store = tx.objectStore(CLIPS_STORE);
    clipsToUpdate.forEach((clip) => {
      store.put(stripHydratedClip(clip));
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return clipsToUpdate.length;
}

export async function clearAllClips() {
  const clips = await getClips();
  return deleteClips(clips.map((clip) => clip.id));
}

export async function repairStoredData() {
  const db = await openDb();
  const [clips, assets] = await Promise.all([
    getAllRecords(db, CLIPS_STORE),
    getAllRecords(db, ASSETS_STORE),
  ]);
  if (!clips.length && !assets.length) return { repairedClips: 0, repairedAssets: 0 };

  const repairedAssets = [];
  for (const asset of assets) {
    if (asset.sha256 || !(asset.blob instanceof Blob)) continue;
    repairedAssets.push({
      ...asset,
      sha256: await sha256HexFromBlob(asset.blob),
    });
  }

  const assetOverrides = new Map(repairedAssets.map((asset) => [asset.id, asset]));
  const assetsByClipId = groupAssetsByClipId(assets.map((asset) => assetOverrides.get(asset.id) || asset));
  const repairedClips = [];

  for (const clip of clips) {
    const clipAssets = assetsByClipId.get(clip.id) || [];
    const needsDerivedRepair = !clip?.capture?.plainText
      || !clip?.capture?.excerpt
      || !clip?.exportState?.slug
      || !clip?.exportState?.relativePath
      || (!isClipDeleted(clip) && !clip?.exportState?.markdownHash);

    if (!needsDerivedRepair) continue;
    repairedClips.push(await finalizeClipRecord(clip, clipAssets, { preserveSyncState: true }));
  }

  if (!repairedAssets.length && !repairedClips.length) {
    return { repairedClips: 0, repairedAssets: 0 };
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction([CLIPS_STORE, ASSETS_STORE], 'readwrite');
    const clipStore = tx.objectStore(CLIPS_STORE);
    const assetStore = tx.objectStore(ASSETS_STORE);
    repairedAssets.forEach((asset) => assetStore.put(asset));
    repairedClips.forEach((clip) => clipStore.put(stripHydratedClip(clip)));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return {
    repairedClips: repairedClips.length,
    repairedAssets: repairedAssets.length,
  };
}

export async function createAssetRecord({
  clipId,
  createdAt = Date.now(),
  file,
  id = createAssetId(createdAt),
} = {}) {
  const normalizedFile = normalizeIncomingFile(file);
  const blob = normalizedFile.blob;
  const sha256 = blob instanceof Blob ? await sha256HexFromBlob(blob) : '';
  return {
    id,
    clipId: clipId?.toString().trim() || '',
    createdAt: normalizeTimestamp(createdAt, Date.now()),
    name: normalizedFile.name,
    mimeType: normalizedFile.mimeType,
    size: normalizedFile.size,
    blob,
    sha256,
  };
}

export function migrateLegacyItem(legacyItem = {}) {
  const createdAt = normalizeTimestamp(legacyItem.createdAt, Date.now());
  const clipId = createClipId(createdAt);
  const legacyFiles = normalizeLegacyFiles(legacyItem.files);
  const assets = legacyFiles.map((file, index) => ({
    id: createAssetId(createdAt + index),
    clipId,
    createdAt,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    blob: file.blob,
    sha256: '',
  }));
  const clip = createMigratedClipRecord({
    id: clipId,
    createdAt,
    pinnedAt: normalizeNullableTimestamp(legacyItem.pinnedAt),
    text: normalizeStoredText(legacyItem.text),
    url: normalizeStoredUrl(legacyItem.url),
    fileIds: assets.map((asset) => asset.id),
    captureSource: legacyFiles.length ? 'share_target' : 'none',
  });

  return { clip, assets };
}

export function createMigratedClipRecord({
  id,
  createdAt,
  pinnedAt = null,
  text = '',
  url = '',
  fileIds = [],
  captureSource = 'none',
} = {}) {
  const normalizedText = normalizeStoredText(text);
  const normalizedUrl = normalizeStoredUrl(url);
  const capturePlainText = deriveCapturePlainText({
    text: normalizedText,
    captureMarkdown: '',
  });
  const excerpt = deriveExcerpt({
    plainText: capturePlainText,
    text: normalizedText,
    url: normalizedUrl,
  });
  const slug = deriveSlug({
    title: '',
    text: normalizedText,
    url: normalizedUrl,
  });
  return {
    id: id?.toString().trim() || createClipId(createdAt),
    createdAt: normalizeTimestamp(createdAt, Date.now()),
    updatedAt: normalizeTimestamp(createdAt, Date.now()),
    pinnedAt: normalizeNullableTimestamp(pinnedAt),
    deletedAt: null,
    text: normalizedText,
    url: normalizedUrl,
    fileIds: normalizeFileIds(fileIds),
    meta: {
      ...EMPTY_META,
      importedFrom: 'legacy_v1',
    },
    capture: {
      ...EMPTY_CAPTURE,
      plainText: capturePlainText,
      excerpt,
      captureSource,
    },
    exportState: {
      ...EMPTY_EXPORT_STATE,
      slug,
      relativePath: buildRelativePath({
        createdAt,
        slug,
        clipId: id,
      }),
    },
  };
}

export async function finalizeClipRecord(clipLike = {}, assets = [], options = {}) {
  const now = Date.now();
  const clipId = clipLike?.id?.toString().trim() || createClipId(now);
  const createdAt = normalizeTimestamp(clipLike.createdAt, now);
  const updatedAt = normalizeTimestamp(clipLike.updatedAt, createdAt);
  const pinnedAt = normalizeNullableTimestamp(clipLike.pinnedAt);
  const deletedAt = normalizeNullableTimestamp(clipLike.deletedAt);
  const text = normalizeStoredText(clipLike.text);
  const url = normalizeStoredUrl(clipLike.url);
  const normalizedAssets = assets.map(normalizeStoredAsset);
  const fileIds = normalizedAssets.map((asset) => asset.id);
  const meta = normalizeMeta(clipLike.meta);
  const capture = normalizeCapture({
    ...clipLike.capture,
    captureSource: clipLike?.capture?.captureSource || EMPTY_CAPTURE.captureSource,
  }, text);
  const slug = deriveSlug({
    title: meta.title,
    text,
    url,
  });
  const relativePath = buildRelativePath({
    createdAt,
    slug,
    clipId,
  });
  const existingExportState = normalizeExportState(clipLike.exportState);
  let markdownHash = existingExportState.markdownHash;

  if (!deletedAt || options.recomputeDeletedMarkdown === true) {
    const markdownExport = await buildMarkdownExport({
      id: clipId,
      createdAt,
      updatedAt,
      pinnedAt,
      deletedAt,
      text,
      url,
      fileIds,
      meta,
      capture,
      exportState: {
        ...existingExportState,
        slug,
        relativePath,
      },
    }, normalizedAssets);
    markdownHash = markdownExport.contentHash;
  }

  const exportState = {
    ...existingExportState,
    slug,
    relativePath,
    markdownHash,
  };

  const normalizedClip = {
    id: clipId,
    createdAt,
    updatedAt,
    pinnedAt,
    deletedAt,
    text,
    url,
    fileIds,
    meta,
    capture,
    exportState: options.preserveSyncState
      ? exportState
      : options.markDirty
        ? markExportStateDirty(exportState)
        : exportState.syncStatus
          ? exportState
          : { ...exportState, syncStatus: 'pending' },
  };

  if (!normalizedClip.exportState.syncStatus) {
    normalizedClip.exportState.syncStatus = 'pending';
  }
  if (normalizedClip.exportState.lastSyncError === undefined) {
    normalizedClip.exportState.lastSyncError = '';
  }

  return normalizedClip;
}

export function createClipFrontmatter(clipLike = {}, assets = []) {
  const clip = stripHydratedClip(clipLike);
  const normalizedAssets = assets.map(normalizeStoredAsset);
  const frontmatter = {
    id: clip.id,
    created_at: formatTimestampWithOffset(clip.createdAt),
    updated_at: formatTimestampWithOffset(clip.updatedAt),
    pinned: Boolean(clip.pinnedAt),
    source_url: clip.url || '',
    title: clip?.meta?.title || '',
    tags: Array.isArray(clip?.meta?.tags) ? clip.meta.tags : [],
    has_text: Boolean(clip.text),
    has_url: Boolean(clip.url),
    has_files: normalizedAssets.length > 0,
    file_count: normalizedAssets.length,
    capture_source: clip?.capture?.captureSource || 'none',
    sync_version: MARKDOWN_SYNC_VERSION,
  };

  const excerpt = clip?.capture?.excerpt || deriveExcerpt({
    plainText: clip?.capture?.plainText,
    text: clip.text,
    url: clip.url,
  });
  if (excerpt) {
    frontmatter.excerpt = excerpt;
  }
  if (clip?.meta?.sourceApp) {
    frontmatter.source_app = clip.meta.sourceApp;
  }
  if (clip?.meta?.sourceDevice) {
    frontmatter.source_device = clip.meta.sourceDevice;
  }

  return frontmatter;
}

export async function buildMarkdownExport(clipLike = {}, assets = []) {
  const clip = stripHydratedClip(clipLike);
  const normalizedAssets = assets.map(normalizeStoredAsset);
  const frontmatter = createClipFrontmatter(clip, normalizedAssets);
  const sections = [];

  if (clip.text) {
    sections.push(`## Text\n\n${clip.text}`);
  }

  if (clip.url) {
    sections.push(`## URL\n\n${clip.url}`);
  }

  if (clip?.capture?.markdown) {
    sections.push(`## Captured Content\n\n${clip.capture.markdown}`);
  }

  if (normalizedAssets.length) {
    const attachmentLines = normalizedAssets.map((asset) => {
      const mimeType = asset.mimeType || 'application/octet-stream';
      return `- ${asset.name} (\`${mimeType}\`, ${asset.size} bytes)`;
    });
    sections.push(`## Attachments\n\n${attachmentLines.join('\n')}`);
  }

  const frontmatterLines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${formatYamlValue(value)}`);
  const body = sections.join('\n\n');
  const content = body
    ? `---\n${frontmatterLines.join('\n')}\n---\n\n${body}`
    : `---\n${frontmatterLines.join('\n')}\n---\n`;

  return {
    clipId: clip.id,
    relativePath: clip?.exportState?.relativePath || buildRelativePath({
      createdAt: clip.createdAt,
      slug: deriveSlug({ title: clip?.meta?.title, text: clip.text, url: clip.url }),
      clipId: clip.id,
    }),
    content,
    contentHash: await sha256HexFromText(content),
  };
}

function normalizeIncomingFiles(files) {
  return Array.isArray(files)
    ? files.map(normalizeIncomingFile).filter(Boolean)
    : [];
}

function normalizeIncomingFile(file = {}) {
  if (!file) return null;
  const blob = file.blob instanceof Blob ? file.blob : file instanceof Blob ? file : null;
  const mimeType = normalizeSimpleText(file.mimeType || file.type || blob?.type || '') || 'application/octet-stream';
  const name = appendExtensionFromMimeType(file.name || 'attachment', mimeType);
  const size = Number.isFinite(file.size) ? file.size : Number.isFinite(blob?.size) ? blob.size : 0;
  return {
    name,
    mimeType,
    size,
    blob,
  };
}

function normalizeLegacyFiles(files) {
  return Array.isArray(files)
    ? files.map((file) => normalizeIncomingFile({
      name: file?.name,
      mimeType: file?.type || file?.mimeType,
      size: file?.size,
      blob: file?.blob instanceof Blob ? file.blob : null,
    })).filter(Boolean)
    : [];
}

function normalizeStoredAsset(asset = {}) {
  const blob = asset.blob instanceof Blob ? asset.blob : null;
  return {
    id: asset?.id?.toString().trim() || createAssetId(),
    clipId: asset?.clipId?.toString().trim() || '',
    createdAt: normalizeTimestamp(asset.createdAt, Date.now()),
    name: normalizeSimpleText(asset.name) || 'attachment',
    mimeType: normalizeSimpleText(asset.mimeType || asset.type || blob?.type || '') || 'application/octet-stream',
    size: Number.isFinite(asset.size) ? asset.size : Number.isFinite(blob?.size) ? blob.size : 0,
    blob,
    sha256: normalizeSimpleText(asset.sha256),
  };
}

function normalizeMeta(meta = {}) {
  const candidate = meta && typeof meta === 'object' ? meta : {};
  return {
    title: normalizeSimpleText(candidate.title),
    tags: normalizeTags(candidate.tags),
    sourceApp: normalizeSimpleText(candidate.sourceApp),
    sourceDevice: normalizeSimpleText(candidate.sourceDevice),
    importedFrom: normalizeSimpleText(candidate.importedFrom),
  };
}

function normalizeCapture(capture = {}, fallbackText = '') {
  const candidate = capture && typeof capture === 'object' ? capture : {};
  const markdown = normalizeMultilineText(candidate.markdown || '');
  const plainText = deriveCapturePlainText({
    text: fallbackText,
    captureMarkdown: markdown,
  });
  return {
    markdown,
    plainText,
    excerpt: deriveExcerpt({
      plainText,
      text: fallbackText,
    }),
    capturedAt: normalizeNullableTimestamp(candidate.capturedAt),
    captureSource: normalizeCaptureSource(candidate.captureSource),
  };
}

function normalizeExportState(exportState = {}) {
  const candidate = exportState && typeof exportState === 'object' ? exportState : {};
  const syncStatus = ['pending', 'synced', 'modified', 'failed'].includes(candidate.syncStatus)
    ? candidate.syncStatus
    : 'pending';
  return {
    slug: normalizeSimpleText(candidate.slug) || EMPTY_EXPORT_STATE.slug,
    relativePath: normalizeRelativePath(candidate.relativePath),
    markdownHash: normalizeSimpleText(candidate.markdownHash),
    lastExportedAt: normalizeNullableTimestamp(candidate.lastExportedAt),
    lastSyncedAt: normalizeNullableTimestamp(candidate.lastSyncedAt),
    syncStatus,
    lastSyncError: normalizeSimpleText(candidate.lastSyncError),
  };
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((tag) => normalizeSimpleText(tag)).filter(Boolean))];
}

function normalizeCaptureSource(value) {
  return ['none', 'manual', 'share_target', 'future_defuddle'].includes(value)
    ? value
    : 'none';
}

function normalizeMultilineText(value = '') {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

function normalizeSimpleText(value = '') {
  return value?.toString().trim() || '';
}

function normalizeExportRoot(value = DEFAULT_SETTINGS.markdownExportRoot) {
  const normalized = value?.toString().trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized || DEFAULT_SETTINGS.markdownExportRoot;
}

function normalizeRelativePath(value = '') {
  return value?.toString().trim().replace(/\\/g, '/').replace(/^\/+/, '') || '';
}

function normalizeFileIds(fileIds) {
  return Array.isArray(fileIds)
    ? fileIds.map((id) => id?.toString().trim()).filter(Boolean)
    : [];
}

function normalizeTimestamp(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeNullableTimestamp(value) {
  return Number.isFinite(value) ? value : null;
}

function fileNameHasExtension(name = '') {
  const trimmedName = name.toString().trim();
  if (!trimmedName) return false;
  const lastDot = trimmedName.lastIndexOf('.');
  return lastDot > 0 && lastDot < trimmedName.length - 1;
}

function getAssetDedupSignature(asset = {}) {
  const normalizedAsset = normalizeStoredAsset(asset);
  return JSON.stringify([
    normalizedAsset.name,
    normalizedAsset.mimeType,
    normalizedAsset.size,
    normalizedAsset.sha256 || '',
  ]);
}

function getAllRecords(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error);
  });
}

function getAssetsForClipIds(db, fileIds = []) {
  if (!fileIds.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readonly');
    const store = tx.objectStore(ASSETS_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const wantedIds = new Set(normalizeFileIds(fileIds));
      const assets = (request.result || [])
        .filter((asset) => wantedIds.has(asset.id))
        .map(normalizeStoredAsset)
        .sort((a, b) => fileIds.indexOf(a.id) - fileIds.indexOf(b.id));
      resolve(assets);
    };
    request.onerror = () => reject(request.error);
  });
}

function groupAssetsByClipId(assets = []) {
  const assetsByClipId = new Map();
  assets.forEach((asset) => {
    const normalizedAsset = normalizeStoredAsset(asset);
    const clipAssets = assetsByClipId.get(normalizedAsset.clipId) || [];
    clipAssets.push(normalizedAsset);
    assetsByClipId.set(normalizedAsset.clipId, clipAssets);
  });
  return assetsByClipId;
}

function putClipAndAssets(db, clip, assets = []) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CLIPS_STORE, ASSETS_STORE], 'readwrite');
    const clipStore = tx.objectStore(CLIPS_STORE);
    const assetStore = tx.objectStore(ASSETS_STORE);
    assets.forEach((asset) => assetStore.put(normalizeStoredAsset(asset)));
    clipStore.put(stripHydratedClip(clip));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function markClipDeleted(clipLike, assets = [], deletedAt = Date.now()) {
  const clip = stripHydratedClip(clipLike);
  return {
    ...clip,
    updatedAt: deletedAt,
    deletedAt,
    exportState: markExportStateDirty({
      ...normalizeExportState(clip.exportState),
      relativePath: clip.exportState.relativePath || buildRelativePath({
        createdAt: clip.createdAt,
        slug: clip.exportState.slug || deriveSlug({
          title: clip.meta.title,
          text: clip.text,
          url: clip.url,
        }),
        clipId: clip.id,
      }),
      markdownHash: clip.exportState.markdownHash || '',
    }),
    assets,
  };
}

function markExportStateDirty(exportState = {}) {
  const normalized = normalizeExportState(exportState);
  return {
    ...normalized,
    syncStatus: normalized.lastSyncedAt ? 'modified' : 'pending',
    lastSyncError: '',
  };
}

function isClipDeleted(clip) {
  return Number.isFinite(clip?.deletedAt) && clip.deletedAt > 0;
}

function getFirstNonEmptyLine(text = '') {
  return normalizeStoredText(text)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function extractHostname(url = '') {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function stripMarkdown(markdown = '') {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\r\n?/g, '\n');
}

function createClipId(timestamp = Date.now()) {
  return `clip_${timestamp.toString(36)}_${randomIdChunk()}`;
}

function createAssetId(timestamp = Date.now()) {
  return `asset_${timestamp.toString(36)}_${randomIdChunk()}`;
}

function randomIdChunk() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  const randomValue = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  return randomValue.toString(36).slice(0, 12);
}

async function sha256HexFromBlob(blob) {
  if (!(blob instanceof Blob)) return '';
  const buffer = await blob.arrayBuffer();
  return sha256Hex(buffer);
}

async function sha256HexFromText(text = '') {
  return sha256Hex(new TextEncoder().encode(text));
}

async function sha256Hex(data) {
  if (!globalThis.crypto?.subtle) return '';
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function formatTimestampWithOffset(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainder}`;
}

function formatYamlValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatYamlScalar(entry)).join(', ')}]`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  return formatYamlScalar(value);
}

function formatYamlScalar(value) {
  return JSON.stringify(value ?? '');
}
