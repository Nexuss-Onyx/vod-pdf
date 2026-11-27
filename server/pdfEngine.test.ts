import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  annotatePdfBuffer,
  createPdfFromSpec,
  editPdfBuffer,
  extractPdfPages,
  fillPdfFormBuffer,
  inspectPdfBuffer,
  mergePdfs,
  PdfEngineError,
  rotatePdfPages,
  searchPdfBuffer,
  splitPdf,
} from './pdfEngine.ts';
import type { PdfFileMeta } from './pdfEngine.ts';

function meta(overrides: Partial<PdfFileMeta> = {}): PdfFileMeta {
  return {
    id: 'file_test',
    sessionId: 'session_test',
    filename: 'Test.pdf',
    title: 'Test',
    sizeBytes: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    summary: 'test fixture',
    source: 'generated',
    ...overrides,
  };
}

async function makeSamplePdf() {
  return createPdfFromSpec({
    filename: 'Ops_Review.pdf',
    title: 'Operations Review',
    subtitle: 'Quarterly Briefing',
    headerText: 'Confidential',
    includePageNumbers: true,
    blocks: [
      { type: 'cover_page', text: 'Operations Review', subtitle: 'Quarterly Briefing' },
      {
        type: 'callout',
        calloutTitle: 'Executive Summary',
        text: 'Dispatch velocity improved 14.2% this quarter.',
      },
      { type: 'heading1', text: '1. Performance' },
      {
        type: 'paragraph',
        text: 'On-time dispatch averaged 97.8 percent, ahead of the 96.0 percent target that leadership set for the quarter.',
      },
      {
        type: 'table',
        headers: ['Department', 'Q4 Actual', 'Variance'],
        rows: [
          ['Fulfillment', '97.8%', '+1.8%'],
          ['Procurement', '$384,500', '-$10,500'],
        ],
      },
      { type: 'bullet_list', items: ['Finalize vendor MSA', 'Circulate staffing plan'] },
      { type: 'page_break' },
      { type: 'heading2', text: 'Appendix' },
      { type: 'numbered_list', items: ['First action', 'Second action'] },
    ],
  });
}

test('createPdfFromSpec emits a valid multi-page PDF with extractable text', async () => {
  const created = await makeSamplePdf();
  assert.equal(created.buffer.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(created.pageCount >= 2, 'expected at least two pages');
  assert.ok(created.textWordCount > 40, 'expected extracted words from the generated text layer');

  const inspection = await inspectPdfBuffer(created.buffer, meta({ pageCount: created.pageCount }));
  assert.equal(inspection.pageCount, created.pageCount);
  assert.equal(inspection.pages.length, created.pageCount);
  assert.equal(inspection.validation.valid, true);
  assert.equal(inspection.capabilities.canCreate, true);
  assert.equal(inspection.capabilities.canEditExistingText, false);
  assert.ok(inspection.textPreview.includes('Operations Review'));
  assert.ok(inspection.pages.every((page) => page.width > 0 && page.height > 0));
});

test('inspectPdfBuffer returns PDF-native fields and no OOXML payload', async () => {
  const created = await makeSamplePdf();
  const inspection = await inspectPdfBuffer(created.buffer, meta(), { includePlainTextByPage: true });
  const serialized = JSON.stringify(inspection);

  assert.equal('documentXml' in inspection, false);
  assert.equal(serialized.includes('documentXml'), false);
  assert.equal(serialized.includes('w:p'), false);
  assert.ok(Array.isArray(inspection.plainTextByPage));
  assert.equal(inspection.plainTextByPage?.length, inspection.pageCount);
  assert.equal(inspection.forms.hasAcroForm, false);
  assert.equal(inspection.file.mimeType, 'application/pdf');
  assert.equal(inspection.file.filename, 'Test.pdf');
});

test('searchPdfBuffer returns page numbers and snippets', async () => {
  const created = await makeSamplePdf();
  const result = await searchPdfBuffer(created.buffer, 'dispatch');
  assert.ok(result.totalMatches >= 1);
  assert.ok(result.matches.length >= 1);
  assert.ok(result.matches[0].pageNumber >= 1);
  assert.match(result.matches[0].snippet.toLowerCase(), /dispatch/);
  assert.equal(result.pagesSearched, created.pageCount);

  const missing = await searchPdfBuffer(created.buffer, 'nonexistent-phrase-zzz');
  assert.equal(missing.totalMatches, 0);
  assert.ok(missing.warnings.length > 0);
});

test('a PDF without a text layer is flagged as scanned and unsearchable', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawRectangle({ x: 20, y: 20, width: 200, height: 200 });
  const buffer = Buffer.from(await doc.save());

  const inspection = await inspectPdfBuffer(buffer, meta({ filename: 'Scan.pdf' }));
  assert.equal(inspection.pageCount, 1);
  assert.equal(inspection.file.textWordCount, 0);
  assert.equal(inspection.file.metadataFlags?.scannedLikely, true);
  assert.ok(inspection.extractionWarnings.some((warning) => /text layer/i.test(warning)));

  const result = await searchPdfBuffer(buffer, 'anything');
  assert.equal(result.totalMatches, 0);
  assert.ok(result.warnings.some((warning) => /no text layer/i.test(warning)));
});

test('annotatePdfBuffer anchors a review comment to page text', async () => {
  const created = await makeSamplePdf();
  const annotated = await annotatePdfBuffer(created.buffer, {
    pageNumber: 2,
    text: 'Please confirm the variance figures.',
    author: 'Vod PDF',
    anchorText: 'dispatch averaged',
  });

  assert.equal(annotated.pageNumber, 2);
  assert.equal(annotated.anchored, true);
  assert.ok(annotated.commentId.startsWith('annot_2_'));

  const inspection = await inspectPdfBuffer(annotated.buffer, meta());
  const comment = inspection.annotations.find((entry) => entry.content?.includes('variance figures'));
  assert.ok(comment, 'comment annotation should be readable from the saved PDF');
  assert.equal(comment?.pageNumber, 2);
  assert.equal(inspection.file.metadataFlags?.hasAnnotations, true);
});

test('editPdfBuffer applies supported operations and gates text replacement', async () => {
  const created = await makeSamplePdf();

  const appended = await editPdfBuffer(created.buffer, [
    { type: 'append_blocks', blocks: [{ type: 'paragraph', text: 'Addendum: signed off by operations.' }] },
  ]);
  assert.ok(appended.pageCount > created.pageCount);
  assert.equal(appended.appliedOperations.length, 1);

  const rotated = await editPdfBuffer(created.buffer, [
    { type: 'rotate_pages', pages: [1], degrees: 90 },
  ]);
  const rotatedInspection = await inspectPdfBuffer(rotated.buffer, meta());
  assert.equal(rotatedInspection.pages[0].rotation % 360, 90);

  const deleted = await editPdfBuffer(created.buffer, [{ type: 'delete_pages', pages: [2] }]);
  assert.equal(deleted.pageCount, created.pageCount - 1);

  const watermarked = await editPdfBuffer(created.buffer, [
    { type: 'add_watermark', text: 'CONFIDENTIAL', opacity: 0.2 },
  ]);
  assert.equal(watermarked.pageCount, created.pageCount);
  const watermarkedSearch = await searchPdfBuffer(watermarked.buffer, 'CONFIDENTIAL');
  assert.ok(watermarkedSearch.totalMatches >= 1, 'watermark text should be stamped onto pages');

  const cropped = await editPdfBuffer(created.buffer, [
    { type: 'crop_pages', pages: [1], left: 36, bottom: 36, right: 576, top: 756 },
  ]);
  const croppedInspection = await inspectPdfBuffer(cropped.buffer, meta());
  assert.equal(croppedInspection.pages[0].width, 540);
  assert.equal(croppedInspection.pages[0].height, 720);
  assert.equal(croppedInspection.capabilities.canWatermark, true);
  assert.equal(croppedInspection.capabilities.canCrop, true);

  await assert.rejects(
    () =>
      editPdfBuffer(created.buffer, [
        { type: 'replace_text', find: 'dispatch', replace: 'shipping' },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof PdfEngineError);
      assert.equal((err as PdfEngineError).code, 'unsupported_operation');
      assert.match((err as Error).message, /not supported/i);
      return true;
    },
  );

  await assert.rejects(
    () => editPdfBuffer(created.buffer, [{ type: 'delete_pages', pages: [1, 2, 3, 4] }]),
    (err: unknown) => err instanceof PdfEngineError,
  );
});

test('merge, extract, split and rotate produce valid PDFs', async () => {
  const created = await makeSamplePdf();
  const other = await createPdfFromSpec({
    filename: 'Cover.pdf',
    title: 'Cover Letter',
    blocks: [{ type: 'paragraph', text: 'Please find the attached review.' }],
  });

  const merged = await mergePdfs([created.buffer, other.buffer]);
  assert.equal(merged.pageCount, created.pageCount + other.pageCount);

  const extracted = await extractPdfPages(created.buffer, '1-2');
  assert.equal(extracted.pageCount, 2);

  const parts = await splitPdf(created.buffer, ['1', '2-3']);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].pageCount, 1);

  const rotated = await rotatePdfPages(created.buffer, undefined, 180);
  assert.equal(rotated.pageCount, created.pageCount);

  await assert.rejects(() => rotatePdfPages(created.buffer, undefined, 45), PdfEngineError);
});

test('form filling is capability-gated for PDFs without AcroForm fields', async () => {
  const created = await makeSamplePdf();
  await assert.rejects(
    () => fillPdfFormBuffer(created.buffer, { name: 'Ada' }),
    (err: unknown) => {
      assert.ok(err instanceof PdfEngineError);
      assert.equal((err as PdfEngineError).code, 'form_not_found');
      return true;
    },
  );
});

test('invalid and truncated buffers raise structured PDF errors', async () => {
  await assert.rejects(
    () => inspectPdfBuffer(Buffer.from('PK\x03\x04not-a-pdf'), meta()),
    (err: unknown) => {
      assert.ok(err instanceof PdfEngineError);
      assert.equal((err as PdfEngineError).code, 'invalid_pdf');
      return true;
    },
  );

  await assert.rejects(
    () => inspectPdfBuffer(Buffer.from('%PDF-1.7 truncated garbage'), meta()),
    (err: unknown) => {
      assert.ok(err instanceof PdfEngineError);
      assert.ok(['corrupt_pdf', 'invalid_pdf'].includes((err as PdfEngineError).code));
      return true;
    },
  );
});
