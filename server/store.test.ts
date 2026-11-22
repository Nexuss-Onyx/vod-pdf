import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPdfFromSpec } from './pdfEngine.ts';
import { WorkspaceStore } from './store.ts';

test('WorkspaceStore persists a PDF-only workspace across reloads', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-pdf-store-'));
  try {
    const store1 = new WorkspaceStore(tmpDir);
    await store1.init();

    const seeded = store1.getSessionFiles('session_q4_ops');
    assert.equal(seeded.length, 3);
    assert.ok(seeded.every((file) => file.filename.endsWith('.pdf')));
    assert.ok(seeded.every((file) => file.pageCount >= 1 && file.textWordCount > 0));

    const created = store1.createSession('Board Summary', 'session_custom_1');
    const duplicate = store1.createSession('Ignored Title', 'session_custom_1');
    assert.equal(duplicate.id, created.id);
    assert.equal(duplicate.title, 'Board Summary');

    store1.appendMessage({ sessionId: created.id, role: 'user', content: 'Draft a PDF summary.' });

    const pdf = await createPdfFromSpec({
      filename: 'Board Summary.pdf',
      title: 'Board Summary',
      blocks: [{ type: 'paragraph', text: 'Revenue grew 12% year over year.' }],
    });

    const saved = store1.savePdfFile({
      sessionId: created.id,
      filename: 'Board Summary.pdf',
      title: 'Board Summary',
      buffer: pdf.buffer,
      summary: 'Board summary PDF',
      pageCount: pdf.pageCount,
      textWordCount: pdf.textWordCount,
      source: 'generated',
    });

    assert.equal(saved.filename, 'Board_Summary.pdf');
    assert.equal(saved.mimeType, 'application/pdf');
    assert.ok(fs.existsSync(path.join(tmpDir, 'files', `${saved.id}.pdf`)));
    assert.equal(fs.existsSync(path.join(tmpDir, 'files', `${saved.id}.docx`)), false);

    await store1.flush();

    // Reopen: index + per-session messages survive.
    const store2 = new WorkspaceStore(tmpDir);
    await store2.init();
    assert.ok(store2.getSession('session_custom_1'));
    assert.equal(store2.getSessionMessages('session_custom_1').length, 1);
    const reloaded = store2.getFileMeta(saved.id);
    assert.ok(reloaded);
    assert.equal(reloaded?.pageCount, pdf.pageCount);
    assert.equal(reloaded?.filename, 'Board_Summary.pdf');
    const binary = await store2.getFileBufferAsync(saved.id);
    assert.equal(binary.subarray(0, 5).toString('latin1'), '%PDF-');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('store rejects traversal identifiers and never serves non-PDF paths', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-pdf-store-safe-'));
  try {
    const store = new WorkspaceStore(tmpDir);
    await store.init();

    assert.throws(() => store.getFileBuffer('../../etc/passwd'), /Invalid file identifier/);
    assert.throws(() => store.getFileBuffer('file id with spaces'), /Invalid file identifier/);

    // Saving with a DOCX filename still lands as a .pdf artifact.
    const pdf = await createPdfFromSpec({
      filename: 'legacy.docx',
      title: 'Legacy Name',
      blocks: [{ type: 'paragraph', text: 'Filename normalisation check.' }],
    });
    const saved = store.savePdfFile({
      sessionId: 'session_q4_ops',
      filename: 'legacy.docx',
      title: 'Legacy Name',
      buffer: pdf.buffer,
      summary: 'normalised',
      pageCount: pdf.pageCount,
      textWordCount: pdf.textWordCount,
      source: 'edited',
    });
    assert.equal(saved.filename, 'legacy.pdf');
    assert.ok(fs.existsSync(path.join(tmpDir, 'files', `${saved.id}.pdf`)));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('legacy DOCX file records are ignored instead of corrupting a reused data dir', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-pdf-store-legacy-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'files'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'index.json'), JSON.stringify({
      version: 2,
      sessions: [
        {
          id: 'session_legacy',
          title: 'Legacy Word Task',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 0,
          fileCount: 1,
        },
      ],
      files: [
        {
          id: 'file_legacy_docx',
          sessionId: 'session_legacy',
          filename: 'Old Brief.docx',
          sizeBytes: 10,
          pageCountEstimate: 2,
          wordCount: 400,
        },
      ],
    }));
    fs.writeFileSync(path.join(tmpDir, 'files', 'file_legacy_docx.docx'), Buffer.from('PK\x03\x04'));

    const store = new WorkspaceStore(tmpDir);
    await store.init();

    assert.equal(store.getFileMeta('file_legacy_docx'), undefined);
    assert.equal(store.getAllFiles().filter((f) => /\.docx$/i.test(f.filename)).length, 0);
    // Session UX is preserved even though the legacy artifact is dropped.
    assert.ok(store.getSession('session_legacy'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('deleting a session removes its PDF binaries from disk', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-pdf-store-delete-'));
  try {
    const store = new WorkspaceStore(tmpDir);
    await store.init();

    const pdf = await createPdfFromSpec({
      filename: 'Temp.pdf',
      title: 'Temp',
      blocks: [{ type: 'paragraph', text: 'Temporary file.' }],
    });
    const saved = store.savePdfFile({
      sessionId: 'session_q4_ops',
      filename: 'Temp.pdf',
      title: 'Temp',
      buffer: pdf.buffer,
      summary: 'temp',
      pageCount: pdf.pageCount,
      textWordCount: pdf.textWordCount,
      source: 'generated',
    });
    const target = path.join(tmpDir, 'files', `${saved.id}.pdf`);
    assert.ok(fs.existsSync(target));

    assert.equal(store.deleteSession('session_q4_ops'), true);
    assert.equal(store.getSession('session_q4_ops'), undefined);
    await store.flush();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
