import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarkdownExport,
  deriveSlug,
  finalizeClipRecord,
  migrateLegacyItem,
} from './clip-store.mjs';

test('migrates a text-only legacy clip into the v2 clip shape', () => {
  const { clip, assets } = migrateLegacyItem({
    id: 1,
    text: 'Legacy note',
    url: '',
    files: [],
    createdAt: 1710000000000,
    pinnedAt: null,
  });

  assert.match(clip.id, /^clip_/);
  assert.equal(clip.createdAt, 1710000000000);
  assert.equal(clip.updatedAt, 1710000000000);
  assert.equal(clip.meta.importedFrom, 'legacy_v1');
  assert.equal(clip.capture.plainText, 'Legacy note');
  assert.equal(clip.capture.excerpt, 'Legacy note');
  assert.equal(clip.exportState.syncStatus, 'pending');
  assert.equal(clip.exportState.markdownHash, '');
  assert.match(clip.exportState.relativePath, /^clips\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}--legacy-note--clip_/);
  assert.deepEqual(assets, []);
});

test('migrates embedded legacy files into the assets store', () => {
  const fileBlob = new Blob(['legacy file'], { type: 'text/plain' });
  const { clip, assets } = migrateLegacyItem({
    id: 2,
    text: '',
    url: 'https://example.com',
    createdAt: 1710000001000,
    pinnedAt: 1710000002000,
    files: [
      {
        name: 'note',
        type: 'text/plain',
        blob: fileBlob,
      },
    ],
  });

  assert.equal(assets.length, 1);
  assert.equal(clip.fileIds.length, 1);
  assert.equal(clip.fileIds[0], assets[0].id);
  assert.equal(assets[0].clipId, clip.id);
  assert.equal(assets[0].name, 'note.txt');
  assert.equal(assets[0].mimeType, 'text/plain');
  assert.equal(assets[0].size, fileBlob.size);
  assert.equal(clip.capture.captureSource, 'share_target');
});

test('exports frontmatter and markdown sections in the required order', async () => {
  const asset = {
    id: 'asset_1',
    clipId: 'clip_export',
    createdAt: 1741867200000,
    name: 'image.png',
    mimeType: 'image/png',
    size: 34567,
    blob: new Blob(['png'], { type: 'image/png' }),
    sha256: 'abc',
  };

  const clip = await finalizeClipRecord({
    id: 'clip_export',
    createdAt: 1741867200000,
    updatedAt: 1741867200000,
    pinnedAt: null,
    deletedAt: null,
    text: 'Meeting notes',
    url: 'https://example.com',
    fileIds: [asset.id],
    meta: {
      title: 'Meeting Link',
      tags: ['work'],
      sourceApp: 'YCopy',
      sourceDevice: 'Phone',
      importedFrom: '',
    },
    capture: {
      markdown: 'Captured **markdown** body',
      captureSource: 'manual',
    },
    exportState: {},
  }, [asset]);

  const markdownExport = await buildMarkdownExport(clip, [asset]);
  const textIndex = markdownExport.content.indexOf('## Text');
  const urlIndex = markdownExport.content.indexOf('## URL');
  const captureIndex = markdownExport.content.indexOf('## Captured Content');
  const attachmentIndex = markdownExport.content.indexOf('## Attachments');

  assert.match(markdownExport.relativePath, /^clips\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}--meeting-link--clip_export\.md$/);
  assert.ok(markdownExport.content.startsWith('---\n'));
  assert.match(markdownExport.content, /id: "clip_export"/);
  assert.match(markdownExport.content, /title: "Meeting Link"/);
  assert.match(markdownExport.content, /tags: \["work"\]/);
  assert.match(markdownExport.content, /capture_source: "manual"/);
  assert.match(markdownExport.content, /source_app: "YCopy"/);
  assert.match(markdownExport.content, /source_device: "Phone"/);
  assert.ok(textIndex < urlIndex);
  assert.ok(urlIndex < captureIndex);
  assert.ok(captureIndex < attachmentIndex);
  assert.match(markdownExport.content, /- image\.png \(`image\/png`, 34567 bytes\)/);
  assert.ok(markdownExport.contentHash.length > 0);
});

test('slug generation follows the documented priority and fallback rules', () => {
  assert.equal(deriveSlug({ title: 'My Title', text: 'ignored', url: 'https://example.com' }), 'my-title');
  assert.equal(deriveSlug({ title: '', text: 'First line\nSecond line', url: 'https://example.com' }), 'first-line');
  assert.equal(deriveSlug({ title: '', text: '', url: 'https://sub.example.com/path' }), 'sub-example-com');
  assert.equal(deriveSlug({ title: '', text: '', url: '' }), 'clip');
});

test('markdown hashes stay stable for unchanged content and change when exported content changes', async () => {
  const baseClip = {
    id: 'clip_hash',
    createdAt: 1741867200000,
    updatedAt: 1741867200000,
    pinnedAt: null,
    deletedAt: null,
    text: 'Alpha',
    url: 'https://example.com',
    fileIds: [],
    meta: {
      title: 'Stable Title',
      tags: [],
      sourceApp: '',
      sourceDevice: '',
      importedFrom: '',
    },
    capture: {
      markdown: '',
      captureSource: 'manual',
    },
    exportState: {},
  };

  const first = await finalizeClipRecord(baseClip, []);
  const second = await finalizeClipRecord(baseClip, []);
  const changed = await finalizeClipRecord({
    ...baseClip,
    text: 'Beta',
    updatedAt: 1741867201000,
  }, []);

  assert.equal(first.exportState.relativePath, second.exportState.relativePath);
  assert.equal(first.exportState.markdownHash, second.exportState.markdownHash);
  assert.notEqual(first.exportState.markdownHash, changed.exportState.markdownHash);
  assert.equal(first.exportState.syncStatus, 'pending');
});
