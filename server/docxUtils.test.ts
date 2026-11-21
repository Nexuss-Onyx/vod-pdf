import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeDocxFilename,
  formatBytes,
  mergeAdjacentRunsInXml,
  applyTextEditInXml,
  acceptTrackedChangesInXml,
  extractCommentsFromXml,
  extractTrackedChangesFromXml,
  validateOoxmlPackageEntries,
} from './docxUtils.ts';

test('sanitizeDocxFilename normalizes spaces, strips traversal, and ensures .docx extension', () => {
  assert.equal(sanitizeDocxFilename('../secrets/Q4 Report'), 'Q4_Report.docx');
  assert.equal(sanitizeDocxFilename('Meeting Notes.docx'), 'Meeting_Notes.docx');
  assert.equal(sanitizeDocxFilename('...'), 'Document.docx');
});

test('formatBytes formats bytes, kilobytes, and megabytes cleanly', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(25395), '24.80 KB');
  assert.equal(formatBytes(2 * 1024 * 1024), '2.00 MB');
});

test('mergeAdjacentRunsInXml coalesces split runs with identical formatting', () => {
  const fragmented = `<w:document><w:body><w:p w:rsidR="00A1"><w:r w:rsidRPr="001"><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r></w:p></w:body></w:document>`;
  const merged = mergeAdjacentRunsInXml(fragmented);
  assert.equal(merged.includes('Hello World'), true);
  assert.equal(merged.includes('proofErr'), false);
  assert.equal(merged.includes('rsidR'), false);
});

test('applyTextEditInXml supports plain replacement and tracked redlining', () => {
  const doc = `<w:document><w:body><w:p><w:r><w:t>Total budget is $50,000 for Q4.</w:t></w:r></w:p></w:body></w:document>`;

  const plain = applyTextEditInXml(doc, '$50,000', '$65,000', { trackedChange: false });
  assert.equal(plain.replacements, 1);
  assert.equal(plain.xml.includes('$65,000'), true);
  assert.equal(plain.xml.includes('<w:ins'), false);

  const tracked = applyTextEditInXml(doc, '$50,000', '$65,000', {
    trackedChange: true,
    author: 'Vod Word',
    dateIso: '2026-11-21T09:00:00Z',
    startId: 10,
  });
  assert.equal(tracked.replacements, 1);
  assert.equal(tracked.xml.includes('<w:del w:id="10" w:author="Vod Word"'), true);
  assert.equal(tracked.xml.includes('<w:delText>$50,000</w:delText>'), true);
  assert.equal(tracked.xml.includes('<w:ins w:id="11" w:author="Vod Word"'), true);
  assert.equal(tracked.xml.includes('<w:t>$65,000</w:t>'), true);

  const parsedChanges = extractTrackedChangesFromXml(tracked.xml);
  assert.equal(parsedChanges.length, 2);
  assert.equal(parsedChanges[0].type, 'insertion');
  assert.equal(parsedChanges[0].text, '$65,000');
  assert.equal(parsedChanges[1].type, 'deletion');
  assert.equal(parsedChanges[1].text, '$50,000');

  const accepted = acceptTrackedChangesInXml(tracked.xml);
  assert.equal(accepted.acceptedInsertions, 1);
  assert.equal(accepted.acceptedDeletions, 1);
  assert.equal(accepted.xml.includes('$50,000'), false);
  assert.equal(accepted.xml.includes('$65,000'), true);
});

test('extractCommentsFromXml parses comments cleanly', () => {
  const commentsXml = `<w:comments><w:comment w:id="1" w:author="Priya Nair" w:date="2026-11-21T10:00:00Z"><w:p><w:r><w:t>Confirm indemnity cap.</w:t></w:r></w:p></w:comment></w:comments>`;
  const parsed = extractCommentsFromXml(commentsXml);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].author, 'Priya Nair');
  assert.equal(parsed[0].text, 'Confirm indemnity cap.');
});

test('validateOoxmlPackageEntries rejects directory entries and unbalanced tags', () => {
  const bad = validateOoxmlPackageEntries({
    'word/': new Uint8Array(),
    '[Content_Types].xml': '<Types/>',
    '_rels/.rels': '<Relationships/>',
    'word/document.xml': '<w:document><w:body><w:p></w:body></w:document>',
  });
  assert.equal(bad.valid, false);
  assert.equal(bad.errors.length >= 2, true);

  const good = validateOoxmlPackageEntries({
    '[Content_Types].xml': '<Types/>',
    '_rels/.rels': '<Relationships/>',
    'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>OK</w:t></w:r></w:p></w:body></w:document>',
  });
  assert.equal(good.valid, true);
  assert.equal(good.errors.length, 0);
});
