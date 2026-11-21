import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  NumberFormat,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import type {
  DocxAttachment,
  DocxInspection,
  DocxOutlineItem,
} from '../src/types/vod.ts';
import {
  acceptTrackedChangesInXml,
  applyTextEditInXml,
  escapeXml,
  extractCommentsFromXml,
  extractTrackedChangesFromXml,
  mergeAdjacentRunsInXml,
  sanitizeDocxFilename,
  unescapeXml,
  validateOoxmlPackageEntries,
} from './docxUtils.ts';

export interface DocxBlockInput {
  type:
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
  text?: string;
  subtitle?: string;
  items?: string[];
  headers?: string[];
  rows?: string[][];
  pairs?: Array<{ label: string; value: string }>;
  calloutTitle?: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface CreateDocxInput {
  filename: string;
  title: string;
  subtitle?: string;
  author?: string;
  pageSize?: 'letter' | 'a4';
  orientation?: 'portrait' | 'landscape';
  headerText?: string;
  includePageNumbers?: boolean;
  blocks: DocxBlockInput[];
}

function parseInlineRuns(text: string, defaultBold = false, defaultItalic = false): TextRun[] {
  // Supports lightweight **bold** and *italic* inline markers cleanly without literal asterisks
  const runs: TextRun[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(
        new TextRun({
          text: text.slice(lastIndex, match.index),
          bold: defaultBold,
          italics: defaultItalic,
        }),
      );
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      runs.push(
        new TextRun({
          text: token.slice(2, -2),
          bold: true,
          italics: defaultItalic,
        }),
      );
    } else {
      runs.push(
        new TextRun({
          text: token.slice(1, -1),
          bold: defaultBold,
          italics: true,
        }),
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    runs.push(
      new TextRun({
        text: text.slice(lastIndex),
        bold: defaultBold,
        italics: defaultItalic,
      }),
    );
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text: '' }));
  }

  return runs;
}

function splitLines(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => line.length > 0 || (arr.length === 1 && idx === 0));
}

function resolveAlignment(align?: 'left' | 'center' | 'right') {
  if (align === 'center') return AlignmentType.CENTER;
  if (align === 'right') return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

/**
 * Strips ZIP folder entries (ending with slash) per skills/docx/SKILL.md cloud co-editing
 * compatibility rule and validates core OOXML parts.
 */
async function repackWithoutDirectoryEntries(rawBuffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(rawBuffer);
  const cleanZip = new JSZip();
  const entries: Record<string, string | Uint8Array> = {};

  for (const [name, fileObj] of Object.entries(zip.files)) {
    if (fileObj.dir || name.endsWith('/')) {
      continue;
    }
    const isText = name.endsWith('.xml') || name.endsWith('.rels');
    if (isText) {
      const content = await fileObj.async('string');
      entries[name] = content;
      cleanZip.file(name, content, { createFolders: false });
    } else {
      const content = await fileObj.async('uint8array');
      entries[name] = content;
      cleanZip.file(name, content, { createFolders: false });
    }
  }

  const validation = validateOoxmlPackageEntries(entries);
  if (!validation.valid) {
    throw new Error(`OOXML validation failed: ${validation.errors.join('; ')}`);
  }

  return Buffer.from(
    await cleanZip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    }),
  );
}

export async function createDocxFromSpec(input: CreateDocxInput): Promise<{
  buffer: Buffer;
  filename: string;
  wordCount: number;
  pageCountEstimate: number;
}> {
  const filename = sanitizeDocxFilename(input.filename || input.title);
  const isA4 = input.pageSize === 'a4';
  const isLandscape = input.orientation === 'landscape';

  // Per SKILL.md: always pass portrait dimensions; docx-js swaps internally for LANDSCAPE
  const portraitWidth = isA4 ? 11906 : 12240;
  const portraitHeight = isA4 ? 16838 : 15840;
  const margin = 1440; // 1 inch
  const contentWidthDxa = (isLandscape ? portraitHeight : portraitWidth) - margin * 2;

  const children: Array<Paragraph | Table | TableOfContents> = [];
  let totalWords = 0;
  const countWords = (s: string) => {
    const matches = s.trim().match(/\S+/g);
    if (matches) totalWords += matches.length;
  };

  const hasExplicitCover = input.blocks.some((b) => b.type === 'cover_page');

  // Document Title & Subtitle (skip if user explicitly provided a cover_page block)
  if (!hasExplicitCover && input.title) {
    countWords(input.title);
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        spacing: { before: 0, after: input.subtitle ? 80 : 200 },
        children: [
          new TextRun({
            text: input.title,
            font: 'Calibri',
            size: 44, // 22pt
            bold: true,
            color: '0F172A',
          }),
        ],
      }),
    );
  }

  if (!hasExplicitCover && input.subtitle) {
    countWords(input.subtitle);
    children.push(
      new Paragraph({
        spacing: { before: 0, after: 240 },
        border: {
          bottom: {
            color: 'CBD5E1',
            space: 8,
            style: BorderStyle.SINGLE,
            size: 6,
          },
        },
        children: [
          new TextRun({
            text: input.subtitle,
            font: 'Calibri',
            size: 22, // 11pt
            color: '475569',
          }),
        ],
      }),
    );
  }

  for (const block of input.blocks) {
    switch (block.type) {
      case 'cover_page': {
        const coverTitle = block.text || input.title;
        const coverSubtitle = block.subtitle || input.subtitle;
        countWords(coverTitle);
        if (coverSubtitle) countWords(coverSubtitle);

        children.push(
          new Paragraph({
            spacing: { before: 1800, after: 180 },
            children: [
              new TextRun({
                text: coverTitle,
                font: 'Calibri',
                size: 56, // 28pt
                bold: true,
                color: '0F172A',
              }),
            ],
          }),
        );
        if (coverSubtitle) {
          children.push(
            new Paragraph({
              spacing: { before: 0, after: 360 },
              border: {
                bottom: { style: BorderStyle.SINGLE, size: 12, color: '1A73E8', space: 12 },
              },
              children: [
                new TextRun({
                  text: coverSubtitle,
                  font: 'Calibri',
                  size: 26,
                  color: '475569',
                }),
              ],
            }),
          );
        }
        if (block.pairs && block.pairs.length > 0) {
          const leftW = Math.floor(contentWidthDxa * 0.34);
          const rightW = contentWidthDxa - leftW;
          children.push(
            new Table({
              columnWidths: [leftW, rightW],
              width: { size: contentWidthDxa, type: WidthType.DXA },
              rows: block.pairs.map((p) => {
                countWords(p.label);
                countWords(p.value);
                return new TableRow({
                  children: [
                    new TableCell({
                      width: { size: leftW, type: WidthType.DXA },
                      shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
                      margins: { top: 80, bottom: 80, left: 120, right: 120 },
                      borders: {
                        top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                      },
                      children: [
                        new Paragraph({
                          spacing: { before: 0, after: 0 },
                          children: [new TextRun({ text: p.label, bold: true, size: 20, color: '475569' })],
                        }),
                      ],
                    }),
                    new TableCell({
                      width: { size: rightW, type: WidthType.DXA },
                      shading: { fill: 'FFFFFF', type: ShadingType.CLEAR },
                      margins: { top: 80, bottom: 80, left: 120, right: 120 },
                      borders: {
                        top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                      },
                      children: [
                        new Paragraph({
                          spacing: { before: 0, after: 0 },
                          children: parseInlineRuns(p.value),
                        }),
                      ],
                    }),
                  ],
                });
              }),
            }),
          );
        }
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      }
      case 'heading1': {
        for (const line of splitLines(block.text)) {
          countWords(line);
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              children: parseInlineRuns(line, true, false),
            }),
          );
        }
        break;
      }
      case 'heading2': {
        for (const line of splitLines(block.text)) {
          countWords(line);
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              children: parseInlineRuns(line, true, false),
            }),
          );
        }
        break;
      }
      case 'heading3': {
        for (const line of splitLines(block.text)) {
          countWords(line);
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_3,
              children: parseInlineRuns(line, true, false),
            }),
          );
        }
        break;
      }
      case 'paragraph': {
        for (const line of splitLines(block.text)) {
          countWords(line);
          children.push(
            new Paragraph({
              alignment: resolveAlignment(block.align),
              spacing: { before: 0, after: 140, line: 276 },
              children: parseInlineRuns(line, Boolean(block.bold), Boolean(block.italic)),
            }),
          );
        }
        break;
      }
      case 'bullet_list': {
        const items = block.items ?? [];
        for (const item of items) {
          countWords(item);
          children.push(
            new Paragraph({
              numbering: { reference: 'vod-bullets', level: 0 },
              spacing: { before: 40, after: 80, line: 276 },
              children: parseInlineRuns(item),
            }),
          );
        }
        break;
      }
      case 'numbered_list': {
        const items = block.items ?? [];
        for (const item of items) {
          countWords(item);
          children.push(
            new Paragraph({
              numbering: { reference: 'vod-numbers', level: 0 },
              spacing: { before: 40, after: 80, line: 276 },
              children: parseInlineRuns(item),
            }),
          );
        }
        break;
      }
      case 'callout': {
        const title = block.calloutTitle || 'Executive Note';
        const bodyLines = splitLines(block.text);
        countWords(title);
        bodyLines.forEach(countWords);

        // Single-column shaded callout table with dual DXA widths & ShadingType.CLEAR per SKILL.md
        const calloutParagraphs: Paragraph[] = [
          new Paragraph({
            spacing: { before: 40, after: 60 },
            children: [
              new TextRun({
                text: title,
                bold: true,
                size: 22,
                color: '1D4ED8',
              }),
            ],
          }),
          ...bodyLines.map(
            (line) =>
              new Paragraph({
                spacing: { before: 0, after: 60, line: 264 },
                children: parseInlineRuns(line),
              }),
          ),
        ];

        children.push(
          new Table({
            columnWidths: [contentWidthDxa],
            width: { size: contentWidthDxa, type: WidthType.DXA },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: contentWidthDxa, type: WidthType.DXA },
                    shading: { fill: 'F1F5F9', type: ShadingType.CLEAR },
                    margins: { top: 140, bottom: 140, left: 200, right: 200 },
                    borders: {
                      top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
                      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
                      left: { style: BorderStyle.SINGLE, size: 18, color: '1A73E8' },
                      right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
                    },
                    children: calloutParagraphs,
                  }),
                ],
              }),
            ],
          }),
        );
        children.push(new Paragraph({ spacing: { before: 0, after: 120 }, children: [] }));
        break;
      }
      case 'table': {
        const headers = block.headers ?? [];
        const rows = block.rows ?? [];
        const colCount = Math.max(
          headers.length,
          ...rows.map((r) => r.length),
          1,
        );
        const baseColWidth = Math.floor(contentWidthDxa / colCount);
        const colWidths = Array.from({ length: colCount }, (_, i) =>
          i === colCount - 1
            ? contentWidthDxa - baseColWidth * (colCount - 1)
            : baseColWidth,
        );

        const tableRows: TableRow[] = [];

        if (headers.length > 0) {
          tableRows.push(
            new TableRow({
              tableHeader: true,
              children: colWidths.map((colW, idx) => {
                const cellText = headers[idx] ?? '';
                countWords(cellText);
                return new TableCell({
                  width: { size: colW, type: WidthType.DXA },
                  shading: { fill: '1E293B', type: ShadingType.CLEAR },
                  margins: { top: 100, bottom: 100, left: 140, right: 140 },
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 4, color: '1E293B' },
                    bottom: { style: BorderStyle.SINGLE, size: 4, color: '1E293B' },
                    left: { style: BorderStyle.SINGLE, size: 4, color: '334155' },
                    right: { style: BorderStyle.SINGLE, size: 4, color: '334155' },
                  },
                  children: [
                    new Paragraph({
                      spacing: { before: 0, after: 0 },
                      children: [
                        new TextRun({
                          text: cellText,
                          bold: true,
                          size: 20,
                          color: 'FFFFFF',
                        }),
                      ],
                    }),
                  ],
                });
              }),
            }),
          );
        }

        rows.forEach((row, rIdx) => {
          const fill = rIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF';
          tableRows.push(
            new TableRow({
              children: colWidths.map((colW, cIdx) => {
                const cellText = row[cIdx] ?? '';
                countWords(cellText);
                return new TableCell({
                  width: { size: colW, type: WidthType.DXA },
                  shading: { fill, type: ShadingType.CLEAR },
                  margins: { top: 90, bottom: 90, left: 140, right: 140 },
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                    left: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                    right: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                  },
                  children: [
                    new Paragraph({
                      spacing: { before: 0, after: 0 },
                      children: parseInlineRuns(cellText),
                    }),
                  ],
                });
              }),
            }),
          );
        });

        if (tableRows.length > 0) {
          children.push(
            new Table({
              columnWidths: colWidths,
              width: { size: contentWidthDxa, type: WidthType.DXA },
              rows: tableRows,
            }),
          );
          children.push(new Paragraph({ spacing: { before: 0, after: 140 }, children: [] }));
        }
        break;
      }
      case 'key_values': {
        const pairs = block.pairs ?? [];
        if (pairs.length > 0) {
          const labelW = Math.floor(contentWidthDxa * 0.32);
          const valueW = contentWidthDxa - labelW;
          children.push(
            new Table({
              columnWidths: [labelW, valueW],
              width: { size: contentWidthDxa, type: WidthType.DXA },
              rows: pairs.map((pair) => {
                countWords(pair.label);
                countWords(pair.value);
                return new TableRow({
                  children: [
                    new TableCell({
                      width: { size: labelW, type: WidthType.DXA },
                      shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
                      margins: { top: 80, bottom: 80, left: 140, right: 140 },
                      borders: {
                        top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                        left: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                        right: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                      },
                      children: [
                        new Paragraph({
                          spacing: { before: 0, after: 0 },
                          children: [new TextRun({ text: pair.label, bold: true, size: 20, color: '334155' })],
                        }),
                      ],
                    }),
                    new TableCell({
                      width: { size: valueW, type: WidthType.DXA },
                      shading: { fill: 'FFFFFF', type: ShadingType.CLEAR },
                      margins: { top: 80, bottom: 80, left: 140, right: 140 },
                      borders: {
                        top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                        left: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                        right: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                      },
                      children: [
                        new Paragraph({
                          spacing: { before: 0, after: 0 },
                          children: parseInlineRuns(pair.value),
                        }),
                      ],
                    }),
                  ],
                });
              }),
            }),
          );
          children.push(new Paragraph({ spacing: { before: 0, after: 140 }, children: [] }));
        }
        break;
      }
      case 'quote': {
        for (const line of splitLines(block.text)) {
          countWords(line);
          children.push(
            new Paragraph({
              indent: { left: 420 },
              spacing: { before: 60, after: 100, line: 276 },
              border: {
                left: { style: BorderStyle.SINGLE, size: 12, color: '94A3B8', space: 12 },
              },
              children: parseInlineRuns(line, false, true),
            }),
          );
        }
        break;
      }
      case 'divider': {
        children.push(
          new Paragraph({
            spacing: { before: 120, after: 160 },
            border: {
              bottom: {
                color: 'CBD5E1',
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
            children: [],
          }),
        );
        break;
      }
      case 'page_break': {
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      }
      case 'toc': {
        children.push(
          new TableOfContents('Table of Contents', {
            hyperlink: true,
            headingStyleRange: '1-3',
          }),
        );
        children.push(new Paragraph({ spacing: { before: 0, after: 140 }, children: [] }));
        break;
      }
    }
  }

  const doc = new Document({
    creator: input.author || 'Vod Word Autonomous Officer',
    title: input.title,
    description: input.subtitle || input.title,
    features: {
      updateFields: true,
    },
    styles: {
      default: {
        document: {
          run: {
            font: 'Calibri',
            size: 22, // 11pt
            color: '1E293B',
          },
          paragraph: {
            spacing: { line: 276, after: 120 },
          },
        },
        heading1: {
          run: {
            font: 'Calibri',
            size: 32, // 16pt
            bold: true,
            color: '0F172A',
          },
          paragraph: {
            spacing: { before: 280, after: 120 },
            keepNext: true,
          },
        },
        heading2: {
          run: {
            font: 'Calibri',
            size: 26, // 13pt
            bold: true,
            color: '1E3A8A',
          },
          paragraph: {
            spacing: { before: 220, after: 90 },
            keepNext: true,
          },
        },
        heading3: {
          run: {
            font: 'Calibri',
            size: 23, // 11.5pt
            bold: true,
            color: '334155',
          },
          paragraph: {
            spacing: { before: 160, after: 60 },
            keepNext: true,
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'vod-bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '\u2022',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: 720, hanging: 360 },
                },
              },
            },
          ],
        },
        {
          reference: 'vod-numbers',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: 720, hanging: 360 },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: portraitWidth,
              height: portraitHeight,
              orientation: isLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: margin,
              right: margin,
              bottom: margin,
              left: margin,
            },
            pageNumbers: {
              start: 1,
              formatType: NumberFormat.DECIMAL,
            },
          },
        },
        headers: input.headerText
          ? {
              default: new Header({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({
                        text: input.headerText,
                        size: 18,
                        color: '64748B',
                      }),
                    ],
                  }),
                ],
              }),
            }
          : undefined,
        footers:
          input.includePageNumbers !== false
            ? {
                default: new Footer({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      children: [
                        new TextRun({
                          text: 'Page ',
                          size: 18,
                          color: '64748B',
                        }),
                        new TextRun({
                          children: [PageNumber.CURRENT],
                          size: 18,
                          color: '64748B',
                        }),
                        new TextRun({
                          text: ' of ',
                          size: 18,
                          color: '64748B',
                        }),
                        new TextRun({
                          children: [PageNumber.TOTAL_PAGES],
                          size: 18,
                          color: '64748B',
                        }),
                      ],
                    }),
                  ],
                }),
              }
            : undefined,
        children,
      },
    ],
  });

  const rawBuffer = await Packer.toBuffer(doc);
  const buffer = await repackWithoutDirectoryEntries(rawBuffer);
  const pageCountEstimate = Math.max(1, Math.ceil(totalWords / 380));

  return {
    buffer,
    filename,
    wordCount: totalWords,
    pageCountEstimate,
  };
}

export async function inspectDocxBuffer(
  buffer: Buffer,
  fileMeta: DocxAttachment,
): Promise<DocxInspection> {
  const zip = await JSZip.loadAsync(buffer);
  const entries: Record<string, string | Uint8Array> = {};
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      entries[name] = new Uint8Array();
    } else if (name.endsWith('.xml') || name.endsWith('.rels')) {
      entries[name] = await entry.async('string');
    } else {
      entries[name] = await entry.async('uint8array');
    }
  }

  const validation = validateOoxmlPackageEntries(entries);
  const documentXml = typeof entries['word/document.xml'] === 'string' ? entries['word/document.xml'] : '';
  const commentsXml = typeof entries['word/comments.xml'] === 'string' ? entries['word/comments.xml'] : '';

  const [rawTextResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ buffer }).catch(() => ({ value: '' })),
    mammoth.convertToHtml({ buffer }).catch(() => ({ value: '' })),
  ]);

  const plainText = rawTextResult.value.trim();
  const words = plainText ? plainText.split(/\s+/).length : 0;

  // Parse outline & paragraph/table counts directly from OOXML
  const paragraphs = documentXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? [];
  const tables = documentXml.match(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g) ?? [];
  const outline: DocxOutlineItem[] = [];

  for (const pXml of paragraphs) {
    const styleMatch = pXml.match(/<w:pStyle\s+w:val="([^"]+)"/);
    const styleVal = styleMatch?.[1] ?? '';
    let level = 0;
    if (/^Title$/i.test(styleVal)) level = 1;
    else if (/^Heading1$/i.test(styleVal)) level = 1;
    else if (/^Heading2$/i.test(styleVal)) level = 2;
    else if (/^Heading3$/i.test(styleVal)) level = 3;

    if (level > 0) {
      const pText = Array.from(pXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
        .map((m) => unescapeXml(m[1]))
        .join('')
        .trim();
      if (pText) {
        outline.push({ level, text: pText });
      }
    }
  }

  // Convert mammoth HTML tags lightly into clean markdown summary for AI context
  const markdownPreview = htmlResult.value
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    file: fileMeta,
    wordCount: words,
    paragraphCount: paragraphs.length,
    tableCount: tables.length,
    outline,
    plainText,
    markdownPreview: markdownPreview || plainText,
    comments: extractCommentsFromXml(commentsXml),
    trackedChanges: extractTrackedChangesFromXml(documentXml),
    documentXml: documentXml.slice(0, 60000),
    validation,
  };
}

export interface EditDocxOptions {
  replacements?: Array<{ find: string; replace: string }>;
  trackedChange?: boolean;
  author?: string;
  appendBlocks?: DocxBlockInput[];
}

export async function editDocxBuffer(
  sourceBuffer: Buffer,
  options: EditDocxOptions,
): Promise<{
  buffer: Buffer;
  totalReplacements: number;
  appendedBlocks: number;
  wordCount: number;
  pageCountEstimate: number;
}> {
  const zip = await JSZip.loadAsync(sourceBuffer);
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) {
    throw new Error('Invalid .docx package: missing word/document.xml');
  }

  let docXml = mergeAdjacentRunsInXml(await docEntry.async('string'));
  let totalReplacements = 0;
  let nextRevId = 500;
  const dateIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  for (const rep of options.replacements ?? []) {
    const res = applyTextEditInXml(docXml, rep.find, rep.replace, {
      trackedChange: options.trackedChange,
      author: options.author || 'Vod Word',
      dateIso,
      startId: nextRevId,
    });
    docXml = res.xml;
    totalReplacements += res.replacements;
    nextRevId += Math.max(2, res.replacements * 2);
  }

  let appendedBlocks = 0;
  if (options.appendBlocks && options.appendBlocks.length > 0) {
    const insertXmlChunks: string[] = [];
    for (const block of options.appendBlocks) {
      appendedBlocks++;
      if (block.type === 'heading1' || block.type === 'heading2' || block.type === 'heading3') {
        const styleId =
          block.type === 'heading1'
            ? 'Heading1'
            : block.type === 'heading2'
              ? 'Heading2'
              : 'Heading3';
        const txt = escapeXml(block.text || '');
        const runXml = `<w:r><w:rPr><w:b/></w:rPr><w:t>${txt}</w:t></w:r>`;
        const wrapped = options.trackedChange
          ? `<w:ins w:id="${nextRevId++}" w:author="${escapeXml(options.author || 'Vod Word')}" w:date="${dateIso}">${runXml}</w:ins>`
          : runXml;
        insertXmlChunks.push(`<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>${wrapped}</w:p>`);
      } else if (block.type === 'bullet_list' || block.type === 'numbered_list') {
        for (const item of block.items ?? []) {
          const prefix = block.type === 'bullet_list' ? '• ' : '- ';
          const txt = escapeXml(`${prefix}${item}`);
          const runXml = `<w:r><w:t xml:space="preserve">${txt}</w:t></w:r>`;
          const wrapped = options.trackedChange
            ? `<w:ins w:id="${nextRevId++}" w:author="${escapeXml(options.author || 'Vod Word')}" w:date="${dateIso}">${runXml}</w:ins>`
            : runXml;
          insertXmlChunks.push(`<w:p>${wrapped}</w:p>`);
        }
      } else if (block.type === 'page_break') {
        insertXmlChunks.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      } else {
        for (const line of splitLines(block.text)) {
          const txt = escapeXml(line);
          const runXml = `<w:r><w:t xml:space="preserve">${txt}</w:t></w:r>`;
          const wrapped = options.trackedChange
            ? `<w:ins w:id="${nextRevId++}" w:author="${escapeXml(options.author || 'Vod Word')}" w:date="${dateIso}">${runXml}</w:ins>`
            : runXml;
          insertXmlChunks.push(`<w:p>${wrapped}</w:p>`);
        }
      }
    }

    const sectPrIdx = docXml.lastIndexOf('<w:sectPr');
    const insertionPayload = insertXmlChunks.join('');
    if (sectPrIdx !== -1) {
      docXml = `${docXml.slice(0, sectPrIdx)}${insertionPayload}${docXml.slice(sectPrIdx)}`;
    } else {
      docXml = docXml.replace('</w:body>', `${insertionPayload}</w:body>`);
    }
  }

  zip.file('word/document.xml', docXml);
  const rawBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const buffer = await repackWithoutDirectoryEntries(rawBuffer);

  const rawText = await mammoth.extractRawText({ buffer }).catch(() => ({ value: '' }));
  const wordCount = rawText.value.trim() ? rawText.value.trim().split(/\s+/).length : 0;

  return {
    buffer,
    totalReplacements,
    appendedBlocks,
    wordCount,
    pageCountEstimate: Math.max(1, Math.ceil(wordCount / 380)),
  };
}

export async function addCommentToDocxBuffer(
  sourceBuffer: Buffer,
  commentText: string,
  author = 'Vod Word',
  anchorText?: string,
): Promise<{ buffer: Buffer; commentId: string; anchored: boolean }> {
  const zip = await JSZip.loadAsync(sourceBuffer);
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) {
    throw new Error('Invalid .docx package: missing word/document.xml');
  }

  let docXml = mergeAdjacentRunsInXml(await docEntry.async('string'));
  const existingCommentsFile = zip.file('word/comments.xml');
  let commentsXml = existingCommentsFile
    ? await existingCommentsFile.async('string')
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"></w:comments>`;

  const existingIds = Array.from(commentsXml.matchAll(/w:id="(\d+)"/g)).map((m) => Number(m[1]));
  const nextId = String(existingIds.length > 0 ? Math.max(...existingIds) + 1 : 0);
  const dateIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const initials = author
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('')
    .slice(0, 3) || 'VW';

  const newCommentXml = `<w:comment w:id="${nextId}" w:author="${escapeXml(author)}" w:date="${dateIso}" w:initials="${escapeXml(initials)}"><w:p><w:r><w:t xml:space="preserve">${escapeXml(commentText)}</w:t></w:r></w:p></w:comment>`;
  commentsXml = commentsXml.replace('</w:comments>', `${newCommentXml}</w:comments>`);
  zip.file('word/comments.xml', commentsXml);

  // Ensure [Content_Types].xml includes comments override
  const ctEntry = zip.file('[Content_Types].xml');
  if (ctEntry) {
    let ctXml = await ctEntry.async('string');
    if (!ctXml.includes('/word/comments.xml')) {
      ctXml = ctXml.replace(
        '</Types>',
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>',
      );
      zip.file('[Content_Types].xml', ctXml);
    }
  }

  // Ensure word/_rels/document.xml.rels includes comments relationship
  const relsPath = 'word/_rels/document.xml.rels';
  const relsEntry = zip.file(relsPath);
  if (relsEntry) {
    let relsXml = await relsEntry.async('string');
    if (!relsXml.includes('relationships/comments')) {
      const relIds = Array.from(relsXml.matchAll(/Id="rId(\d+)"/g)).map((m) => Number(m[1]));
      const nextRid = `rId${relIds.length > 0 ? Math.max(...relIds) + 1 : 10}`;
      relsXml = relsXml.replace(
        '</Relationships>',
        `<Relationship Id="${nextRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`,
      );
      zip.file(relsPath, relsXml);
    }
  }

  // Anchor comment range markers into word/document.xml
  let anchored = false;
  if (anchorText) {
    const escapedAnchor = escapeXml(anchorText);
    const pMatches = docXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? [];
    for (const pXml of pMatches) {
      if (pXml.includes(escapedAnchor)) {
        const innerCloseIdx = pXml.lastIndexOf('</w:p>');
        const firstRunIdx = pXml.indexOf('<w:r');
        if (firstRunIdx !== -1 && innerCloseIdx !== -1) {
          const updatedP = `${pXml.slice(0, firstRunIdx)}<w:commentRangeStart w:id="${nextId}"/>${pXml.slice(firstRunIdx, innerCloseIdx)}<w:commentRangeEnd w:id="${nextId}"/><w:r><w:commentReference w:id="${nextId}"/></w:r></w:p>`;
          docXml = docXml.replace(pXml, updatedP);
          anchored = true;
          break;
        }
      }
    }
  }

  if (!anchored) {
    // Fallback: attach to the first paragraph with text
    const firstP = docXml.match(/<w:p\b[^>]*>[\s\S]*?<w:r\b[\s\S]*?<\/w:p>/);
    if (firstP) {
      const pXml = firstP[0];
      const firstRunIdx = pXml.indexOf('<w:r');
      const innerCloseIdx = pXml.lastIndexOf('</w:p>');
      const updatedP = `${pXml.slice(0, firstRunIdx)}<w:commentRangeStart w:id="${nextId}"/>${pXml.slice(firstRunIdx, innerCloseIdx)}<w:commentRangeEnd w:id="${nextId}"/><w:r><w:commentReference w:id="${nextId}"/></w:r></w:p>`;
      docXml = docXml.replace(pXml, updatedP);
      anchored = true;
    }
  }

  zip.file('word/document.xml', docXml);
  const rawBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const buffer = await repackWithoutDirectoryEntries(rawBuffer);

  return { buffer, commentId: nextId, anchored };
}

export async function acceptAllDocxChangesBuffer(sourceBuffer: Buffer): Promise<{
  buffer: Buffer;
  acceptedInsertions: number;
  acceptedDeletions: number;
}> {
  const zip = await JSZip.loadAsync(sourceBuffer);
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) {
    throw new Error('Invalid .docx package: missing word/document.xml');
  }
  const docXml = await docEntry.async('string');
  const accepted = acceptTrackedChangesInXml(docXml);
  zip.file('word/document.xml', accepted.xml);

  const rawBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const buffer = await repackWithoutDirectoryEntries(rawBuffer);
  return {
    buffer,
    acceptedInsertions: accepted.acceptedInsertions,
    acceptedDeletions: accepted.acceptedDeletions,
  };
}

export async function searchDocxBuffer(
  sourceBuffer: Buffer,
  query: string,
): Promise<{ matches: Array<{ paragraphIndex: number; text: string }> }> {
  const raw = await mammoth.extractRawText({ buffer: sourceBuffer }).catch(() => ({ value: '' }));
  const paragraphs = raw.value
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      matches: paragraphs.slice(0, 25).map((text, idx) => ({ paragraphIndex: idx + 1, text })),
    };
  }

  const matches: Array<{ paragraphIndex: number; text: string }> = [];
  paragraphs.forEach((text, idx) => {
    if (text.toLowerCase().includes(q)) {
      matches.push({ paragraphIndex: idx + 1, text });
    }
  });
  return { matches: matches.slice(0, 40) };
}
