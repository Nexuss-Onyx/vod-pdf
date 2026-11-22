import {
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  GoogleGenAI,
  type Part,
  ThinkingLevel,
  Type,
} from '@google/genai';
import type { AgentToolStep, PdfAttachment } from '../src/types/vod.ts';
import type { PdfBlockInput, PdfEditOperation } from './pdfEngine.ts';
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
import { formatBytes } from './pdfUtils.ts';
import { workspaceStore } from './store.ts';
import { buildVodPdfSystemPrompt } from './systemPrompt.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const BLOCK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    type: {
      type: Type.STRING,
      description:
        'One of: cover_page, heading1, heading2, heading3, paragraph, bullet_list, numbered_list, table, key_values, callout, quote, divider, page_break, toc.',
    },
    text: { type: Type.STRING, description: 'Text for headings, paragraphs, callouts, quotes, or the cover title.' },
    subtitle: { type: Type.STRING, description: 'Subtitle when type is cover_page.' },
    calloutTitle: { type: Type.STRING, description: 'Title when type is callout.' },
    items: { type: Type.ARRAY, items: { type: Type.STRING } },
    headers: { type: Type.ARRAY, items: { type: Type.STRING } },
    rows: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.STRING } } },
    pairs: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          value: { type: Type.STRING },
        },
        required: ['label', 'value'],
      },
    },
  },
  required: ['type'],
};

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'list_files',
    description:
      'List available PDF files in the current session or across the workspace, with file IDs, page counts, word counts, and summaries.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        includeAllSessions: {
          type: Type.BOOLEAN,
          description: 'If true, lists every PDF in the workspace, not just this session.',
        },
      },
    },
  },
  {
    name: 'inspect_pdf',
    description:
      'Inspect a PDF: page count and sizes, metadata, outline/bookmarks, AcroForm fields, annotations, text preview, validation warnings, and engine capabilities.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING, description: 'The ID of the PDF to inspect.' },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'search_pdf',
    description:
      'Search the text layer of a PDF for a keyword or phrase. Returns page numbers and snippets. Scanned PDFs without a text layer return no matches.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING, description: 'The ID of the PDF to search.' },
        query: { type: Type.STRING, description: 'Keyword or phrase to find.' },
        page: { type: Type.NUMBER, description: 'Optional 1-based page to restrict the search to.' },
      },
      required: ['fileId', 'query'],
    },
  },
  {
    name: 'create_pdf',
    description:
      'Create a polished PDF document with the Vod PDF layout engine (cover page, headings, paragraphs, lists, tables, key-values, callouts, quotes, dividers, page breaks).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filename: { type: Type.STRING, description: 'Filename ending in .pdf.' },
        title: { type: Type.STRING, description: 'Document title.' },
        subtitle: { type: Type.STRING, description: 'Optional subtitle.' },
        pageSize: { type: Type.STRING, description: '"letter" (default) or "a4".' },
        orientation: { type: Type.STRING, description: '"portrait" (default) or "landscape".' },
        headerText: { type: Type.STRING, description: 'Optional running header text on content pages.' },
        summary: { type: Type.STRING, description: 'One-sentence summary of the document.' },
        blocks: { type: Type.ARRAY, description: 'Ordered content blocks.', items: BLOCK_SCHEMA },
      },
      required: ['filename', 'title', 'blocks'],
    },
  },
  {
    name: 'edit_pdf',
    description:
      'Apply supported PDF edits: append_blocks (new page(s) at the end), rotate_pages, delete_pages, set_metadata. In-place text replacement (replace_text) is NOT supported and returns unsupported_operation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING, description: 'Source PDF file ID.' },
        newFilename: { type: Type.STRING, description: 'Optional output filename (.pdf).' },
        summary: { type: Type.STRING, description: 'One-sentence summary of the edit.' },
        operations: {
          type: Type.ARRAY,
          description: 'Ordered edit operations.',
          items: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
                description: 'append_blocks | rotate_pages | delete_pages | set_metadata',
              },
              blocks: { type: Type.ARRAY, items: BLOCK_SCHEMA },
              pages: {
                type: Type.ARRAY,
                items: { type: Type.NUMBER },
                description: '1-based page numbers for rotate/delete.',
              },
              degrees: { type: Type.NUMBER, description: '90, 180, or 270 for rotate_pages.' },
              title: { type: Type.STRING },
              author: { type: Type.STRING },
              subject: { type: Type.STRING },
              keywords: { type: Type.STRING },
            },
            required: ['type'],
          },
        },
      },
      required: ['fileId', 'operations'],
    },
  },
  {
    name: 'comment_pdf',
    description:
      'Attach a PDF review comment/annotation to a page, optionally anchored to a specific phrase via anchorText.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING, description: 'The PDF to comment on.' },
        pageNumber: { type: Type.NUMBER, description: '1-based page number for the comment.' },
        commentText: { type: Type.STRING, description: 'The review comment text.' },
        anchorText: {
          type: Type.STRING,
          description: 'Optional exact phrase on that page to anchor the comment to.',
        },
      },
      required: ['fileId', 'pageNumber', 'commentText'],
    },
  },
  {
    name: 'fill_pdf_form',
    description:
      'Fill AcroForm fields in a PDF. Field names must come from inspect_pdf; unknown names are reported back.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING },
        fields: {
          type: Type.OBJECT,
          description: 'Map of field name to string/boolean value.',
        },
        flatten: {
          type: Type.BOOLEAN,
          description: 'If true, flatten fields into page content after filling.',
        },
        newFilename: { type: Type.STRING },
      },
      required: ['fileId', 'fields'],
    },
  },
  {
    name: 'organize_pdf',
    description:
      'Organize PDF pages: merge multiple PDFs, extract a page range, split into ranges, or rotate pages.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        operation: {
          type: Type.STRING,
          description: 'merge | extract | split | rotate',
        },
        fileIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'For merge: PDF IDs in output order.',
        },
        fileId: { type: Type.STRING, description: 'Source PDF ID for extract/split/rotate.' },
        range: { type: Type.STRING, description: 'Page range like "1-3,7" for extract.' },
        ranges: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Page ranges for split (one output PDF per range).',
        },
        pages: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER },
          description: '1-based pages for rotate; omit to rotate all pages.',
        },
        degrees: { type: Type.NUMBER, description: 'Rotation angle for rotate: 90, 180, 270.' },
        filename: { type: Type.STRING, description: 'Optional output filename (.pdf).' },
      },
      required: ['operation'],
    },
  },
];

export interface AgentStreamEvent {
  type: 'thought_delta' | 'text_delta' | 'tool_update' | 'done' | 'error';
  payload: unknown;
}

function toolErrorOutput(err: unknown): Record<string, unknown> {
  if (err instanceof PdfEngineError) {
    return { error: err.message, code: err.code };
  }
  return { error: err instanceof Error ? err.message : 'Tool error', code: 'engine_error' };
}

function requireFileMeta(fileId: string) {
  const meta = workspaceStore.getFileMeta(fileId);
  if (!meta) {
    throw new PdfEngineError('invalid_pdf', `File "${fileId}" was not found in this workspace.`);
  }
  return meta;
}

export async function runAutonomousPdfAgent(params: {
  sessionId: string;
  userPrompt: string;
  attachedFileId?: string;
  onEvent: (ev: AgentStreamEvent) => void;
}): Promise<{
  assistantText: string;
  thoughtText: string;
  toolSteps: AgentToolStep[];
  attachments: PdfAttachment[];
}> {
  const ai = getGeminiClient();
  const systemInstruction = buildVodPdfSystemPrompt();

  const historyMessages = workspaceStore.getSessionMessages(params.sessionId);
  const contents: Content[] = [];

  for (const msg of historyMessages.slice(-14)) {
    let text = msg.content;
    if (msg.attachments && msg.attachments.length > 0) {
      const fileList = msg.attachments
        .map(
          (a) =>
            `[PDF: "${a.filename}", fileId="${a.id}", ${a.pageCount} page(s), ${a.textWordCount} words]`,
        )
        .join(' ');
      text = `${text}\n\n${fileList}`;
    }
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text }],
    });
  }

  let promptWithContext = params.userPrompt;
  if (params.attachedFileId) {
    const fileMeta = workspaceStore.getFileMeta(params.attachedFileId);
    if (fileMeta) {
      promptWithContext = `${params.userPrompt}\n\n[Attached PDF: filename="${fileMeta.filename}", fileId="${fileMeta.id}", size=${formatBytes(fileMeta.sizeBytes)}, pages=${fileMeta.pageCount}. Inspect it with inspect_pdf before answering or editing.]`;
    }
  }

  const lastMsg = historyMessages[historyMessages.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== params.userPrompt) {
    contents.push({ role: 'user', parts: [{ text: promptWithContext }] });
  } else if (params.attachedFileId) {
    contents[contents.length - 1] = { role: 'user', parts: [{ text: promptWithContext }] };
  }

  const toolSteps: AgentToolStep[] = [];
  const producedAttachments: PdfAttachment[] = [];
  let accumulatedThoughts = '';
  let finalAssistantText = '';

  const maxIterations = 10;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const stream = await ai.models.generateContentStream({
      model: 'gemini-4-hydrogen',
      contents,
      config: {
        systemInstruction,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH,
          includeThoughts: true,
        },
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      },
    });

    const collectedModelParts: Part[] = [];
    const collectedFunctionCalls: FunctionCall[] = [];
    let turnText = '';

    for await (const chunk of stream) {
      const candidateParts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of candidateParts) {
        // Preserve thoughtSignature and functionCall parts faithfully for multi-turn continuity
        if (part.functionCall) {
          collectedFunctionCalls.push(part.functionCall);
          collectedModelParts.push(part);
        } else if (part.thought && part.text) {
          accumulatedThoughts += part.text;
          params.onEvent({
            type: 'thought_delta',
            payload: { delta: part.text },
          });
        } else if (part.text) {
          turnText += part.text;
          params.onEvent({
            type: 'text_delta',
            payload: { delta: part.text },
          });
          collectedModelParts.push(part);
        } else if (part.thoughtSignature) {
          collectedModelParts.push(part);
        }
      }
    }

    if (collectedModelParts.length > 0) {
      contents.push({ role: 'model', parts: collectedModelParts });
    }

    if (collectedFunctionCalls.length === 0) {
      finalAssistantText = turnText.trim();
      break;
    }

    const functionResponseParts: Part[] = [];

    for (const call of collectedFunctionCalls) {
      const stepId = `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const toolName = call.name || 'tool';
      const args = (call.args ?? {}) as Record<string, unknown>;

      const labelMap: Record<string, string> = {
        list_files: 'Listing PDF files',
        inspect_pdf: 'Inspecting PDF',
        search_pdf: `Searching "${String(args.query || '')}"`,
        create_pdf: `Creating ${String(args.filename || 'document.pdf')}`,
        edit_pdf: 'Editing PDF',
        comment_pdf: 'Adding PDF comment',
        fill_pdf_form: 'Filling PDF form',
        organize_pdf: `Organizing pages (${String(args.operation || 'merge')})`,
      };

      const step: AgentToolStep = {
        id: stepId,
        toolName,
        label: labelMap[toolName] || toolName,
        status: 'started',
        timestamp: new Date().toISOString(),
      };
      toolSteps.push(step);
      params.onEvent({ type: 'tool_update', payload: { ...step } });

      // Transition visibly to processing
      step.status = 'processing';
      params.onEvent({ type: 'tool_update', payload: { ...step } });

      let toolOutput: Record<string, unknown>;

      try {
        if (toolName === 'list_files') {
          const files = args.includeAllSessions
            ? workspaceStore.getAllFiles()
            : workspaceStore.getSessionFiles(params.sessionId);
          toolOutput = {
            files: files.map((f) => ({
              fileId: f.id,
              filename: f.filename,
              title: f.title,
              size: formatBytes(f.sizeBytes),
              pageCount: f.pageCount,
              textWordCount: f.textWordCount,
              version: f.version,
              summary: f.summary,
            })),
          };
          step.summary = `${files.length} file(s)`;
        } else if (toolName === 'inspect_pdf') {
          const meta = requireFileMeta(String(args.fileId || ''));
          const inspection = await inspectPdfBuffer(workspaceStore.getFileBuffer(meta.id), meta);
          toolOutput = {
            fileId: meta.id,
            filename: meta.filename,
            pageCount: inspection.pageCount,
            pages: inspection.pages.map((p) => ({
              pageNumber: p.pageNumber,
              width: p.width,
              height: p.height,
              rotation: p.rotation,
              textWordCount: p.textWordCount,
            })),
            metadata: inspection.metadata,
            outline: inspection.outline,
            forms: { hasAcroForm: inspection.forms.hasAcroForm, fieldCount: inspection.forms.fieldCount, fields: inspection.forms.fields.slice(0, 40) },
            annotations: inspection.annotations.slice(0, 40),
            validation: inspection.validation,
            capabilities: inspection.capabilities,
            textPreview: inspection.textPreview,
          };
          step.summary = `${inspection.pageCount} page(s) · ${inspection.file.textWordCount} words`;
        } else if (toolName === 'search_pdf') {
          const meta = requireFileMeta(String(args.fileId || ''));
          const found = await searchPdfBuffer(workspaceStore.getFileBuffer(meta.id), String(args.query || ''), {
            pageNumber: typeof args.page === 'number' ? args.page : undefined,
          });
          toolOutput = {
            query: found.query,
            totalMatches: found.totalMatches,
            pagesSearched: found.pagesSearched,
            matches: found.matches.slice(0, 20),
            warnings: found.warnings,
          };
          step.summary = `${found.totalMatches} match(es)`;
        } else if (toolName === 'create_pdf') {
          const blocks = Array.isArray(args.blocks) ? (args.blocks as PdfBlockInput[]) : [];
          const created = await createPdfFromSpec({
            filename: String(args.filename || 'Document.pdf'),
            title: String(args.title || 'Document'),
            subtitle: args.subtitle ? String(args.subtitle) : undefined,
            pageSize: args.pageSize === 'a4' ? 'a4' : 'letter',
            orientation: args.orientation === 'landscape' ? 'landscape' : 'portrait',
            headerText: args.headerText ? String(args.headerText) : undefined,
            includePageNumbers: true,
            blocks,
          });

          const saved = workspaceStore.savePdfFile({
            sessionId: params.sessionId,
            filename: created.filename,
            title: String(args.title || created.title),
            buffer: created.buffer,
            summary: String(args.summary || `Generated ${created.filename}`),
            pageCount: created.pageCount,
            textWordCount: created.textWordCount,
            source: 'generated',
          });
          producedAttachments.push(saved);
          step.summary = `${created.pageCount} page(s) · ${formatBytes(saved.sizeBytes)}`;
          toolOutput = {
            success: true,
            fileId: saved.id,
            filename: saved.filename,
            size: formatBytes(saved.sizeBytes),
            pageCount: created.pageCount,
            textWordCount: created.textWordCount,
            warnings: created.warnings,
          };
        } else if (toolName === 'edit_pdf') {
          const meta = requireFileMeta(String(args.fileId || ''));
          const rawOps = Array.isArray(args.operations) ? args.operations : [];
          const operations = rawOps.map((op) => {
            const record = op as Record<string, unknown>;
            return { ...record, type: String(record.type || '') } as unknown as PdfEditOperation;
          });
          const edited = await editPdfBuffer(workspaceStore.getFileBuffer(meta.id), operations, {
            title: meta.title,
            headerText: meta.title,
          });

          const nextFilename = args.newFilename
            ? String(args.newFilename)
            : meta.filename.replace(/\.pdf$/i, '_Updated.pdf');

          const saved = workspaceStore.savePdfFile({
            sessionId: params.sessionId,
            filename: nextFilename,
            title: meta.title,
            buffer: edited.buffer,
            summary: String(
              args.summary || edited.appliedOperations.join(' ') || 'Applied PDF edits.',
            ),
            pageCount: edited.pageCount,
            textWordCount: edited.textWordCount,
            source: 'edited',
          });
          producedAttachments.push(saved);
          step.summary = `${edited.appliedOperations.length} operation(s)`;
          toolOutput = {
            success: true,
            fileId: saved.id,
            filename: saved.filename,
            pageCount: edited.pageCount,
            textWordCount: edited.textWordCount,
            appliedOperations: edited.appliedOperations,
            warnings: edited.warnings,
          };
        } else if (toolName === 'comment_pdf') {
          const meta = requireFileMeta(String(args.fileId || ''));
          const annotated = await annotatePdfBuffer(workspaceStore.getFileBuffer(meta.id), {
            pageNumber: Number(args.pageNumber) || 1,
            text: String(args.commentText || ''),
            author: 'Vod PDF',
            anchorText: args.anchorText ? String(args.anchorText) : undefined,
          });
          const saved = workspaceStore.savePdfFile({
            sessionId: params.sessionId,
            filename: meta.filename.replace(/\.pdf$/i, '_Commented.pdf'),
            title: meta.title,
            buffer: annotated.buffer,
            summary: `Added a review comment on page ${annotated.pageNumber}.`,
            pageCount: meta.pageCount,
            textWordCount: meta.textWordCount,
            source: 'edited',
            metadataFlags: { ...meta.metadataFlags, hasAnnotations: true },
          });
          producedAttachments.push(saved);
          step.summary = `Comment on page ${annotated.pageNumber}`;
          toolOutput = {
            success: true,
            fileId: saved.id,
            filename: saved.filename,
            commentId: annotated.commentId,
            pageNumber: annotated.pageNumber,
            anchored: annotated.anchored,
            annotationCount: annotated.annotationCount,
          };
        } else if (toolName === 'fill_pdf_form') {
          const meta = requireFileMeta(String(args.fileId || ''));
          const rawFields = (args.fields ?? {}) as Record<string, unknown>;
          const fields: Record<string, string | boolean> = {};
          for (const [key, value] of Object.entries(rawFields)) {
            fields[key] = typeof value === 'boolean' ? value : String(value ?? '');
          }
          const filled = await fillPdfFormBuffer(workspaceStore.getFileBuffer(meta.id), fields, {
            flatten: Boolean(args.flatten),
          });
          const saved = workspaceStore.savePdfFile({
            sessionId: params.sessionId,
            filename: args.newFilename
              ? String(args.newFilename)
              : meta.filename.replace(/\.pdf$/i, '_Filled.pdf'),
            title: meta.title,
            buffer: filled.buffer,
            summary: `Filled ${filled.filledCount} form field(s).`,
            pageCount: meta.pageCount,
            textWordCount: meta.textWordCount,
            source: 'edited',
            metadataFlags: { ...meta.metadataFlags, hasForms: true },
          });
          producedAttachments.push(saved);
          step.summary = `${filled.filledCount} field(s) filled`;
          toolOutput = {
            success: true,
            fileId: saved.id,
            filename: saved.filename,
            filledCount: filled.filledCount,
            missingFields: filled.missingFields,
            warnings: filled.warnings,
          };
        } else if (toolName === 'organize_pdf') {
          const operation = String(args.operation || '').toLowerCase();
          const baseName = String(args.filename || '');

          if (operation === 'merge') {
            const ids = Array.isArray(args.fileIds) ? args.fileIds.map(String) : [];
            if (ids.length < 1) {
              throw new PdfEngineError('unsupported_operation', 'merge requires fileIds.');
            }
            const buffers = ids.map((id) => workspaceStore.getFileBuffer(id));
            const merged = await mergePdfs(buffers, baseName || 'Merged PDF');
            const saved = workspaceStore.savePdfFile({
              sessionId: params.sessionId,
              filename: baseName || 'Merged_Document.pdf',
              title: baseName || 'Merged Document',
              buffer: merged.buffer,
              summary: `Merged ${ids.length} PDFs into ${merged.pageCount} pages.`,
              pageCount: merged.pageCount,
              textWordCount: (await inspectPdfBuffer(merged.buffer, {
                id: 'temp',
                sessionId: params.sessionId,
                filename: 'temp.pdf',
                title: 'temp',
                sizeBytes: merged.buffer.length,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                version: 1,
                summary: '',
                source: 'edited',
              })).file.textWordCount,
              source: 'edited',
            });
            producedAttachments.push(saved);
            step.summary = `${merged.pageCount} page(s) merged`;
            toolOutput = { success: true, fileId: saved.id, filename: saved.filename, pageCount: merged.pageCount, warnings: merged.warnings };
          } else if (operation === 'extract') {
            const meta = requireFileMeta(String(args.fileId || ''));
            const range = String(args.range || '');
            if (!range) {
              throw new PdfEngineError('unsupported_operation', 'extract requires a page range such as "1-3".');
            }
            const extracted = await extractPdfPages(workspaceStore.getFileBuffer(meta.id), range);
            const saved = workspaceStore.savePdfFile({
              sessionId: params.sessionId,
              filename: baseName || meta.filename.replace(/\.pdf$/i, `_pages_${range.replace(/[,]/g, '-')}.pdf`),
              title: `${meta.title} (pages ${range})`,
              buffer: extracted.buffer,
              summary: `Extracted pages ${range} from ${meta.filename}.`,
              pageCount: extracted.pageCount,
              textWordCount: meta.textWordCount,
              source: 'edited',
            });
            producedAttachments.push(saved);
            step.summary = `${extracted.pageCount} page(s) extracted`;
            toolOutput = { success: true, fileId: saved.id, filename: saved.filename, pageCount: extracted.pageCount };
          } else if (operation === 'split') {
            const meta = requireFileMeta(String(args.fileId || ''));
            const ranges = Array.isArray(args.ranges) ? args.ranges.map(String) : [];
            const results = await splitPdf(workspaceStore.getFileBuffer(meta.id), ranges);
            const outputs: Array<{ fileId: string; filename: string; pageCount: number }> = [];
            for (let index = 0; index < Math.min(results.length, 8); index++) {
              const segment = results[index];
              const prefix = baseName ? baseName.replace(/\.pdf$/i, '') : meta.filename.replace(/\.pdf$/i, '');
              const range = ranges[index] || String(index + 1);
              const saved = workspaceStore.savePdfFile({
                sessionId: params.sessionId,
                filename: `${prefix}_part_${index + 1}_${range.replace(/,/g, '-')}.pdf`,
                title: `${meta.title} (part ${index + 1})`,
                buffer: segment.buffer,
                summary: `Split segment ${index + 1} (pages ${range}).`,
                pageCount: segment.pageCount,
                textWordCount: 0,
                source: 'edited',
              });
              producedAttachments.push(saved);
              outputs.push({ fileId: saved.id, filename: saved.filename, pageCount: segment.pageCount });
            }
            step.summary = `${outputs.length} part(s) created`;
            toolOutput = { success: true, outputs };
          } else if (operation === 'rotate') {
            const meta = requireFileMeta(String(args.fileId || ''));
            const pages = Array.isArray(args.pages) ? args.pages.map(Number) : undefined;
            const rotated = await rotatePdfPages(
              workspaceStore.getFileBuffer(meta.id),
              pages,
              Number(args.degrees) || 90,
            );
            const saved = workspaceStore.savePdfFile({
              sessionId: params.sessionId,
              filename: baseName || meta.filename.replace(/\.pdf$/i, '_Rotated.pdf'),
              title: meta.title,
              buffer: rotated.buffer,
              summary: `Rotated ${pages && pages.length ? `page(s) ${pages.join(', ')}` : 'all pages'} by ${Number(args.degrees) || 90}°.`,
              pageCount: rotated.pageCount,
              textWordCount: meta.textWordCount,
              source: 'edited',
            });
            producedAttachments.push(saved);
            step.summary = `Rotated by ${Number(args.degrees) || 90}°`;
            toolOutput = { success: true, fileId: saved.id, filename: saved.filename, pageCount: rotated.pageCount };
          } else {
            throw new PdfEngineError(
              'unsupported_operation',
              `Unsupported organize operation "${args.operation}". Use merge, extract, split, or rotate.`,
            );
          }
        } else {
          throw new Error(`Unsupported tool "${toolName}".`);
        }

        step.status = 'finished';
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Tool error';
        step.status = 'error';
        step.summary = msg;
        toolOutput = toolErrorOutput(err);
      }

      params.onEvent({ type: 'tool_update', payload: { ...step } });

      functionResponseParts.push({
        functionResponse: {
          id: call.id,
          name: toolName,
          response: toolOutput,
        },
      });
    }

    contents.push({
      role: 'user',
      parts: functionResponseParts,
    });
  }

  if (!finalAssistantText) {
    finalAssistantText =
      producedAttachments.length > 0
        ? `Ready: **${producedAttachments.map((f) => f.filename).join(', ')}**.`
        : 'Completed.';
  }

  return {
    assistantText: finalAssistantText,
    thoughtText: accumulatedThoughts.trim(),
    toolSteps,
    attachments: producedAttachments,
  };
}
