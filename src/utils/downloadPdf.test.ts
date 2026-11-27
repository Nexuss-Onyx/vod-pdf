import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidPdfBytes, resolveVerifiedPdfBytes } from './downloadPdf.ts';
import { saveLocalFileBlob } from './localWorkspaceDb.ts';

test('isValidPdfBytes accepts standard PDF headers and rejects JSON or empty buffers', () => {
  const valid = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
  assert.equal(isValidPdfBytes(valid), true);

  const jsonErr = new TextEncoder().encode('{"error":"File not found."}');
  assert.equal(isValidPdfBytes(jsonErr), false);

  const empty = new Uint8Array(0);
  assert.equal(isValidPdfBytes(empty), false);
});

test('resolveVerifiedPdfBytes prefers cached valid PDF bytes over network', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\n%cached\n%%EOF').buffer;
  await saveLocalFileBlob('file_cached_dl_test', bytes);

  const resolved = await resolveVerifiedPdfBytes({
    id: 'file_cached_dl_test',
    filename: 'Cached_Report.pdf',
  });
  assert.equal(resolved.byteLength, bytes.byteLength);
  assert.equal(isValidPdfBytes(resolved), true);
});
