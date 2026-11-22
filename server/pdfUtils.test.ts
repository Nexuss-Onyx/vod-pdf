import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countWords,
  formatBytes,
  formatPdfDate,
  hasPdfMagicHeader,
  isValidEntityId,
  normalizePdfText,
  sanitizePdfFilename,
  truncateText,
} from './pdfUtils.ts';

test('sanitizePdfFilename always produces a .pdf filename', () => {
  assert.equal(sanitizePdfFilename('Board Summary'), 'Board_Summary.pdf');
  assert.equal(sanitizePdfFilename('report.PDF'), 'report.PDF');
  assert.equal(sanitizePdfFilename('path/inner\\Quarterly.pdf'), 'inner_Quarterly.pdf');
  assert.equal(sanitizePdfFilename('legacy.docx'), 'legacy.pdf');
  assert.equal(sanitizePdfFilename(''), 'Document.pdf');
  assert.equal(sanitizePdfFilename('...'), 'Document.pdf');
  assert.ok(sanitizePdfFilename('../../etc/passwd').endsWith('.pdf'));
  assert.ok(!sanitizePdfFilename('../../etc/passwd').includes('/'));
});

test('hasPdfMagicHeader only accepts PDF headers near the start of the file', () => {
  assert.equal(hasPdfMagicHeader(Buffer.from('%PDF-1.7\n%âãÏÓ')), true);
  assert.equal(hasPdfMagicHeader(Buffer.from('PK\x03\x04docx-zip')), false);
  assert.equal(hasPdfMagicHeader(Buffer.from('plain text')), false);
  assert.equal(hasPdfMagicHeader(Buffer.alloc(0)), false);
  const padded = Buffer.concat([Buffer.alloc(2000, 0x20), Buffer.from('%PDF-1.4')]);
  assert.equal(hasPdfMagicHeader(padded), false);
});

test('countWords ignores punctuation and counts unicode words', () => {
  assert.equal(countWords('Hello, PDF world!'), 3);
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   —  '), 0);
  assert.equal(countWords("don't stop"), 2);
});

test('formatPdfDate converts PDF date literals to ISO timestamps', () => {
  assert.equal(formatPdfDate('D:20261122153045Z'), '2026-11-22T15:30:45.000Z');
  assert.equal(formatPdfDate('D:20261122'), '2026-11-22T00:00:00.000Z');
  assert.equal(formatPdfDate('not-a-date'), undefined);
  assert.equal(formatPdfDate(undefined), undefined);
});

test('normalizePdfText and truncateText behave deterministically', () => {
  assert.equal(normalizePdfText('a\r\nb\n\n\n\nc'), 'a\nb\n\nc');
  assert.equal(truncateText('abcdef', 3), 'abc\n…');
  assert.equal(truncateText('abc', 10), 'abc');
});

test('isValidEntityId rejects traversal payloads', () => {
  assert.equal(isValidEntityId('file_q4_ops'), true);
  assert.equal(isValidEntityId('session-1234'), true);
  assert.equal(isValidEntityId('../etc/passwd'), false);
  assert.equal(isValidEntityId('a'), false);
  assert.equal(isValidEntityId('file id'), false);
});

test('formatBytes renders human readable sizes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(2048), '2.00 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.00 MB');
});
