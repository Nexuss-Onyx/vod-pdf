import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  degrees,
  PDFArray,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFString,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import type {
  PdfAnnotation,
  PdfAnnotationType,
  PdfAttachment,
  PdfCapabilities,
  PdfFormField,
  PdfInspection,
  PdfMetadata,
  PdfOutlineItem,
  PdfPageInfo,
  PdfSearchMatch,
  PdfSearchResult,
  PdfTextPage,
  PdfErrorCode,
} from '../src/types/vod.ts';
import {
  countWords,
  formatPdfDate,
  hasPdfMagicHeader,
  normalizePdfText,
  truncateText,
} from './pdfUtils.ts';

/* -------------------------------------------------------------------------------------------------
 * Capabilities & errors
 * -----------------------------------------------------------------------------------------------*/

export const PDF_CAPABILITIES: PdfCapabilities = {
  canCreate: true,
  canExtractText: true,
  canSearch: true,
  canRenderPages: true,
  canFillForms: true,
  canAddAnnotations: true,
  canEditExistingText: false,
  canMerge: true,
  canSplit: true,
  canRotate: true,
  canWatermark: true,
  canCrop: true,
  canEncrypt: false,
  canRedact: false,
};

export class PdfEngineError extends Error {
  readonly code: PdfErrorCode;

  constructor(code: PdfErrorCode, message: string) {
    super(message);
    this.name = 'PdfEngineError';
    this.code = code;
  }
}

export type PdfFileMeta = Omit<PdfAttachment, 'mimeType' | 'pageCount' | 'textWordCount'> & {
  pageCount?: number;
  textWordCount?: number;
};

/* -------------------------------------------------------------------------------------------------
 * pdf.js (Node legacy build) loader
 * -----------------------------------------------------------------------------------------------*/

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const STANDARD_FONT_CANDIDATES = [
  path.resolve(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts') + path.sep,
  path.resolve(process.cwd(), '../node_modules/pdfjs-dist/standard_fonts') + path.sep,
  path.resolve(MODULE_DIR, '../node_modules/pdfjs-dist/standard_fonts') + path.sep,
];

function resolveStandardFontsDir(): string | undefined {
  for (const candidate of STANDARD_FONT_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

async function openPdfJsDocument(buffer: Buffer) {
  const pdfjs = await loadPdfJs();
  const standardFontDataUrl = resolveStandardFontsDir();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    verbosity: 0,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  });

  try {
    return { doc: await loadingTask.promise, loadingTask };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const message = err instanceof Error ? err.message : 'Unable to parse PDF.';
    if (/password/i.test(name) || /password/i.test(message)) {
      throw new PdfEngineError(
        'encrypted_pdf',
        'This PDF is password-protected. Remove the password/encryption, then upload it again.',
      );
    }
    if (/invalidpdf/i.test(name)) {
      throw new PdfEngineError('invalid_pdf', 'The file is not a valid PDF document.');
    }
    throw new PdfEngineError('corrupt_pdf', `The PDF could not be parsed: ${message}`);
  }
}

export function assertPdfBuffer(buffer: Buffer | Uint8Array): Buffer {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!bytes.length) {
    throw new PdfEngineError('invalid_pdf', 'The PDF file is empty.');
  }
  if (!hasPdfMagicHeader(bytes)) {
    throw new PdfEngineError(
      'invalid_pdf',
      'That file is not a PDF (missing %PDF- header). Vod PDF only accepts .pdf documents.',
    );
  }
  return bytes;
}

/* -------------------------------------------------------------------------------------------------
 * Inspection
 * -----------------------------------------------------------------------------------------------*/

interface ExtractedDocument {
  pageCount: number;
  pages: PdfPageInfo[];
  textPages: PdfTextPage[];
  plainText: string;
  textWordCount: number;
  outline: PdfOutlineItem[];
  annotations: PdfAnnotation[];
  forms: { hasAcroForm: boolean; fieldCount: number; fields: PdfFormField[] };
  metadata: PdfMetadata;
  warnings: string[];
}

function mapAnnotationSubtype(subtype?: string): PdfAnnotationType {
  const normalized = (subtype || '').toLowerCase();
  if (normalized === 'text' || normalized === 'popup' || normalized === 'caret') return 'text';
  if (normalized === 'highlight') return 'highlight';
  if (normalized === 'underline') return 'underline';
  if (normalized === 'strikeout') return 'strikeout';
  if (normalized === 'freetext') return 'freeText';
  if (normalized === 'link') return 'link';
  if (normalized === 'widget') return 'widget';
  if (normalized === 'stamp') return 'stamp';
  return 'other';
}

async function resolveOutlinePageNumber(
  doc: Awaited<ReturnType<typeof openPdfJsDocument>>['doc'],
  dest: unknown,
): Promise<number | undefined> {
  try {
    let target = dest;
    if (typeof target === 'string') return undefined;
    if (Array.isArray(target)) target = target[0];
    if (!target) return undefined;
    const index = await doc.getPageIndex(target);
    return index + 1;
  } catch {
    return undefined;
  }
}

async function flattenOutline(
  doc: Awaited<ReturnType<typeof openPdfJsDocument>>['doc'],
  nodes: Awaited<ReturnType<Awaited<ReturnType<typeof openPdfJsDocument>>['doc']['getOutline']>>,
  level = 1,
  out: PdfOutlineItem[] = [],
): Promise<PdfOutlineItem[]> {
  for (const node of nodes ?? []) {
    const pageNumber = node.dest ? await resolveOutlinePageNumber(doc, node.dest) : undefined;
    out.push({ title: normalizePdfText(node.title || 'Untitled section'), pageNumber, level });
    if (node.items && node.items.length > 0) {
      await flattenOutline(doc, node.items, level + 1, out);
    }
  }
  return out;
}

function readInfoString(info: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = info?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

async function extractDocument(buffer: Buffer): Promise<ExtractedDocument> {
  const warnings: string[] = [];
  const { doc, loadingTask } = await openPdfJsDocument(buffer);
  try {
    const pageCount = doc.numPages;
    if (!pageCount) {
      throw new PdfEngineError('invalid_pdf', 'This PDF reports zero pages.');
    }

    const pages: PdfPageInfo[] = [];
    const textPages: PdfTextPage[] = [];
    const annotations: PdfAnnotation[] = [];
    let textWordCount = 0;

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });

      let pageText = '';
      try {
        const content = await page.getTextContent();
        let previous = '';
        for (const item of content.items) {
          if (!('str' in item) || typeof item.str !== 'string') continue;
          const str = item.str;
          if (previous && /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(str)) {
            pageText += ' ';
          }
          pageText += str;
          previous = str;
          if (item.hasEOL) pageText += '\n';
        }
      } catch {
        warnings.push(`Page ${i}: text layer could not be decoded.`);
      }

      const normalizedPageText = normalizePdfText(pageText);
      const pageWords = countWords(normalizedPageText);
      textWordCount += pageWords;
      pages.push({
        pageNumber: i,
        width: Math.round(viewport.width * 100) / 100,
        height: Math.round(viewport.height * 100) / 100,
        rotation: page.rotate,
        textWordCount: pageWords,
      });
      textPages.push({ pageNumber: i, text: normalizedPageText });

      try {
        const rawAnnotations = await page.getAnnotations({ intent: 'display' });
        rawAnnotations.forEach((annotation, index) => {
          const subtype = mapAnnotationSubtype(annotation.subtype);
          annotations.push({
            id: annotation.id || `ann_${i}_${index}`,
            pageNumber: i,
            type: subtype,
            author: annotation.titleObj?.str || undefined,
            date: formatPdfDate(annotation.modificationDate),
            content: annotation.contentsObj?.str || undefined,
            rect: Array.isArray(annotation.rect)
              ? (annotation.rect.slice(0, 4).map((n) => Math.round(n * 100) / 100) as [
                  number,
                  number,
                  number,
                  number,
                ])
              : undefined,
          });
        });
      } catch {
        warnings.push(`Page ${i}: annotations could not be read.`);
      }
    }

    let outline: PdfOutlineItem[] = [];
    try {
      outline = await flattenOutline(doc, await doc.getOutline());
    } catch {
      warnings.push('Bookmarks/outline could not be read.');
    }

    let forms = { hasAcroForm: false, fieldCount: 0, fields: [] as PdfFormField[] };
    try {
      const fieldObjects = await doc.getFieldObjects();
      if (fieldObjects && Object.keys(fieldObjects).length > 0) {
        const fields: PdfFormField[] = Object.entries(fieldObjects).map(([name, objects]) => {
          const first = (objects?.[0] ?? {}) as Record<string, unknown>;
          const options = Array.isArray(first.options)
            ? (first.options as Array<Record<string, unknown>>)
                .map((opt) => (typeof opt.exportValue === 'string' ? opt.exportValue : ''))
                .filter(Boolean)
            : undefined;
          return {
            name,
            type: typeof first.type === 'string' ? first.type : 'field',
            value: typeof first.value === 'string' ? first.value : undefined,
            readOnly: Boolean(first.readOnly),
            required: Boolean(first.required),
            options,
          };
        });
        forms = { hasAcroForm: true, fieldCount: fields.length, fields };
      }
    } catch {
      // No AcroForm: expected for generated and most exported PDFs.
    }

    let metadata: PdfMetadata = {};
    try {
      const meta = await doc.getMetadata();
      const info = (meta.info ?? {}) as Record<string, unknown>;
      metadata = {
        title: readInfoString(info, 'Title'),
        author: readInfoString(info, 'Author'),
        subject: readInfoString(info, 'Subject'),
        keywords: readInfoString(info, 'Keywords'),
        creator: readInfoString(info, 'Creator'),
        producer: readInfoString(info, 'Producer'),
        creationDate: formatPdfDate(info.CreationDate),
        modificationDate: formatPdfDate(info.ModDate),
      };
    } catch {
      warnings.push('Document metadata could not be read.');
    }

    if (textWordCount === 0) {
      warnings.push(
        'No extractable text layer. This PDF is likely a scan/image export, so text search and grounding are unavailable.',
      );
    } else if (textWordCount < pageCount * 12) {
      warnings.push('Very little extractable text — the document may be partially scanned.');
    }

    return {
      pageCount,
      pages,
      textPages,
      plainText: normalizePdfText(textPages.map((p) => p.text).join('\n\n')),
      textWordCount,
      outline,
      annotations,
      forms,
      metadata,
      warnings,
    };
  } finally {
    try {
      loadingTask.destroy();
    } catch {
      // Ignore teardown races
    }
  }
}

export async function extractPdfText(
  buffer: Buffer,
): Promise<{ pages: PdfTextPage[]; plainText: string; textWordCount: number }> {
  const extracted = await extractDocument(assertPdfBuffer(buffer));
  return {
    pages: extracted.textPages,
    plainText: extracted.plainText,
    textWordCount: extracted.textWordCount,
  };
}

export async function inspectPdfBuffer(
  buffer: Buffer,
  meta: PdfFileMeta,
  options: { includePlainTextByPage?: boolean; previewChars?: number } = {},
): Promise<PdfInspection> {
  const bytes = assertPdfBuffer(buffer);
  const extracted = await extractDocument(bytes);
  const scannedLikely = extracted.textWordCount < extracted.pageCount * 12;

  const file: PdfAttachment = {
    ...meta,
    mimeType: 'application/pdf',
    pageCount: extracted.pageCount,
    textWordCount: extracted.textWordCount,
    metadataFlags: {
      encrypted: false,
      scannedLikely,
      hasForms: extracted.forms.hasAcroForm,
      hasAnnotations: extracted.annotations.length > 0,
    },
  };

  return {
    file,
    pageCount: extracted.pageCount,
    pages: extracted.pages,
    outline: extracted.outline,
    metadata: extracted.metadata,
    forms: extracted.forms,
    annotations: extracted.annotations,
    textPreview: truncateText(extracted.plainText, options.previewChars ?? 4000),
    ...(options.includePlainTextByPage ? { plainTextByPage: extracted.textPages } : {}),
    extractionWarnings: extracted.warnings,
    validation: {
      valid: true,
      errors: [],
      warnings:
        extracted.pages.length === 0 ? ['No pages were found in this PDF.'] : extracted.warnings,
    },
    capabilities: PDF_CAPABILITIES,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Search
 * -----------------------------------------------------------------------------------------------*/

export async function searchPdfBuffer(
  buffer: Buffer,
  query: string,
  options: { pageNumber?: number; maxMatches?: number; contextChars?: number } = {},
): Promise<PdfSearchResult> {
  const bytes = assertPdfBuffer(buffer);
  const needle = (query || '').trim();
  if (!needle) {
    throw new PdfEngineError('unsupported_operation', 'A non-empty search query is required.');
  }

  const extracted = await extractDocument(bytes);
  const warnings = [...extracted.warnings];
  const maxMatches = Math.max(1, Math.min(options.maxMatches ?? 40, 200));
  const context = Math.max(20, Math.min(options.contextChars ?? 90, 400));
  const matches: PdfSearchMatch[] = [];
  let totalMatches = 0;

  const targetPages = options.pageNumber
    ? extracted.textPages.filter((p) => p.pageNumber === options.pageNumber)
    : extracted.textPages;

  if (options.pageNumber && targetPages.length === 0) {
    throw new PdfEngineError(
      'page_out_of_range',
      `Page ${options.pageNumber} does not exist in this ${extracted.pageCount}-page PDF.`,
    );
  }

  const lowerNeedle = needle.toLowerCase();
  for (const page of targetPages) {
    const haystack = page.text.toLowerCase();
    let fromIndex = 0;
    while (fromIndex <= haystack.length) {
      const hit = haystack.indexOf(lowerNeedle, fromIndex);
      if (hit === -1) break;
      totalMatches += 1;
      if (matches.length < maxMatches) {
        const start = Math.max(0, hit - context);
        const end = Math.min(page.text.length, hit + needle.length + context);
        const snippet = page.text
          .slice(start, end)
          .replace(/\s+/g, ' ')
          .trim();
        matches.push({ pageNumber: page.pageNumber, snippet, matchIndex: totalMatches });
      }
      fromIndex = hit + Math.max(1, needle.length);
    }
  }

  if (extracted.textWordCount === 0) {
    warnings.push('This PDF has no text layer, so keyword search cannot return matches.');
  } else if (totalMatches === 0) {
    warnings.push(`No occurrences of "${needle}" were found in this PDF.`);
  }

  return {
    query: needle,
    matches,
    totalMatches,
    pagesSearched: targetPages.length,
    warnings: Array.from(new Set(warnings)),
  };
}

/* -------------------------------------------------------------------------------------------------
 * Generation — a small deterministic PDF layout engine (no DOCX/OOXML anywhere)
 * -----------------------------------------------------------------------------------------------*/

export type PdfBlockType =
  | 'cover_page'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'paragraph'
  | 'bullet_list'
  | 'numbered_list'
  | 'table'
  | 'key_values'
  | 'callout'
  | 'quote'
  | 'divider'
  | 'page_break'
  | 'toc';

export interface PdfBlockInput {
  type: PdfBlockType | string;
  text?: string;
  subtitle?: string;
  calloutTitle?: string;
  items?: string[];
  headers?: string[];
  rows?: string[][];
  pairs?: Array<{ label: string; value: string }>;
}

export interface CreatePdfSpec {
  filename: string;
  title: string;
  subtitle?: string;
  headerText?: string;
  pageSize?: 'letter' | 'a4';
  orientation?: 'portrait' | 'landscape';
  includePageNumbers?: boolean;
  blocks: PdfBlockInput[];
}

export interface CreatePdfResult {
  buffer: Buffer;
  filename: string;
  pageCount: number;
  textWordCount: number;
  title: string;
  warnings: string[];
}

const COLOR_PLUM = rgb(0.431, 0.086, 0.169); // #6E162B Sovereign Garnet
const COLOR_ACCENT = rgb(0.659, 0.125, 0.243); // #A8203E Venetian Carmine
const COLOR_INK = rgb(0.122, 0.09, 0.106); // #1F171B
const COLOR_MUTED = rgb(0.388, 0.337, 0.361); // #63565C
const COLOR_BORDER = rgb(0.89, 0.875, 0.894); // #E3DFE4
const COLOR_SOFT = rgb(0.984, 0.945, 0.953); // #FBF1F3
const COLOR_WHITE = rgb(1, 1, 1);
const COLOR_RULE = rgb(0.922, 0.796, 0.824); // #EBCBD2

const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
} as const;

const WIN_ANSI_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

const CHAR_FALLBACKS: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '⇒': '=>',
  '≤': '<=',
  '≥': '>=',
  '≈': '~',
  '≠': '!=',
  '✔': 'v',
  '✓': 'v',
  '✕': 'x',
  '★': '*',
  '—': '-',
  '–': '-',
  '…': '...',
  '\u00a0': ' ',
};

/** Standard PDF fonts are WinAnsi-encoded; normalise anything outside that repertoire. */
function sanitizeForWinAnsi(input: string): string {
  if (!input) return '';
  let out = '';
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9) {
      out += '    ';
      continue;
    }
    if (code === 10) {
      out += '\n';
      continue;
    }
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(code)) {
      out += char;
      continue;
    }
    const fallback = CHAR_FALLBACKS[char];
    out += fallback ?? '?';
  }
  return out;
}

function sanitizeLines(text: string): string[] {
  return sanitizeForWinAnsi(text)
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''));
}

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = sanitizeForWinAnsi(text);
  if (!clean.trim()) return [''];
  const words = clean.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';

  const pushWord = (word: string) => {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      return;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    // Long unbroken token: hard-wrap it.
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      let chunk = '';
      for (const char of word) {
        const next = chunk + char;
        if (font.widthOfTextAtSize(next, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk = next;
        }
      }
      current = chunk;
    } else {
      current = word;
    }
  };

  for (const word of words) pushWord(word);
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function wrapParagraph(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of sanitizeForWinAnsi(text).split('\n')) {
    if (!rawLine.trim()) {
      lines.push('');
      continue;
    }
    lines.push(...wrapLine(rawLine, font, size, maxWidth));
  }
  return lines;
}

/** Strips lightweight markdown emphasis from agent-authored block text. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');
}

interface ComposerFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
}

interface ComposerOptions {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  headerText?: string;
  includePageNumbers: boolean;
  title: string;
}

class PdfComposer {
  readonly doc: PDFDocument;
  readonly fonts: ComposerFonts;
  readonly options: ComposerOptions;
  private page: PDFPage | null = null;
  private y = 0;
  private firstContentPageIsCover = false;

  constructor(doc: PDFDocument, fonts: ComposerFonts, options: ComposerOptions) {
    this.doc = doc;
    this.fonts = fonts;
    this.options = options;
    doc.setTitle(sanitizeForWinAnsi(options.title));
    doc.setProducer('Vod PDF');
    doc.setCreator('Vod PDF');
  }

  get contentWidth(): number {
    return this.options.pageWidth - this.options.margin * 2;
  }

  get bottomLimit(): number {
    return this.options.margin + 26;
  }

  startPage(isCover = false): void {
    this.page = this.doc.addPage([this.options.pageWidth, this.options.pageHeight]);
    this.y = this.options.pageHeight - this.options.margin;
    if (isCover) {
      this.firstContentPageIsCover = true;
    }
  }

  private get currentPage(): PDFPage {
    if (!this.page) this.startPage();
    return this.page as PDFPage;
  }

  private ensureSpace(height: number): void {
    if (this.y - height < this.bottomLimit) {
      this.startPage();
    }
  }

  space(height: number): void {
    this.y -= height;
  }

  drawLines(
    lines: string[],
    opts: { font: PDFFont; size: number; color?: typeof COLOR_INK; lineHeight?: number; indent?: number },
  ): void {
    const lineHeight = opts.lineHeight ?? opts.size * 1.42;
    const indent = opts.indent ?? 0;
    for (const line of lines) {
      this.ensureSpace(lineHeight);
      if (line) {
        this.currentPage.drawText(line, {
          x: this.options.margin + indent,
          y: this.y - opts.size,
          size: opts.size,
          font: opts.font,
          color: opts.color ?? COLOR_INK,
        });
      }
      this.y -= lineHeight;
    }
  }

  paragraph(text: string, opts: { size?: number; color?: typeof COLOR_MUTED; indent?: number; gap?: number } = {}): void {
    const size = opts.size ?? 10.5;
    const maxWidth = this.contentWidth - (opts.indent ?? 0);
    const lines = wrapParagraph(stripInlineMarkdown(text), this.fonts.regular, size, maxWidth);
    this.drawLines(lines, {
      font: this.fonts.regular,
      size,
      color: opts.color ?? COLOR_MUTED,
      indent: opts.indent,
    });
    this.space(opts.gap ?? 8);
  }

  heading(text: string, level: 1 | 2 | 3): void {
    const size = level === 1 ? 16 : level === 2 ? 12.5 : 11;
    const gapBefore = level === 1 ? 14 : 10;
    const accentWidth = level === 1 ? 34 : 22;
    this.space(gapBefore);
    const lines = wrapParagraph(stripInlineMarkdown(text), this.fonts.bold, size, this.contentWidth - 8);
    this.ensureSpace(lines.length * size * 1.35 + 14);
    for (const line of lines) {
      this.currentPage.drawText(line, {
        x: this.options.margin,
        y: this.y - size,
        size,
        font: this.fonts.bold,
        color: COLOR_PLUM,
      });
      this.y -= size * 1.35;
    }
    this.y -= 3;
    this.currentPage.drawRectangle({
      x: this.options.margin,
      y: this.y,
      width: accentWidth,
      height: 2,
      color: COLOR_ACCENT,
    });
    this.y -= level === 1 ? 12 : 9;
  }

  list(items: string[], ordered: boolean): void {
    const size = 10.5;
    const indent = 16;
    items.forEach((item, index) => {
      const marker = ordered ? `${index + 1}.` : '•';
      const label = stripInlineMarkdown(item);
      const lines = wrapParagraph(label, this.fonts.regular, size, this.contentWidth - indent - 8);
      this.ensureSpace(size * 1.42 * lines.length + 3);
      this.currentPage.drawText(marker, {
        x: this.options.margin + 2,
        y: this.y - size,
        size,
        font: ordered ? this.fonts.bold : this.fonts.regular,
        color: COLOR_ACCENT,
      });
      this.drawLines(lines, { font: this.fonts.regular, size, indent: indent });
      this.space(3);
    });
    this.space(6);
  }

  callout(title: string | undefined, text: string): void {
    const padding = 12;
    const size = 10.5;
    const innerWidth = this.contentWidth - padding * 2 - 4;
    const titleLines = title
      ? wrapParagraph(stripInlineMarkdown(title), this.fonts.bold, 9, innerWidth)
      : [];
    const bodyLines = wrapParagraph(stripInlineMarkdown(text), this.fonts.regular, size, innerWidth);
    const lineHeight = size * 1.45;
    const boxHeight =
      padding * 2 + titleLines.length * 14 + (titleLines.length ? 4 : 0) + bodyLines.length * lineHeight;

    if (boxHeight > this.options.pageHeight - this.bottomLimit - this.options.margin) {
      // Very long callout: fall back to flowing text so it can break across pages.
      if (title) {
        this.drawLines(titleLines, { font: this.fonts.bold, size: 9, color: COLOR_PLUM });
        this.space(3);
      }
      this.drawLines(bodyLines, { font: this.fonts.regular, size, color: COLOR_INK });
      this.space(8);
      return;
    }

    this.ensureSpace(boxHeight + 10);
    const top = this.y;
    this.currentPage.drawRectangle({
      x: this.options.margin,
      y: top - boxHeight,
      width: this.contentWidth,
      height: boxHeight,
      color: COLOR_SOFT,
      borderColor: COLOR_BORDER,
      borderWidth: 0.8,
    });
    this.currentPage.drawRectangle({
      x: this.options.margin,
      y: top - boxHeight,
      width: 3,
      height: boxHeight,
      color: COLOR_ACCENT,
    });

    this.y = top - padding - 1;
    if (titleLines.length) {
      this.drawLines(titleLines, {
        font: this.fonts.bold,
        size: 9,
        color: COLOR_PLUM,
        indent: padding + 4,
        lineHeight: 14,
      });
      this.space(4);
    }
    this.drawLines(bodyLines, {
      font: this.fonts.regular,
      size,
      color: COLOR_INK,
      indent: padding + 4,
      lineHeight,
    });
    this.y = top - boxHeight - 12;
  }

  quote(text: string): void {
    const size = 10.5;
    const indent = 16;
    const lines = wrapParagraph(stripInlineMarkdown(text), this.fonts.italic, size, this.contentWidth - indent);
    const blockHeight = lines.length * size * 1.45 + 6;
    this.ensureSpace(blockHeight);
    const top = this.y;
    this.currentPage.drawRectangle({
      x: this.options.margin,
      y: top - blockHeight,
      width: 2,
      height: blockHeight,
      color: COLOR_RULE,
    });
    this.drawLines(lines, {
      font: this.fonts.italic,
      size,
      color: COLOR_MUTED,
      indent,
      lineHeight: size * 1.45,
    });
    this.space(10);
  }

  divider(): void {
    this.ensureSpace(16);
    this.space(6);
    this.currentPage.drawLine({
      start: { x: this.options.margin, y: this.y },
      end: { x: this.options.pageWidth - this.options.margin, y: this.y },
      thickness: 0.8,
      color: COLOR_BORDER,
    });
    this.space(12);
  }

  keyValues(pairs: Array<{ label: string; value: string }>): void {
    const size = 10;
    const labelWidth = 0.34 * this.contentWidth;
    const valueWidth = this.contentWidth - labelWidth - 12;
    for (const pair of pairs) {
      const labelLines = wrapParagraph(stripInlineMarkdown(pair.label), this.fonts.bold, size, labelWidth);
      const valueLines = wrapParagraph(stripInlineMarkdown(pair.value), this.fonts.regular, size, valueWidth);
      const rows = Math.max(labelLines.length, valueLines.length);
      const blockHeight = rows * size * 1.45 + 10;
      this.ensureSpace(blockHeight);
      this.drawLines(labelLines, { font: this.fonts.bold, size, color: COLOR_PLUM, lineHeight: size * 1.45 });
      this.y += labelLines.length * size * 1.45;
      this.drawLines(valueLines, {
        font: this.fonts.regular,
        size,
        color: COLOR_INK,
        indent: labelWidth + 12,
        lineHeight: size * 1.45,
      });
      this.y -= 10;
    }
    this.space(4);
  }

  table(headers: string[], rows: string[][]): void {
    const cols = Math.max(headers.length, 1);
    const colWidth = this.contentWidth / cols;
    const size = 9;
    const padding = 5;
    const headerHeight = 22;
    const cellLines = (value: string) =>
      wrapParagraph(stripInlineMarkdown(value ?? ''), this.fonts.regular, size, colWidth - padding * 2);
    const headerLines = headers.map((h) =>
      wrapParagraph(stripInlineMarkdown(h ?? ''), this.fonts.bold, size, colWidth - padding * 2),
    );
    const rowHeights = rows.map((row) => {
      const lineCount = Math.max(1, ...row.map((cell) => cellLines(cell).length));
      return lineCount * size * 1.4 + padding * 2;
    });

    const drawHeader = () => {
      this.ensureSpace(headerHeight + 4);
      const top = this.y;
      this.currentPage.drawRectangle({
        x: this.options.margin,
        y: top - headerHeight,
        width: this.contentWidth,
        height: headerHeight,
        color: COLOR_PLUM,
      });
      headerLines.forEach((lines, index) => {
        lines.slice(0, 1).forEach((line) => {
          this.currentPage.drawText(line, {
            x: this.options.margin + index * colWidth + padding,
            y: top - headerHeight + 7.5,
            size,
            font: this.fonts.bold,
            color: COLOR_WHITE,
          });
        });
      });
      this.y = top - headerHeight;
    };

    drawHeader();

    rows.forEach((row, rowIndex) => {
      const height = rowHeights[rowIndex];
      if (this.y - height < this.bottomLimit) {
        this.startPage();
        drawHeader();
      }
      const top = this.y;
      if (rowIndex % 2 === 1) {
        this.currentPage.drawRectangle({
          x: this.options.margin,
          y: top - height,
          width: this.contentWidth,
          height,
          color: COLOR_SOFT,
        });
      }
      row.forEach((cell, colIndex) => {
        const lines = cellLines(cell);
        lines.forEach((line, lineIndex) => {
          this.currentPage.drawText(line, {
            x: this.options.margin + colIndex * colWidth + padding,
            y: top - padding - size - lineIndex * size * 1.4,
            size,
            font: this.fonts.regular,
            color: COLOR_INK,
          });
        });
      });
      this.currentPage.drawRectangle({
        x: this.options.margin,
        y: top - height,
        width: this.contentWidth,
        height,
        borderColor: COLOR_BORDER,
        borderWidth: 0.6,
      });
      for (let c = 1; c < cols; c++) {
        this.currentPage.drawLine({
          start: { x: this.options.margin + c * colWidth, y: top - height },
          end: { x: this.options.margin + c * colWidth, y: top },
          thickness: 0.4,
          color: COLOR_BORDER,
        });
      }
      this.y = top - height;
    });
    this.space(12);
  }

  /** Opens a page with a Garnet accent band — used when a document has no cover block. */
  titleBlock(title: string, subtitle?: string): void {
    this.startPage();
    const page = this.currentPage;
    const width = this.options.pageWidth;
    const height = this.options.pageHeight;
    page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: COLOR_PLUM });
    page.drawRectangle({ x: 0, y: height - 6, width: width * 0.42, height: 6, color: COLOR_ACCENT });

    const titleLines = wrapParagraph(stripInlineMarkdown(title), this.fonts.bold, 21, this.contentWidth);
    for (const line of titleLines) {
      page.drawText(line, {
        x: this.options.margin,
        y: this.y - 21,
        size: 21,
        font: this.fonts.bold,
        color: COLOR_PLUM,
      });
      this.y -= 27;
    }
    this.space(6);
    if (subtitle) {
      this.paragraph(subtitle, { size: 11.5 });
    } else {
      this.space(8);
    }
  }

  coverPage(title: string, subtitle?: string, metaLines: string[] = []): void {
    this.startPage(true);
    const page = this.currentPage;
    const width = this.options.pageWidth;
    const height = this.options.pageHeight;
    const margin = this.options.margin;

    page.drawRectangle({ x: 0, y: 0, width, height, color: COLOR_WHITE });
    page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: COLOR_PLUM });
    page.drawRectangle({ x: 0, y: height - 8, width: width * 0.42, height: 8, color: COLOR_ACCENT });

    const titleLines = wrapParagraph(
      stripInlineMarkdown(title),
      this.fonts.bold,
      27,
      this.contentWidth - 10,
    );
    let y = height - margin - 90;
    for (const line of titleLines) {
      page.drawText(line, {
        x: margin,
        y: y - 27,
        size: 27,
        font: this.fonts.bold,
        color: COLOR_PLUM,
        lineHeight: 33,
      });
      y -= 33;
    }

    y -= 6;
    page.drawRectangle({ x: margin, y, width: 64, height: 3, color: COLOR_ACCENT });
    y -= 26;

    if (subtitle) {
      const subtitleLines = wrapParagraph(
        stripInlineMarkdown(subtitle),
        this.fonts.regular,
        12.5,
        this.contentWidth - 10,
      );
      for (const line of subtitleLines) {
        page.drawText(line, {
          x: margin,
          y: y - 12.5,
          size: 12.5,
          font: this.fonts.regular,
          color: COLOR_MUTED,
        });
        y -= 20;
      }
    }

    let metaY = margin + 46 + metaLines.length * 15;
    for (const line of metaLines) {
      page.drawText(sanitizeForWinAnsi(line), {
        x: margin,
        y: metaY,
        size: 9.5,
        font: this.fonts.regular,
        color: COLOR_MUTED,
      });
      metaY -= 15;
    }
    page.drawText('Vod PDF', {
      x: margin,
      y: margin + 20,
      size: 9,
      font: this.fonts.bold,
      color: COLOR_PLUM,
    });

    // Cover is its own page; content resumes on the next one.
    this.page = null;
    this.y = 0;
  }

  finalize(): void {
    const { pageWidth, pageHeight, margin, headerText, includePageNumbers } = this.options;
    const pages = this.doc.getPages();
    const coverOffset = this.firstContentPageIsCover ? 1 : 0;
    const contentPageCount = Math.max(1, pages.length - coverOffset);

    pages.forEach((page, index) => {
      if (index < coverOffset) return;
      if (headerText) {
        const label = sanitizeForWinAnsi(headerText).toUpperCase();
        const size = 7.5;
        page.drawText(label, {
          x: margin,
          y: pageHeight - margin + 18,
          size,
          font: this.fonts.regular,
          color: COLOR_MUTED,
        });
        page.drawLine({
          start: { x: margin, y: pageHeight - margin + 13 },
          end: { x: pageWidth - margin, y: pageHeight - margin + 13 },
          thickness: 0.6,
          color: COLOR_BORDER,
        });
      }
      if (includePageNumbers) {
        const pageLabel = `${index - coverOffset + 1} / ${contentPageCount}`;
        const textWidth = this.fonts.regular.widthOfTextAtSize(pageLabel, 8.5);
        page.drawText(pageLabel, {
          x: (pageWidth - textWidth) / 2,
          y: margin - 8,
          size: 8.5,
          font: this.fonts.regular,
          color: COLOR_MUTED,
        });
      }
      page.drawText('Vod PDF', {
        x: pageWidth - margin - this.fonts.regular.widthOfTextAtSize('Vod PDF', 7.5),
        y: margin - 8,
        size: 7.5,
        font: this.fonts.regular,
        color: COLOR_RULE,
      });
    });
  }
}

async function embedComposerFonts(doc: PDFDocument): Promise<ComposerFonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
}

function drawBlocks(composer: PdfComposer, blocks: PdfBlockInput[], headings: string[]): number {
  let drawn = 0;
  let tocDrawn = false;

  for (const block of blocks) {
    const type = String(block.type || '').toLowerCase();
    switch (type) {
      case 'cover_page':
        composer.coverPage(
          block.text || 'Untitled document',
          block.subtitle,
          [new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })],
        );
        break;
      case 'heading1':
        composer.heading(block.text || '', 1);
        break;
      case 'heading2':
        composer.heading(block.text || '', 2);
        break;
      case 'heading3':
        composer.heading(block.text || '', 3);
        break;
      case 'paragraph':
        composer.paragraph(block.text || '');
        break;
      case 'bullet_list':
        composer.list(block.items ?? [], false);
        break;
      case 'numbered_list':
        composer.list(block.items ?? [], true);
        break;
      case 'table':
        composer.table(block.headers ?? [], block.rows ?? []);
        break;
      case 'key_values':
        composer.keyValues(block.pairs ?? []);
        break;
      case 'callout':
        composer.callout(block.calloutTitle, block.text || '');
        break;
      case 'quote':
        composer.quote(block.text || '');
        break;
      case 'divider':
        composer.divider();
        break;
      case 'page_break':
        composer.startPage();
        break;
      case 'toc':
        if (!tocDrawn) {
          composer.heading('Contents', 1);
          composer.list(headings.length ? headings : ['No sections'], true);
          tocDrawn = true;
        }
        break;
      default:
        if (block.text) composer.paragraph(block.text);
        break;
    }
    drawn += 1;
  }
  return drawn;
}

export async function createPdfFromSpec(spec: CreatePdfSpec): Promise<CreatePdfResult> {
  const warnings: string[] = [];
  const doc = await PDFDocument.create();
  const fonts = await embedComposerFonts(doc);

  const pageSizeKey = spec.pageSize === 'a4' ? 'a4' : 'letter';
  const base = PAGE_SIZES[pageSizeKey];
  const landscape = spec.orientation === 'landscape';
  const pageWidth = landscape ? base.height : base.width;
  const pageHeight = landscape ? base.width : base.height;

  const title = spec.title || 'Untitled document';
  const composer = new PdfComposer(doc, fonts, {
    pageWidth,
    pageHeight,
    margin: 56,
    headerText: spec.headerText,
    includePageNumbers: spec.includePageNumbers !== false,
    title,
  });

  // Footnote/prepass for a table-of-contents block.
  const headings = spec.blocks
    .filter((b) => /^heading[123]$/i.test(String(b.type)) && b.text)
    .map((b) => stripInlineMarkdown(String(b.text)));

  const blocks = spec.blocks.length
    ? spec.blocks
    : [{ type: 'paragraph', text: title } satisfies PdfBlockInput];

  // Always give the document a page: if there's no cover block, open with a title band.
  const hasCover = blocks.some((b) => String(b.type).toLowerCase() === 'cover_page');
  if (!hasCover) {
    composer.titleBlock(title, spec.subtitle);
  }

  drawBlocks(composer, blocks, headings);

  composer.finalize();

  doc.setSubject(sanitizeForWinAnsi(spec.subtitle || title));
  doc.setKeywords(['vod-pdf']);
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  const bytes = await doc.save();
  const buffer = Buffer.from(bytes);

  // Re-open the produced bytes to guarantee we report real page/word counts.
  const inspection = await extractDocument(buffer);

  return {
    buffer,
    filename: spec.filename,
    pageCount: inspection.pageCount,
    textWordCount: inspection.textWordCount,
    title,
    warnings,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Editing (capability-gated)
 * -----------------------------------------------------------------------------------------------*/

export type PdfEditOperation =
  | { type: 'append_blocks'; blocks: PdfBlockInput[] }
  | { type: 'rotate_pages'; pages?: number[]; degrees: 90 | 180 | 270 | number }
  | { type: 'delete_pages'; pages: number[] }
  | { type: 'set_metadata'; title?: string; author?: string; subject?: string; keywords?: string }
  | { type: 'add_watermark'; text: string; pages?: number[]; opacity?: number }
  | { type: 'crop_pages'; pages?: number[]; left: number; bottom: number; right: number; top: number }
  | { type: 'replace_text'; find: string; replace: string };

export interface EditPdfResult {
  buffer: Buffer;
  pageCount: number;
  textWordCount: number;
  appliedOperations: string[];
  warnings: string[];
}

export async function editPdfBuffer(
  buffer: Buffer,
  operations: PdfEditOperation[],
  meta: { title?: string; headerText?: string } = {},
): Promise<EditPdfResult> {
  const bytes = assertPdfBuffer(buffer);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const applied: string[] = [];
  const warnings: string[] = [];
  const ops = Array.isArray(operations) ? operations : [];

  if (ops.length === 0) {
    throw new PdfEngineError(
      'unsupported_operation',
      'No edit operations were supplied. Provide append_blocks, rotate_pages, delete_pages, or set_metadata.',
    );
  }

  const fonts = await embedComposerFonts(doc);

  for (const rawOp of ops) {
    const op = rawOp as unknown as Record<string, unknown>;
    const type = String(op.type || '').toLowerCase();
    if (type === 'append_blocks') {
      const blocks = Array.isArray(op.blocks) ? (op.blocks as PdfBlockInput[]) : [];
      if (blocks.length === 0) {
        warnings.push('append_blocks received no blocks; skipped.');
        continue;
      }
      const { width, height } = doc.getPage(0).getSize();
      const composer = new PdfComposer(doc, fonts, {
        pageWidth: width,
        pageHeight: height,
        margin: 56,
        headerText: meta.headerText,
        includePageNumbers: false,
        title: meta.title || 'Updated PDF',
      });
      composer.startPage();
      const drawn = drawBlocks(composer, blocks, []);
      composer.finalize();
      applied.push(`Appended ${drawn} block(s) on new page(s).`);
    } else if (type === 'rotate_pages') {
      const angle = Number(op.degrees) || 90;
      const pages = doc.getPages();
      const targetIndexes =
        Array.isArray(op.pages) && op.pages.length > 0
          ? (op.pages as unknown[]).map((p) => Number(p) - 1)
          : pages.map((_, index) => index);
      let rotated = 0;
      for (const index of targetIndexes) {
        const page = pages[index];
        if (!page) {
          warnings.push(`Page ${index + 1} does not exist; skipped rotation.`);
          continue;
        }
        const current = page.getRotation().angle;
        page.setRotation(degrees((current + angle) % 360));
        rotated += 1;
      }
      applied.push(`Rotated ${rotated} page(s) by ${angle}°.`);
    } else if (type === 'delete_pages') {
      const indexes = (Array.isArray(op.pages) ? (op.pages as unknown[]) : [])
        .map((p) => Number(p) - 1)
        .filter((index) => Number.isInteger(index) && index >= 0 && index < doc.getPageCount())
        .sort((a: number, b: number) => b - a);
      if (indexes.length === 0) {
        warnings.push('delete_pages matched no valid pages; nothing removed.');
        continue;
      }
      if (indexes.length >= doc.getPageCount()) {
        throw new PdfEngineError(
          'unsupported_operation',
          'Refusing to delete every page — a PDF must keep at least one page.',
        );
      }
      const removed = new Set(indexes);
      for (const index of indexes) doc.removePage(index);
      applied.push(`Deleted ${removed.size} page(s).`);
    } else if (type === 'set_metadata') {
      if (op.title !== undefined) doc.setTitle(sanitizeForWinAnsi(String(op.title)));
      if (op.author !== undefined) doc.setAuthor(sanitizeForWinAnsi(String(op.author)));
      if (op.subject !== undefined) doc.setSubject(sanitizeForWinAnsi(String(op.subject)));
      if (op.keywords !== undefined) {
        const keywords = Array.isArray(op.keywords)
          ? (op.keywords as unknown[]).map(String)
          : String(op.keywords).split(',');
        doc.setKeywords(keywords);
      }
      applied.push('Updated document metadata.');
    } else if (type === 'add_watermark') {
      const watermarkText = sanitizeForWinAnsi(String(op.text || '').trim());
      if (!watermarkText) {
        throw new PdfEngineError('unsupported_operation', 'add_watermark requires non-empty watermark text.');
      }
      const opacityRaw = typeof op.opacity === 'number' ? op.opacity : 0.16;
      const opacity = Math.min(0.6, Math.max(0.05, opacityRaw));
      const pages = doc.getPages();
      const targetIndexes =
        Array.isArray(op.pages) && op.pages.length > 0
          ? (op.pages as unknown[]).map((p) => Number(p) - 1)
          : pages.map((_, index) => index);
      let stamped = 0;
      for (const index of targetIndexes) {
        const page = pages[index];
        if (!page) {
          warnings.push(`Page ${index + 1} does not exist; skipped watermark.`);
          continue;
        }
        const { width, height } = page.getSize();
        const fontSize = Math.min(54, Math.max(22, Math.floor(width / Math.max(watermarkText.length * 0.65, 6))));
        const textWidth = fonts.bold.widthOfTextAtSize(watermarkText, fontSize);
        const rad = (45 * Math.PI) / 180;
        const x = width / 2 - (textWidth / 2) * Math.cos(rad) + (fontSize / 2) * Math.sin(rad);
        const y = height / 2 - (textWidth / 2) * Math.sin(rad) - (fontSize / 2) * Math.cos(rad);
        page.drawText(watermarkText, {
          x,
          y,
          size: fontSize,
          font: fonts.bold,
          color: COLOR_ACCENT,
          opacity,
          rotate: degrees(45),
        });
        stamped += 1;
      }
      applied.push(`Stamped watermark "${watermarkText}" on ${stamped} page(s).`);
    } else if (type === 'crop_pages') {
      const left = Number(op.left);
      const bottom = Number(op.bottom);
      const right = Number(op.right);
      const top = Number(op.top);
      if (
        !Number.isFinite(left) ||
        !Number.isFinite(bottom) ||
        !Number.isFinite(right) ||
        !Number.isFinite(top) ||
        right <= left ||
        top <= bottom
      ) {
        throw new PdfEngineError(
          'unsupported_operation',
          'crop_pages requires valid numeric left, bottom, right, and top bounds with right > left and top > bottom.',
        );
      }
      const pages = doc.getPages();
      const targetIndexes =
        Array.isArray(op.pages) && op.pages.length > 0
          ? (op.pages as unknown[]).map((p) => Number(p) - 1)
          : pages.map((_, index) => index);
      let cropped = 0;
      for (const index of targetIndexes) {
        const page = pages[index];
        if (!page) {
          warnings.push(`Page ${index + 1} does not exist; skipped crop.`);
          continue;
        }
        page.setCropBox(left, bottom, right - left, top - bottom);
        page.setMediaBox(left, bottom, right - left, top - bottom);
        cropped += 1;
      }
      applied.push(`Cropped ${cropped} page(s) to [${left}, ${bottom}, ${right}, ${top}].`);
    } else if (type === 'replace_text') {
      throw new PdfEngineError(
        'unsupported_operation',
        'In-place text replacement inside arbitrary existing PDFs is not supported by the Vod PDF engine. ' +
          'Supported alternatives: append corrected content with append_blocks, add an annotation, fill a form field, or generate a new PDF.',
      );
    } else {
      throw new PdfEngineError(
        'unsupported_operation',
        `Unsupported edit operation "${op.type}". Supported: append_blocks, rotate_pages, delete_pages, set_metadata, add_watermark, crop_pages.`,
      );
    }
  }

  doc.setProducer('Vod PDF');
  doc.setModificationDate(new Date());
  const out = Buffer.from(await doc.save());
  const inspection = await extractDocument(out);

  return {
    buffer: out,
    pageCount: inspection.pageCount,
    textWordCount: inspection.textWordCount,
    appliedOperations: applied,
    warnings,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Annotations / comments
 * -----------------------------------------------------------------------------------------------*/

export interface AnnotatePdfInput {
  pageNumber: number;
  text: string;
  author?: string;
  anchorText?: string;
  rect?: [number, number, number, number];
}

export interface AnnotatePdfResult {
  buffer: Buffer;
  commentId: string;
  pageNumber: number;
  anchored: boolean;
  annotationCount: number;
}

function pdfDateLiteral(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

async function findAnchorRect(
  buffer: Buffer,
  pageNumber: number,
  anchorText: string,
): Promise<[number, number, number, number] | null> {
  const { doc, loadingTask } = await openPdfJsDocument(buffer);
  try {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const needle = anchorText.toLowerCase();
    for (const item of content.items) {
      if (!('str' in item) || typeof item.str !== 'string' || !item.transform) continue;
      const text = item.str.toLowerCase();
      const hit = text.indexOf(needle);
      if (hit === -1) continue;
      const [a, b, c, d, e, f] = item.transform;
      const fontHeight = Math.hypot(c, d) || Math.hypot(a, b) || 10;
      const width = item.width ?? (needle.length * fontHeight * 0.5);
      const offset = (hit / Math.max(text.length, 1)) * width;
      return [e + offset - 2, f - 3, e + offset + width + 2, f + fontHeight + 2];
    }
    return null;
  } catch {
    return null;
  } finally {
    try {
      loadingTask.destroy();
    } catch {
      // Ignore
    }
  }
}

export async function annotatePdfBuffer(
  buffer: Buffer,
  input: AnnotatePdfInput,
): Promise<AnnotatePdfResult> {
  const bytes = assertPdfBuffer(buffer);
  if (!input.text || !input.text.trim()) {
    throw new PdfEngineError('unsupported_operation', 'Comment text is required.');
  }

  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageCount = doc.getPageCount();
  const pageNumber = Math.trunc(Number(input.pageNumber) || 1);
  if (pageNumber < 1 || pageNumber > pageCount) {
    throw new PdfEngineError(
      'page_out_of_range',
      `Page ${pageNumber} does not exist in this ${pageCount}-page PDF.`,
    );
  }

  const page = doc.getPage(pageNumber - 1);
  const { width, height } = page.getSize();
  let rect: [number, number, number, number] | null = input.rect ?? null;
  let anchored = Boolean(input.rect);

  if (!rect && input.anchorText) {
    const found = await findAnchorRect(bytes, pageNumber, input.anchorText);
    if (found) {
      rect = found;
      anchored = true;
    }
  }

  if (!rect) {
    // Sticky-note position in the top-right margin of the page.
    rect = [width - 54, height - 46, width - 32, height - 24];
  }

  const context = doc.context;
  const createdAt = new Date();
  const commentId = `annot_${pageNumber}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  const annotation = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: context.obj(rect.map((n) => PDFNumber.of(n))),
    Contents: PDFString.of(sanitizeForWinAnsi(input.text)),
    T: PDFString.of(sanitizeForWinAnsi(input.author || 'Vod PDF')),
    Subj: PDFString.of('Comment'),
    Name: PDFName.of('Comment'),
    M: PDFString.of(pdfDateLiteral(createdAt)),
    NM: PDFString.of(commentId),
    C: context.obj([PDFNumber.of(0.659), PDFNumber.of(0.125), PDFNumber.of(0.243)]),
    F: PDFNumber.of(4),
  });

  const annotationRef = context.register(annotation);
  const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (existing) {
    existing.push(annotationRef);
    page.node.set(PDFName.of('Annots'), existing);
  } else {
    page.node.set(PDFName.of('Annots'), context.obj([annotationRef]));
  }

  // Visible marker so the comment is discoverable in any PDF renderer.
  const markerSize = 14;
  const markerX = Math.min(Math.max(rect[0] - markerSize - 4, 4), width - markerSize - 4);
  const markerY = Math.min(Math.max(rect[3] - markerSize / 2, 4), height - markerSize - 4);
  page.drawRectangle({
    x: markerX,
    y: markerY,
    width: markerSize,
    height: markerSize,
    color: COLOR_ACCENT,
    borderColor: COLOR_WHITE,
    borderWidth: 1,
    opacity: 0.92,
  });
  page.drawText('!', {
    x: markerX + 5.4,
    y: markerY + 4.2,
    size: 9,
    font: await doc.embedFont(StandardFonts.HelveticaBold),
    color: COLOR_WHITE,
  });

  doc.setProducer('Vod PDF');
  doc.setModificationDate(createdAt);

  const out = Buffer.from(await doc.save());
  const inspection = await extractDocument(out);

  return {
    buffer: out,
    commentId,
    pageNumber,
    anchored,
    annotationCount: inspection.annotations.length,
  };
}

/* -------------------------------------------------------------------------------------------------
 * AcroForm filling
 * -----------------------------------------------------------------------------------------------*/

export interface FillPdfFormResult {
  buffer: Buffer;
  filledCount: number;
  missingFields: string[];
  warnings: string[];
}

export async function fillPdfFormBuffer(
  buffer: Buffer,
  fields: Record<string, string | boolean>,
  options: { flatten?: boolean } = {},
): Promise<FillPdfFormResult> {
  const bytes = assertPdfBuffer(buffer);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = doc.getForm();
  const available = new Set(form.getFields().map((field) => field.getName()));
  const filled: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  if (available.size === 0) {
    throw new PdfEngineError(
      'form_not_found',
      'This PDF has no AcroForm fields, so there is nothing to fill. It may be a flattened or scanned document.',
    );
  }

  for (const [name, value] of Object.entries(fields ?? {})) {
    if (!available.has(name)) {
      missing.push(name);
      continue;
    }
    try {
      const textField = form.getTextField(name);
      textField.setText(String(value ?? ''));
      filled.push(name);
      continue;
    } catch {
      // Not a text field; try checkbox/radio/dropdown below.
    }
    try {
      const checkbox = form.getCheckBox(name);
      if (value === true || value === 'true' || value === 'on') checkbox.check();
      else checkbox.uncheck();
      filled.push(name);
      continue;
    } catch {
      // Not a checkbox
    }
    try {
      const radio = form.getRadioGroup(name);
      radio.select(String(value ?? ''));
      filled.push(name);
      continue;
    } catch {
      // Not a radio group
    }
    try {
      const dropdown = form.getDropdown(name);
      dropdown.select(String(value ?? ''));
      filled.push(name);
      continue;
    } catch {
      warnings.push(`Field "${name}" exists but its type is not supported for filling.`);
    }
  }

  if (options.flatten) {
    try {
      form.flatten();
    } catch {
      warnings.push('Fields were filled but could not be flattened.');
    }
  }

  doc.setProducer('Vod PDF');
  doc.setModificationDate(new Date());
  const out = Buffer.from(await doc.save());

  return {
    buffer: out,
    filledCount: filled.length,
    missingFields: missing,
    warnings,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Page organization: merge / extract / split / rotate
 * -----------------------------------------------------------------------------------------------*/

export interface OrganizePdfResult {
  buffer: Buffer;
  pageCount: number;
  warnings: string[];
}

export function parsePageRange(range: string, pageCount: number): number[] {
  const indexes = new Set<number>();
  for (const chunk of String(range || '').split(',')) {
    const part = chunk.trim();
    if (!part) continue;
    const match = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!match) {
      throw new PdfEngineError('unsupported_operation', `Invalid page range segment "${part}".`);
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (start < 1 || end < start) {
      throw new PdfEngineError('unsupported_operation', `Invalid page range "${part}".`);
    }
    for (let page = start; page <= end; page++) {
      if (page > pageCount) {
        throw new PdfEngineError(
          'page_out_of_range',
          `Page ${page} is outside this ${pageCount}-page PDF.`,
        );
      }
      indexes.add(page - 1);
    }
  }
  const ordered = Array.from(indexes).sort((a, b) => a - b);
  if (ordered.length === 0) {
    throw new PdfEngineError('unsupported_operation', 'No pages were selected.');
  }
  return ordered;
}

export async function mergePdfs(buffers: Buffer[], title?: string): Promise<OrganizePdfResult> {
  if (!Array.isArray(buffers) || buffers.length === 0) {
    throw new PdfEngineError('unsupported_operation', 'Provide at least one PDF to merge.');
  }
  const merged = await PDFDocument.create();
  const warnings: string[] = [];
  for (const raw of buffers) {
    const bytes = assertPdfBuffer(raw);
    let source: PDFDocument;
    try {
      source = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unreadable PDF';
      warnings.push(`Skipped a source PDF that could not be parsed: ${message}`);
      continue;
    }
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  if (merged.getPageCount() === 0) {
    throw new PdfEngineError('invalid_pdf', 'No pages could be merged from the supplied PDFs.');
  }
  if (title) merged.setTitle(sanitizeForWinAnsi(title));
  merged.setProducer('Vod PDF');
  merged.setCreator('Vod PDF');
  merged.setModificationDate(new Date());
  const out = Buffer.from(await merged.save());
  return { buffer: out, pageCount: merged.getPageCount(), warnings };
}

export async function extractPdfPages(buffer: Buffer, range: string): Promise<OrganizePdfResult> {
  const bytes = assertPdfBuffer(buffer);
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const indexes = parsePageRange(range, source.getPageCount());
  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, indexes);
  pages.forEach((page) => out.addPage(page));
  out.setProducer('Vod PDF');
  out.setModificationDate(new Date());
  const saved = Buffer.from(await out.save());
  return { buffer: saved, pageCount: out.getPageCount(), warnings: [] };
}

export async function splitPdf(buffer: Buffer, ranges: string[]): Promise<OrganizePdfResult[]> {
  const bytes = assertPdfBuffer(buffer);
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const segments = Array.isArray(ranges) && ranges.length > 0
    ? ranges
    : source.getPageIndices().map((index) => String(index + 1));
  const results: OrganizePdfResult[] = [];
  for (const range of segments) {
    const indexes = parsePageRange(range, source.getPageCount());
    const out = await PDFDocument.create();
    const pages = await out.copyPages(source, indexes);
    pages.forEach((page) => out.addPage(page));
    out.setProducer('Vod PDF');
    out.setModificationDate(new Date());
    results.push({
      buffer: Buffer.from(await out.save()),
      pageCount: out.getPageCount(),
      warnings: [],
    });
  }
  return results;
}

export async function rotatePdfPages(
  buffer: Buffer,
  pages: number[] | undefined,
  angle: number,
): Promise<OrganizePdfResult> {
  const bytes = assertPdfBuffer(buffer);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const normalized = ((Number(angle) % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(normalized)) {
    throw new PdfEngineError(
      'unsupported_operation',
      'Rotation must be a multiple of 90 degrees (90, 180, or 270).',
    );
  }
  const docPages = doc.getPages();
  const targets = Array.isArray(pages) && pages.length > 0
    ? pages
    : docPages.map((_, index) => index + 1);
  for (const pageNumber of targets) {
    const page = docPages[pageNumber - 1];
    if (!page) {
      throw new PdfEngineError(
        'page_out_of_range',
        `Page ${pageNumber} does not exist in this ${docPages.length}-page PDF.`,
      );
    }
    page.setRotation(degrees(normalized));
  }
  doc.setProducer('Vod PDF');
  doc.setModificationDate(new Date());
  return {
    buffer: Buffer.from(await doc.save()),
    pageCount: doc.getPageCount(),
    warnings: [],
  };
}
