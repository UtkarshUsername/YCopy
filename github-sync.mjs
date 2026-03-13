import { buildMarkdownExport } from './clip-store.mjs';

export const DEFAULT_GITHUB_SYNC_SETTINGS = Object.freeze({
  repoOwner: '',
  repoName: '',
  branch: 'main',
  token: '',
});

export function normalizeGitHubSyncSettings(raw = {}) {
  const candidate = raw && typeof raw === 'object' ? raw : {};
  return {
    repoOwner: normalizeText(candidate.repoOwner),
    repoName: normalizeText(candidate.repoName),
    branch: normalizeText(candidate.branch) || DEFAULT_GITHUB_SYNC_SETTINGS.branch,
    token: normalizeText(candidate.token),
  };
}

export function validateGitHubSyncSettings(raw = {}) {
  const settings = normalizeGitHubSyncSettings(raw);
  const errors = [];

  if (!settings.repoOwner) errors.push('GitHub owner is required');
  if (!settings.repoName) errors.push('GitHub repository is required');
  if (!settings.branch) errors.push('GitHub branch is required');
  if (!settings.token) errors.push('GitHub token is required');

  return {
    settings,
    errors,
    isValid: errors.length === 0,
  };
}

export async function planGitHubMarkdownSync({
  clips = [],
  remoteFiles = new Map(),
} = {}) {
  const additions = [];
  const deletions = new Map();
  const liveClips = [];
  const deletedClips = [];
  const resolvedDeletedClips = [];

  for (const clip of clips) {
    const isDeleted = Number.isFinite(clip?.deletedAt) && clip.deletedAt > 0;
    if (isDeleted) {
      const existingPath = clip?.exportState?.relativePath || '';
      if (existingPath && remoteFiles.has(existingPath)) {
        deletions.set(existingPath, { path: existingPath, clip });
        deletedClips.push(clip);
      } else if (clip?.exportState?.syncStatus !== 'synced' || !clip?.exportState?.lastSyncedAt) {
        resolvedDeletedClips.push(clip);
      }
      continue;
    }

    const markdownExport = await buildMarkdownExport(clip, clip.assets || []);
    const existingPath = clip?.exportState?.relativePath || '';
    const remoteHasExportPath = remoteFiles.has(markdownExport.relativePath);
    const isDirty = clip?.exportState?.syncStatus !== 'synced'
      || clip?.exportState?.markdownHash !== markdownExport.contentHash
      || existingPath !== markdownExport.relativePath
      || !clip?.exportState?.lastSyncedAt
      || !remoteHasExportPath;

    if (!isDirty) continue;

    additions.push({
      path: markdownExport.relativePath,
      contents: markdownExport.content,
      clip,
      markdownExport,
    });
    liveClips.push({ clip, markdownExport });

    if (
      existingPath
      && existingPath !== markdownExport.relativePath
      && remoteFiles.has(existingPath)
    ) {
      deletions.set(existingPath, { path: existingPath, clip });
    }
  }

  return {
    additions,
    deletions: [...deletions.values()],
    liveClips,
    deletedClips,
    resolvedDeletedClips,
  };
}

export async function syncClipsToGitHub({
  config,
  clips = [],
  persistClip,
  fetchImpl = fetch,
} = {}) {
  const validation = validateGitHubSyncSettings(config);
  if (!validation.isValid) {
    throw new Error(validation.errors[0]);
  }
  if (typeof persistClip !== 'function') {
    throw new Error('persistClip is required');
  }

  const settings = validation.settings;
  const syncedAt = Date.now();
  const remoteHead = await fetchGitHubBranchHead(settings, fetchImpl);
  const remoteFiles = await fetchGitHubTree(settings, fetchImpl);
  const plan = await planGitHubMarkdownSync({
    clips,
    remoteFiles,
  });

  if (!plan.additions.length && !plan.deletions.length) {
    for (const clip of plan.resolvedDeletedClips) {
      await persistClip(createDeletedSyncedClip(clip, syncedAt));
    }
    return {
      status: 'noop',
      additions: 0,
      deletions: 0,
      commitUrl: '',
      syncedAt: plan.resolvedDeletedClips.length ? syncedAt : null,
    };
  }

  const additionsPayload = plan.additions.map((entry) => ({
    path: entry.path,
    contents: toBase64(entry.contents),
  }));
  const deletionsPayload = plan.deletions.map((entry) => ({
    path: entry.path,
  }));

  try {
    const commit = await createGitHubCommit({
      settings,
      expectedHeadOid: remoteHead,
      additions: additionsPayload,
      deletions: deletionsPayload,
      fetchImpl,
    });

    for (const entry of plan.liveClips) {
      await persistClip(createSyncedClip(entry.clip, entry.markdownExport, syncedAt));
    }

    for (const clip of plan.deletedClips) {
      await persistClip(createDeletedSyncedClip(clip, syncedAt));
    }
    for (const clip of plan.resolvedDeletedClips) {
      await persistClip(createDeletedSyncedClip(clip, syncedAt));
    }

    return {
      status: 'synced',
      additions: plan.additions.length,
      deletions: plan.deletions.length,
      commitUrl: commit.url || '',
      syncedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Git sync failed';
    for (const entry of plan.liveClips) {
      await persistClip(createFailedClip(entry.clip, message));
    }
    for (const clip of plan.deletedClips) {
      await persistClip(createFailedClip(clip, message));
    }
    throw error;
  }
}

async function fetchGitHubBranchHead(settings, fetchImpl) {
  const ref = await requestGitHubJson(
    settings,
    `/repos/${encodeURIComponent(settings.repoOwner)}/${encodeURIComponent(settings.repoName)}/git/ref/heads/${encodeURIComponent(settings.branch)}`,
    {
      fetchImpl,
    },
  );
  return normalizeText(ref?.object?.sha);
}

async function fetchGitHubTree(settings, fetchImpl) {
  const tree = await requestGitHubJson(
    settings,
    `/repos/${encodeURIComponent(settings.repoOwner)}/${encodeURIComponent(settings.repoName)}/git/trees/${encodeURIComponent(settings.branch)}?recursive=1`,
    {
      fetchImpl,
    },
  );

  if (tree?.truncated) {
    throw new Error('Repository tree is too large for the current sync implementation');
  }

  return new Map(
    (Array.isArray(tree?.tree) ? tree.tree : [])
      .filter((entry) => entry?.type === 'blob' && typeof entry?.path === 'string' && entry.path.endsWith('.md'))
      .map((entry) => [entry.path, entry]),
  );
}

async function createGitHubCommit({
  settings,
  expectedHeadOid,
  additions,
  deletions,
  fetchImpl,
} = {}) {
  const mutation = `
    mutation CreateCommitOnBranch($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) {
        commit {
          oid
          url
        }
      }
    }
  `;
  const response = await requestGitHubGraphQL(
    settings,
    mutation,
    {
      input: {
        branch: {
          repositoryNameWithOwner: `${settings.repoOwner}/${settings.repoName}`,
          branchName: settings.branch,
        },
        message: {
          headline: buildCommitHeadline({ additions, deletions }),
        },
        expectedHeadOid,
        fileChanges: {
          additions,
          deletions,
        },
      },
    },
    fetchImpl,
  );

  return response?.createCommitOnBranch?.commit || {};
}

async function requestGitHubJson(settings, path, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    headers: buildGitHubHeaders(settings.token),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `GitHub request failed (${response.status})`);
  }
  return payload;
}

async function requestGitHubGraphQL(settings, query, variables, fetchImpl = fetch) {
  const response = await fetchImpl('https://api.github.com/graphql', {
    method: 'POST',
    headers: buildGitHubHeaders(settings.token, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      query,
      variables,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `GitHub GraphQL request failed (${response.status})`);
  }
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(payload.errors[0]?.message || 'GitHub GraphQL mutation failed');
  }
  return payload?.data || {};
}

function buildGitHubHeaders(token, extraHeaders = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...extraHeaders,
  };
}

function buildCommitHeadline({ additions = [], deletions = [] } = {}) {
  const changeCount = additions.length + deletions.length;
  return changeCount === 1
    ? 'Sync 1 YCopy clip'
    : `Sync ${changeCount} YCopy clip changes`;
}

function createSyncedClip(clip, markdownExport, syncedAt) {
  return {
    ...clip,
    exportState: {
      ...clip.exportState,
      relativePath: markdownExport.relativePath,
      markdownHash: markdownExport.contentHash,
      lastExportedAt: syncedAt,
      lastSyncedAt: syncedAt,
      syncStatus: 'synced',
      lastSyncError: '',
    },
  };
}

function createDeletedSyncedClip(clip, syncedAt) {
  return {
    ...clip,
    exportState: {
      ...clip.exportState,
      lastSyncedAt: syncedAt,
      syncStatus: 'synced',
      lastSyncError: '',
    },
  };
}

function createFailedClip(clip, message) {
  return {
    ...clip,
    exportState: {
      ...clip.exportState,
      syncStatus: 'failed',
      lastSyncError: message,
    },
  };
}

function toBase64(value = '') {
  if (typeof Buffer === 'function') {
    return Buffer.from(value, 'utf8').toString('base64');
  }

  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function normalizeText(value = '') {
  return value?.toString().trim() || '';
}
