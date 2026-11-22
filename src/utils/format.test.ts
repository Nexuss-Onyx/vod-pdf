import test from 'node:test';
import assert from 'node:assert/strict';
import {
  categorizeFilesByTime,
  formatPageCount,
  formatWordCount,
} from './format.ts';
import type { PdfAttachment } from '../types/vod.ts';

function makeFile(id: string, iso: string): PdfAttachment {
  return {
    id,
    sessionId: 's1',
    filename: `${id}.pdf`,
    title: id,
    sizeBytes: 1024,
    createdAt: iso,
    updatedAt: iso,
    version: 1,
    summary: '',
    mimeType: 'application/pdf',
    pageCount: 2,
    textWordCount: 50,
    source: 'uploaded',
  };
}

test('categorizeFilesByTime groups files into Today, Yesterday, and Earlier', () => {
  const now = new Date('2026-11-21T15:00:00.000Z').getTime();
  const todayIso = '2026-11-21T11:00:00.000Z';
  const yesterdayIso = '2026-11-20T18:00:00.000Z';
  const earlierIso = '2026-11-15T10:00:00.000Z';

  const groups = categorizeFilesByTime(
    [makeFile('old', earlierIso), makeFile('today', todayIso), makeFile('yest', yesterdayIso)],
    now,
  );

  assert.equal(groups.length, 3);
  assert.equal(groups[0].label, 'Today');
  assert.equal(groups[0].files[0].id, 'today');
  assert.equal(groups[1].label, 'Yesterday');
  assert.equal(groups[1].files[0].id, 'yest');
  assert.equal(groups[2].label, 'Earlier');
  assert.equal(groups[2].files[0].id, 'old');
});

test('PDF label helpers describe pages and text layers', () => {
  assert.equal(formatPageCount(1), '1 page');
  assert.equal(formatPageCount(7), '7 pages');
  assert.equal(formatPageCount(0), '0 pages');
  assert.equal(formatWordCount(0), 'no text layer');
  assert.equal(formatWordCount(420), '420 words');
  assert.equal(formatWordCount(12500), '13k words');
});
