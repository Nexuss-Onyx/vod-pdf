import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createPdfFromSpec } from './pdfEngine.ts';
import { createVodPdfApp } from './app.ts';
import { WorkspaceStore } from './store.ts';

interface Harness {
  baseUrl: string;
  store: WorkspaceStore;
  close: () => Promise<void>;
  tmpDir: string;
}

async function startHarness(): Promise<Harness> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-pdf-api-'));
  const store = new WorkspaceStore(tmpDir);
  await store.init();
  const app = createVodPdfApp(store);
  const server: Server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    store,
    tmpDir,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.flush();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function uploadPdf(harness: Harness, filename: string, buffer: Buffer) {
  return fetch(`${harness.baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'session_q4_ops',
      filename,
      base64Data: buffer.toString('base64'),
    }),
  });
}

test('health endpoint reports the vod-pdf service', async () => {
  const harness = await startHarness();
  try {
    const res = await fetch(`${harness.baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, service: 'vod-pdf' });
  } finally {
    await harness.close();
  }
});

test('upload accepts PDFs and returns a PdfAttachment + PdfInspection', async () => {
  const harness = await startHarness();
  try {
    const pdf = await createPdfFromSpec({
      filename: 'Upload Test.pdf',
      title: 'Upload Test',
      blocks: [
        { type: 'heading1', text: 'Findings' },
        { type: 'paragraph', text: 'Uploaded PDF content is searchable and inspectable.' },
      ],
    });

    const res = await uploadPdf(harness, 'Upload Test.pdf', pdf.buffer);
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      file: Record<string, unknown>;
      inspection: Record<string, unknown>;
    };

    assert.ok(String(body.file.filename).endsWith('.pdf'));
    assert.equal(body.file.mimeType, 'application/pdf');
    assert.ok(Number(body.file.pageCount) >= 1);
    assert.ok(Number(body.file.textWordCount) > 0);
    assert.equal((body.inspection.validation as { valid: boolean }).valid, true);
    assert.equal('documentXml' in body.inspection, false);

    // Whole workspace snapshot is PDF-typed.
    const snapshot = (await (await fetch(`${harness.baseUrl}/api/workspace`)).json()) as {
      files: Array<{ id: string; filename: string; pageCount: number }>;
    };
    assert.ok(snapshot.files.every((file) => file.filename.endsWith('.pdf')));
    assert.ok(snapshot.files.every((file) => typeof file.pageCount === 'number'));
  } finally {
    await harness.close();
  }
});

test('upload rejects DOCX, ZIP, and random bytes', async () => {
  const harness = await startHarness();
  try {
    const docx = Buffer.from('PK\x03\x04docx-payload');
    const docxRes = await uploadPdf(harness, 'Brief.docx', docx);
    assert.equal(docxRes.status, 400);
    const docxBody = (await docxRes.json()) as { error: string; code: string };
    assert.equal(docxBody.code, 'invalid_pdf');
    assert.match(docxBody.error, /\.pdf|Vod Word/i);

    const zipRes = await uploadPdf(harness, 'Archive.pdf', docx);
    assert.equal(zipRes.status, 400);
    assert.equal(((await zipRes.json()) as { code: string }).code, 'invalid_pdf');

    const randomRes = await uploadPdf(harness, 'Random.pdf', Buffer.from('not a pdf at all'));
    assert.equal(randomRes.status, 400);
    assert.equal(((await randomRes.json()) as { code: string }).code, 'invalid_pdf');

    const wrongExt = await uploadPdf(harness, 'Notes.txt', Buffer.from('%PDF-1.7\n'));
    assert.equal(wrongExt.status, 400);
    assert.equal(((await wrongExt.json()) as { code: string }).code, 'invalid_pdf');
  } finally {
    await harness.close();
  }
});

test('download serves application/pdf bytes identical to the stored file', async () => {
  const harness = await startHarness();
  try {
    const pdf = await createPdfFromSpec({
      filename: 'Download Test.pdf',
      title: 'Download Test',
      blocks: [{ type: 'paragraph', text: 'Round trip me.' }],
    });
    const uploadRes = await uploadPdf(harness, 'Download Test.pdf', pdf.buffer);
    const uploaded = (await uploadRes.json()) as { file: { id: string; filename: string } };

    const res = await fetch(
      `${harness.baseUrl}/api/files/${encodeURIComponent(uploaded.file.id)}/download`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition') || '', /\.pdf/);

    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.deepEqual(bytes, pdf.buffer);

    const missing = await fetch(`${harness.baseUrl}/api/files/unknown_file/download`);
    assert.equal(missing.status, 404);

    const traversal = await fetch(`${harness.baseUrl}/api/files/..%2Findex/download`);
    assert.equal(traversal.status, 400);
  } finally {
    await harness.close();
  }
});

test('inspect endpoint returns PDF inspection without OOXML fields', async () => {
  const harness = await startHarness();
  try {
    const files = harness.store.getSessionFiles('session_q4_ops');
    const fileId = files[0].id;
    const res = await fetch(`${harness.baseUrl}/api/files/${fileId}/inspect`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;

    assert.ok(Number(body.pageCount) >= 1);
    assert.ok(Array.isArray(body.pages));
    assert.ok(body.validation && typeof body.validation === 'object');
    assert.ok(typeof body.textPreview === 'string');
    assert.equal('documentXml' in body, false);
    assert.equal('wordCount' in body, false);
    assert.equal('trackedChanges' in body, false);
  } finally {
    await harness.close();
  }
});

test('session endpoints return PDF attachments only', async () => {
  const harness = await startHarness();
  try {
    const res = await fetch(`${harness.baseUrl}/api/sessions/session_q4_ops`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      files: Array<{ filename: string; mimeType: string }>;
      messages: unknown[];
    };
    assert.ok(body.files.length >= 1);
    assert.ok(body.files.every((file) => file.filename.endsWith('.pdf')));
    assert.ok(body.files.every((file) => file.mimeType === 'application/pdf'));
    assert.ok(body.messages.length >= 1);
  } finally {
    await harness.close();
  }
});
