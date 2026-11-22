import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from './store';

test('WorkspaceStore persists partitioned index, per-session messages, and docx files cleanly across reloads', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-store-test-'));
  try {
    const store1 = new WorkspaceStore(tmpDir);
    await store1.init();

    const created = store1.createSession('Quarterly Board Deck', 'session_custom_1');
    // Idempotent duplicate creation with same ID returns existing session
    const duplicate = store1.createSession('Ignored Title', 'session_custom_1');
    assert.equal(duplicate.id, created.id);
    assert.equal(duplicate.title, 'Quarterly Board Deck');

    store1.appendMessage({
      id: 'msg_test_1',
      sessionId: created.id,
      role: 'user',
      content: 'Draft board summary',
    });

    const sampleBuffer = Buffer.from('PK\x03\x04dummy-docx-content');
    const savedFile = store1.saveDocxFile({
      sessionId: created.id,
      filename: 'Board Summary.docx',
      title: 'Board Summary',
      buffer: sampleBuffer,
      summary: 'Test file',
      wordCount: 120,
      pageCountEstimate: 1,
      source: 'generated',
    });

    await store1.flush();

    assert.equal(fs.existsSync(path.join(tmpDir, 'index.json')), true);
    assert.equal(fs.existsSync(path.join(tmpDir, 'sessions', 'session_custom_1.json')), true);
    assert.equal(fs.existsSync(path.join(tmpDir, 'files', `${savedFile.id}.docx`)), true);

    // Compact JSON check (not pretty-printed with newlines)
    const indexRaw = fs.readFileSync(path.join(tmpDir, 'index.json'), 'utf8');
    assert.equal(indexRaw.includes('\n'), false);

    // Reload into a brand-new WorkspaceStore instance pointing at the same disk directory
    const store2 = new WorkspaceStore(tmpDir);
    await store2.init();

    const loadedSession = store2.getSession('session_custom_1');
    assert.ok(loadedSession);
    assert.equal(loadedSession.title, 'Quarterly Board Deck');
    assert.equal(store2.getSessionMessages('session_custom_1').length, 1);
    assert.equal(store2.getSessionMessages('session_custom_1')[0].content, 'Draft board summary');

    const loadedBuffer = await store2.getFileBufferAsync(savedFile.id);
    assert.deepEqual(loadedBuffer, sampleBuffer);

    // Deleting session cleans up its session file and disk attachments
    assert.equal(store2.deleteSession('session_custom_1'), true);
    await store2.flush();
    assert.equal(fs.existsSync(path.join(tmpDir, 'sessions', 'session_custom_1.json')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('WorkspaceStore migrates legacy workspace.json into partitioned storage', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-store-legacy-'));
  try {
    const legacy = {
      sessions: [
        {
          id: 'session_legacy_1',
          title: 'Legacy Brief',
          createdAt: '2026-11-20T10:00:00.000Z',
          updatedAt: '2026-11-20T10:05:00.000Z',
          messageCount: 1,
          fileCount: 0,
        },
      ],
      messages: [
        {
          id: 'msg_leg_1',
          sessionId: 'session_legacy_1',
          role: 'user',
          content: 'Migrated message',
          createdAt: '2026-11-20T10:00:00.000Z',
        },
      ],
      files: [],
    };
    fs.writeFileSync(path.join(tmpDir, 'workspace.json'), JSON.stringify(legacy), 'utf8');

    const store = new WorkspaceStore(tmpDir);
    await store.init();

    assert.equal(fs.existsSync(path.join(tmpDir, 'index.json')), true);
    assert.equal(fs.existsSync(path.join(tmpDir, 'sessions', 'session_legacy_1.json')), true);
    assert.equal(store.getSessionMessages('session_legacy_1')[0].content, 'Migrated message');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
