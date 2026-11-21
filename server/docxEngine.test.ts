import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptAllDocxChangesBuffer,
  addCommentToDocxBuffer,
  createDocxFromSpec,
  editDocxBuffer,
  inspectDocxBuffer,
} from './docxEngine.ts';
import type { DocxAttachment } from '../src/types/vod.ts';

test('docxEngine creates, inspects, redlines, comments, and accepts tracked changes end-to-end', async () => {
  const created = await createDocxFromSpec({
    filename: 'Contract Test',
    title: 'Master Services Agreement',
    subtitle: 'Draft v1.0',
    blocks: [
      { type: 'heading1', text: '1. Payment Terms' },
      { type: 'paragraph', text: 'Client shall pay all undisputed invoices within Net 30 days.' },
      {
        type: 'table',
        headers: ['Item', 'Amount'],
        rows: [['Annual Support', '$24,000']],
      },
      { type: 'bullet_list', items: ['Monthly SLA report', 'Quarterly business review'] },
    ],
  });

  assert.equal(created.filename, 'Contract_Test.docx');
  assert.equal(created.buffer[0], 0x50);
  assert.equal(created.buffer[1], 0x4b);
  assert.ok(created.wordCount > 15);

  const meta: DocxAttachment = {
    id: 'file_test_1',
    sessionId: 'session_test_1',
    filename: created.filename,
    title: 'Master Services Agreement',
    sizeBytes: created.buffer.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    summary: 'Test MSA',
    pageCountEstimate: created.pageCountEstimate,
    wordCount: created.wordCount,
    source: 'generated',
  };

  const inspected = await inspectDocxBuffer(created.buffer, meta);
  assert.equal(inspected.validation.valid, true);
  assert.ok(inspected.plainText.includes('Net 30 days'));
  assert.equal(inspected.tableCount, 1);
  assert.ok(inspected.outline.length >= 1);

  // Redline Net 30 -> Net 45
  const redlined = await editDocxBuffer(created.buffer, {
    replacements: [{ find: 'Net 30', replace: 'Net 45' }],
    trackedChange: true,
    author: 'Legal Team',
  });
  assert.equal(redlined.totalReplacements, 1);

  const inspectedRedline = await inspectDocxBuffer(redlined.buffer, meta);
  assert.equal(inspectedRedline.trackedChanges.length, 2);

  // Add anchored comment
  const commented = await addCommentToDocxBuffer(
    redlined.buffer,
    'Approved extension to Net 45 per CFO.',
    'Priya Nair',
    'Annual Support',
  );
  assert.equal(commented.anchored, true);

  const inspectedCommented = await inspectDocxBuffer(commented.buffer, meta);
  assert.equal(inspectedCommented.comments.length, 1);
  assert.equal(inspectedCommented.comments[0].author, 'Priya Nair');

  // Accept all changes
  const accepted = await acceptAllDocxChangesBuffer(commented.buffer);
  assert.equal(accepted.acceptedInsertions, 1);
  assert.equal(accepted.acceptedDeletions, 1);

  const inspectedFinal = await inspectDocxBuffer(accepted.buffer, meta);
  assert.equal(inspectedFinal.trackedChanges.length, 0);
  assert.ok(inspectedFinal.plainText.includes('Net 45'));
});
