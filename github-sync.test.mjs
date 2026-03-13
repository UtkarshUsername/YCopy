import test from 'node:test';
import assert from 'node:assert/strict';

import { finalizeClipRecord } from './clip-store.mjs';
import {
  normalizeGitHubSyncSettings,
  planGitHubMarkdownSync,
  syncClipsToGitHub,
  validateGitHubSyncSettings,
} from './github-sync.mjs';

test('validates and normalizes GitHub sync settings', () => {
  const normalized = normalizeGitHubSyncSettings({
    repoOwner: '  utkarsh  ',
    repoName: ' YCopy ',
    branch: '',
    token: ' token ',
  });

  assert.deepEqual(normalized, {
    repoOwner: 'utkarsh',
    repoName: 'YCopy',
    branch: 'main',
    token: 'token',
  });
  assert.equal(validateGitHubSyncSettings({}).isValid, false);
  assert.equal(validateGitHubSyncSettings(normalized).isValid, true);
});

test('plans additions for dirty clips and deletions for tombstones', async () => {
  const syncedClip = await finalizeClipRecord({
    id: 'clip_live',
    createdAt: 1741867200000,
    updatedAt: 1741867200000,
    text: 'Hello world',
    url: '',
    fileIds: [],
    meta: { title: '', tags: [], sourceApp: '', sourceDevice: '', importedFrom: '' },
    capture: { markdown: '', captureSource: 'manual' },
    exportState: {
      syncStatus: 'modified',
      relativePath: 'clips/2025/03/2025-03-13--old-path--clip_live.md',
      markdownHash: 'oldhash',
    },
  }, []);

  const deletedClip = {
    ...syncedClip,
    id: 'clip_deleted',
    deletedAt: 1741867300000,
    exportState: {
      ...syncedClip.exportState,
      relativePath: 'clips/2025/03/2025-03-13--deleted--clip_deleted.md',
    },
  };

  const plan = await planGitHubMarkdownSync({
    clips: [syncedClip, deletedClip],
    remoteFiles: new Map([
      [syncedClip.exportState.relativePath, { path: syncedClip.exportState.relativePath }],
      [deletedClip.exportState.relativePath, { path: deletedClip.exportState.relativePath }],
    ]),
  });

  assert.equal(plan.additions.length, 1);
  assert.equal(plan.deletions.length, 1);
  assert.equal(plan.additions[0].clip.id, 'clip_live');
  assert.equal(plan.deletedClips.length, 1);
});

test('syncs dirty clips to GitHub and persists synced state', async () => {
  const clip = await finalizeClipRecord({
    id: 'clip_sync',
    createdAt: 1741867200000,
    updatedAt: 1741867200000,
    text: 'Ship it',
    url: 'https://example.com',
    fileIds: [],
    meta: { title: '', tags: [], sourceApp: '', sourceDevice: '', importedFrom: '' },
    capture: { markdown: '', captureSource: 'manual' },
    exportState: {
      syncStatus: 'pending',
    },
  }, []);

  const persisted = [];
  const fetchCalls = [];
  const fetchImpl = async (url, options = {}) => {
    fetchCalls.push({ url, options });

    if (url.includes('/git/ref/heads/')) {
      return {
        ok: true,
        json: async () => ({ object: { sha: 'head_sha' } }),
      };
    }

    if (url.includes('/git/trees/')) {
      return {
        ok: true,
        json: async () => ({ truncated: false, tree: [] }),
      };
    }

    if (url.endsWith('/graphql')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            createCommitOnBranch: {
              commit: {
                oid: 'commit_sha',
                url: 'https://github.com/example/repo/commit/commit_sha',
              },
            },
          },
        }),
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const result = await syncClipsToGitHub({
    config: {
      repoOwner: 'example',
      repoName: 'repo',
      branch: 'main',
      token: 'ghp_test',
    },
    clips: [clip],
    persistClip: async (nextClip) => {
      persisted.push(nextClip);
      return nextClip;
    },
    fetchImpl,
  });

  assert.equal(result.status, 'synced');
  assert.equal(result.additions, 1);
  assert.equal(result.deletions, 0);
  assert.equal(fetchCalls.length, 3);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].exportState.syncStatus, 'synced');
  assert.ok(Number.isFinite(persisted[0].exportState.lastSyncedAt));
});
