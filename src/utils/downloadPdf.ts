import type { PdfAttachment } from '../types/vod';
import { loadLocalFileBlob, saveLocalFileBlob } from './localWorkspaceDb';

/** Checks whether raw bytes begin with a valid `%PDF-` magic header. */
export function isValidPdfBytes(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 8) return false;
  const limit = Math.min(bytes.byteLength - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves a verified PDF ArrayBuffer from IndexedDB local cache first,
 * falling back to the server download route. Throws if the payload is not a valid PDF.
 */
export async function resolveVerifiedPdfBytes(file: Pick<PdfAttachment, 'id' | 'filename'>): Promise<ArrayBuffer> {
  const cached = await loadLocalFileBlob(file.id);
  if (cached?.buffer && isValidPdfBytes(cached.buffer)) {
    return cached.buffer;
  }

  const res = await fetch(`/api/files/${encodeURIComponent(file.id)}/download`);
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errBody?.error || `Failed to download ${file.filename}.`);
  }

  const buffer = await res.arrayBuffer();
  if (!isValidPdfBytes(buffer)) {
    throw new Error(`${file.filename} is not a valid PDF document.`);
  }

  void saveLocalFileBlob(file.id, buffer, cached?.inspection);
  return buffer;
}

export async function downloadPdfAttachment(file: Pick<PdfAttachment, 'id' | 'filename'>): Promise<void> {
  const buffer = await resolveVerifiedPdfBytes(file);
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = /\.pdf$/i.test(file.filename) ? file.filename : `${file.filename}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }
}
