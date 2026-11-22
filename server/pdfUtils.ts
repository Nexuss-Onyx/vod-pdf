import path from 'node:path';

/**
 * Generic, format-agnostic helpers for the Vod PDF engine.
 * (Replaces the former docxUtils OOXML helpers — no XML surgery lives here.)
 */

export function isValidEntityId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{2,80}$/.test(id);
}

export function sanitizePdfFilename(input: string, fallback = 'Document.pdf'): string {
  const base = path
    .basename(input || '')
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_')
    .trim();

  if (!base || /^\.+$/.test(base)) {
    return fallback;
  }

  const withoutForeignExt = base.replace(/\.(docx|doc|odt|rtf|txt|md)$/i, '');
  const normalized = withoutForeignExt.replace(/\s+/g, '_').replace(/_+/g, '_');
  const withExt = /\.pdf$/i.test(normalized) ? normalized : `${normalized}.pdf`;
  return withExt.length > 120 ? `${withExt.slice(0, 115)}.pdf` : withExt;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

/** PDF files may carry a small preamble; the header must appear in the first 1 KB. */
export function hasPdfMagicHeader(buffer: Uint8Array): boolean {
  if (!buffer || buffer.length < 5) return false;
  const head = Buffer.from(buffer.subarray(0, Math.min(buffer.length, 1024)));
  return head.includes(Buffer.from('%PDF-', 'latin1'));
}

export function countWords(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’._-]*/gu);
  return matches ? matches.length : 0;
}

export function normalizePdfText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Converts a PDF date string (`D:20261122153000Z`) into an ISO timestamp. */
export function formatPdfDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim().replace(/^D:/, '');
  const m = raw.match(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return undefined;
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00'] = m;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n…`;
}
