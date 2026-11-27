import test from 'node:test';
import assert from 'node:assert/strict';
import type { PdfInspection } from '../types/vod.ts';
import {
  loadLocalFileBlob,
  loadLocalMeta,
  loadLocalSessionMessages,
  prefetchFileToLocalCache,
  saveLocalFileBlob,
  saveLocalMeta,
  saveLocalSessionMessages,
} from './localWorkspaceDb.ts';

// Node has no IndexedDB, so these exercise the module's in-memory fallback —
// the same code path a browser uses when IndexedDB is unavailable or cleared.
const inspection: PdfInspection = {
  file: {
    id: 'file_cache_1',
    sessionId: 'session_cache',
    filename: 'Cached.pdf',
    title: 'Cached',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    version: 1,
    summary: 'cached PDF',
    pageCount: 2,
    textWordCount: 120,
    source: 'uploaded',
  },
  pageCount: 2,
  pages: [
    { pageNumber: 1, width: 612, height: 792, rotation: 0, textWordCount: 60 },
    { pageNumber: 2, width: 612, height: 792, rotation: 0, textWordCount: 60 },
  ],
  outline: [],
  metadata: { producer: 'Vod PDF' },
  forms: { hasAcroForm: false, fieldCount: 0, fields: [] },
  annotations: [],
  textPreview: 'Cached PDF text',
  extractionWarnings: [],
  validation: { valid: true, errors: [], warnings: [] },
  capabilities: {
    canCreate: true,
    canExtractText: true,
    canSearch: true,
    canRenderPages: true,
    canFillForms: true,
    canAddAnnotations: true,
    canEditExistingText: false,
    canMerge: true,
    canSplit: true,
    canRotate: true,
    canWatermark: true,
    canCrop: true,
    canEncrypt: false,
    canRedact: false,
  },
};

test('local PDF cache stores and reloads binary + PDF inspection', async () => {
  const buffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
  await saveLocalFileBlob('file_cache_1', buffer, inspection);

  const record = await loadLocalFileBlob('file_cache_1');
  assert.ok(record);
  assert.equal(record?.inspection?.pageCount, 2);
  assert.equal(record?.inspection?.file.mimeType, 'application/pdf');
  assert.deepEqual(Array.from(new Uint8Array(record?.buffer as ArrayBuffer)), [0x25, 0x50, 0x44, 0x46, 0x2d]);
});

test('unknown cache keys return null instead of throwing (stale DOCX-era records)', async () => {
  assert.equal(await loadLocalFileBlob('file_legacy_docx'), null);
  assert.equal(await loadLocalSessionMessages('session_missing'), null);
  assert.equal(await loadLocalMeta(), null);
});

test('prefetch failures are non-fatal when the network is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as typeof fetch;
  try {
    await prefetchFileToLocalCache('file_offline');
    assert.equal(await loadLocalFileBlob('file_offline'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('local workspace meta and messages round trip with PDF attachments', async () => {
  await saveLocalMeta({
    sessions: [
      {
        id: 'session_cache',
        title: 'Cache test',
        createdAt: '2026-11-22T10:00:00.000Z',
        updatedAt: '2026-11-22T10:00:00.000Z',
        messageCount: 1,
        fileCount: 1,
      },
    ],
    files: [inspection.file],
    activeSessionId: 'session_cache',
  });

  const meta = await loadLocalMeta();
  assert.equal(meta?.files[0].filename, 'Cached.pdf');
  assert.equal(meta?.activeSessionId, 'session_cache');

  await saveLocalSessionMessages('session_cache', [
    {
      id: 'msg_cache_1',
      sessionId: 'session_cache',
      role: 'assistant',
      content: 'Here is the PDF.',
      createdAt: '2026-11-22T10:01:00.000Z',
      attachments: [inspection.file],
    },
  ]);

  const messages = await loadLocalSessionMessages('session_cache');
  assert.equal(messages?.length, 1);
  assert.equal(messages?.[0].attachments?.[0].pageCount, 2);
});
