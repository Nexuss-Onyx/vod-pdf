import {
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  GoogleGenAI,
  type Part,
  ThinkingLevel,
  Type,
} from '@google/genai';
import type { AgentToolStep, DocxAttachment } from '../src/types/vod.ts';
import {
  acceptAllDocxChangesBuffer,
  addCommentToDocxBuffer,
  createDocxFromSpec,
  type DocxBlockInput,
  editDocxBuffer,
  inspectDocxBuffer,
  searchDocxBuffer,
} from './docxEngine.ts';
import { formatBytes } from './docxUtils.ts';
import { workspaceStore } from './store.ts';
import { buildVodWordSystemPrompt } from './systemPrompt.ts';

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

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'list_files',
    description:
      'List available .docx files in the current session or across the workspace with file IDs, word counts, and summaries.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        includeAllSessions: {
          type: Type.BOOLEAN,
          description: 'If true, lists all files ever created or attached.',
        },
      },
    },
  },
  {
    name: 'inspect_docx',
    description:
      'Inspect a .docx file: extracts full text, outline headings, word/table counts, comments, tracked redlines, and OOXML validation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING, description: 'The ID of the .docx file to inspect.' },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'search_docx',
    description:
      'Search inside a large .docx file for matching paragraphs by keyword or phrase.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING, description: 'The ID of the .docx file to search.' },
        query: { type: Type.STRING, description: 'Search phrase or keyword.' },
      },
      required: ['fileId', 'query'],
    },
  },
  {
    name: 'create_docx',
    description:
      'Create a polished Microsoft Word (.docx) document using the under-the-hood DOCX engine.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filename: { type: Type.STRING, description: 'Filename ending in .docx.' },
        title: { type: Type.STRING, description: 'Document title.' },
        subtitle: { type: Type.STRING, description: 'Optional subtitle line.' },
        pageSize: { type: Type.STRING, description: '"letter" (default) or "a4".' },
        orientation: { type: Type.STRING, description: '"portrait" (default) or "landscape".' },
        headerText: { type: Type.STRING, description: 'Optional running header text.' },
        summary: { type: Type.STRING, description: 'Short 1-sentence summary of the document.' },
        blocks: {
          type: Type.ARRAY,
          description: 'Ordered document content blocks.',
          items: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
                description:
                  'One of: cover_page, heading1, heading2, heading3, paragraph, bullet_list, numbered_list, table, key_values, callout, quote, divider, page_break, toc.',
              },
              text: { type: Type.STRING, description: 'Text for heading, paragraph, quote, callout, or cover_page.' },
              subtitle: { type: Type.STRING, description: 'Subtitle when type is cover_page.' },
              calloutTitle: { type: Type.STRING, description: 'Title when type is callout.' },
              items: { type: Type.ARRAY, items: { type: Type.STRING } },
              headers: { type: Type.ARRAY, items: { type: Type.STRING } },
              rows: {
                type: Type.ARRAY,
                items: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
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
          },
        },
      },
      required: ['filename', 'title', 'blocks'],
    },
  },
  {
    name: 'edit_docx',
    description:
      'Edit an existing .docx file: merges fragmented Word XML runs, performs text replacements (with optional tracked redline changes), or appends structured blocks.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING, description: 'Source .docx file ID.' },
        newFilename: { type: Type.STRING, description: 'Optional updated filename.' },
        trackedChange: { type: Type.BOOLEAN, description: 'If true, emits Word Tracked Changes (<w:ins>/<w:del>).' },
        replacements: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              find: { type: Type.STRING },
              replace: { type: Type.STRING },
            },
            required: ['find', 'replace'],
          },
        },
        appendBlocks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              text: { type: Type.STRING },
              items: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['type'],
          },
        },
        summary: { type: Type.STRING },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'add_docx_comment',
    description:
      'Attach an anchored Microsoft Word review comment inside word/comments.xml.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING },
        commentText: { type: Type.STRING },
        anchorText: { type: Type.STRING, description: 'Exact phrase to anchor the comment to.' },
      },
      required: ['fileId', 'commentText'],
    },
  },
  {
    name: 'accept_docx_changes',
    description:
      'Accept all tracked insertions and deletions in a redlined .docx into a clean final copy.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING },
        newFilename: { type: Type.STRING },
      },
      required: ['fileId'],
    },
  },
];

export interface AgentStreamEvent {
  type: 'thought_delta' | 'text_delta' | 'tool_update' | 'done' | 'error';
  payload: unknown;
}

export async function runAutonomousWordAgent(params: {
  sessionId: string;
  userPrompt: string;
  attachedFileId?: string;
  onEvent: (ev: AgentStreamEvent) => void;
}): Promise<{
  assistantText: string;
  thoughtText: string;
  toolSteps: AgentToolStep[];
  attachments: DocxAttachment[];
}> {
  const ai = getGeminiClient();
  const systemInstruction = buildVodWordSystemPrompt();

  const historyMessages = workspaceStore.getSessionMessages(params.sessionId);
  const contents: Content[] = [];

  for (const msg of historyMessages.slice(-14)) {
    let text = msg.content;
    if (msg.attachments && msg.attachments.length > 0) {
      const fileList = msg.attachments
        .map((a) => `[DOCX: "${a.filename}", fileId="${a.id}", ${a.wordCount} words]`)
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
      promptWithContext = `${params.userPrompt}\n\n[Attached DOCX file: filename="${fileMeta.filename}", fileId="${fileMeta.id}", size=${formatBytes(fileMeta.sizeBytes)}. Inspect it with inspect_docx before answering or editing.]`;
    }
  }

  const lastMsg = historyMessages[historyMessages.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== params.userPrompt) {
    contents.push({ role: 'user', parts: [{ text: promptWithContext }] });
  } else if (params.attachedFileId) {
    contents[contents.length - 1] = { role: 'user', parts: [{ text: promptWithContext }] };
  }

  const toolSteps: AgentToolStep[] = [];
  const producedAttachments: DocxAttachment[] = [];
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
        list_files: 'Listing files',
        inspect_docx: 'Inspecting DOCX',
        search_docx: `Searching "${String(args.query || '')}"`,
        create_docx: `Creating ${String(args.filename || 'document.docx')}`,
        edit_docx: 'Editing DOCX',
        add_docx_comment: 'Adding comment',
        accept_docx_changes: 'Accepting changes',
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
              wordCount: f.wordCount,
              version: f.version,
              summary: f.summary,
            })),
          };
          step.summary = `${files.length} file(s)`;
        } else if (toolName === 'inspect_docx') {
          const fileId = String(args.fileId || '');
          const meta = workspaceStore.getFileMeta(fileId);
          if (!meta) throw new Error(`File "${fileId}" not found.`);
          const buffer = workspaceStore.getFileBuffer(fileId);
          const inspection = await inspectDocxBuffer(buffer, meta);
          toolOutput = {
            fileId: meta.id,
            filename: meta.filename,
            wordCount: inspection.wordCount,
            paragraphCount: inspection.paragraphCount,
            tableCount: inspection.tableCount,
            outline: inspection.outline,
            comments: inspection.comments,
            trackedChanges: inspection.trackedChanges,
            validation: inspection.validation,
            textPreview: inspection.markdownPreview.slice(0, 14000),
          };
          step.summary = `${inspection.wordCount} words`;
        } else if (toolName === 'search_docx') {
          const fileId = String(args.fileId || '');
          const meta = workspaceStore.getFileMeta(fileId);
          if (!meta) throw new Error(`File "${fileId}" not found.`);
          const buffer = workspaceStore.getFileBuffer(fileId);
          const found = await searchDocxBuffer(buffer, String(args.query || ''));
          toolOutput = found;
          step.summary = `${found.matches.length} match(es)`;
        } else if (toolName === 'create_docx') {
          const blocks = Array.isArray(args.blocks) ? (args.blocks as DocxBlockInput[]) : [];
          const created = await createDocxFromSpec({
            filename: String(args.filename || 'Document.docx'),
            title: String(args.title || 'Document'),
            subtitle: args.subtitle ? String(args.subtitle) : undefined,
            pageSize: args.pageSize === 'a4' ? 'a4' : 'letter',
            orientation: args.orientation === 'landscape' ? 'landscape' : 'portrait',
            headerText: args.headerText ? String(args.headerText) : undefined,
            includePageNumbers: true,
            blocks,
          });

          const saved = workspaceStore.saveDocxFile({
            sessionId: params.sessionId,
            filename: created.filename,
            title: String(args.title || created.filename),
            buffer: created.buffer,
            summary: String(args.summary || `Generated ${created.filename}`),
            wordCount: created.wordCount,
            pageCountEstimate: created.pageCountEstimate,
            source: 'generated',
          });
          producedAttachments.push(saved);
          step.summary = `${created.wordCount} words · ${formatBytes(saved.sizeBytes)}`;
          toolOutput = {
            success: true,
            fileId: saved.id,
            filename: saved.filename,
            size: formatBytes(saved.sizeBytes),
            wordCount: created.wordCount,
            pageCountEstimate: created.pageCountEstimate,
          };
        } else if (toolName === 'edit_docx') {
          const fileId = String(args.fileId || '');
          const meta = workspaceStore.getFileMeta(fileId);
          if (!meta) throw new Error(`File "${fileId}" not found.`);
          const srcBuffer = workspaceStore.getFileBuffer(fileId);
          const edited = await editDocxBuffer(srcBuffer, {
            replacements: Array.isArray(args.replacements)
              ? (args.replacements as Array<{ find: string; replace: string }>)
              : [],
            trackedChange: Boolean(args.trackedChange),
            author: 'Vod Word',
            appendBlocks: Array.isArray(args.appendBlocks)
              ? (args.appendBlocks as DocxBlockInput[])
              : [],
          });

          const nextFilename = args.newFilename
            ? String(args.newFilename)
            : args.trackedChange && !meta.filename.includes('Redlined')
              ? meta.filename.replace(/\.docx$/i, '_Redlined.docx')
              : meta.filename;

          const saved = workspaceStore.saveDocxFile({
            sessionId: params.sessionId,
            filename: nextFilename,
            title: meta.title,
            buffer: edited.buffer,
            summary: String(
              args.summary ||
                `Applied ${edited.totalReplacements} edit(s) and ${edited.appendedBlocks} appended block(s).`,
            ),
            wordCount: edited.wordCount,
            pageCountEstimate: edited.pageCountEstimate,
            source: 'edited',
          });
          producedAttachments.push(saved);
          step.summary = `${edited.totalReplacements} edit(s)`;
          toolOutput = {
            success: true,
            fileId: saved.id,
            filename: saved.filename,
            totalReplacements: edited.totalReplacements,
            appendedBlocks: edited.appendedBlocks,
            wordCount: edited.wordCount,
          };
        } else if (toolName === 'add_docx_comment') {
          const fileId = String(args.fileId || '');
          const meta = workspaceStore.getFileMeta(fileId);
          if (!meta) throw new Error(`File "${fileId}" not found.`);
          const srcBuffer = workspaceStore.getFileBuffer(fileId);
          const commented = await addCommentToDocxBuffer(
            srcBuffer,
            String(args.commentText || ''),
            'Vod Word',
            args.anchorText ? String(args.anchorText) : undefined,
          );
          const saved = workspaceStore.saveDocxFile({
            sessionId: params.sessionId,
            filename: meta.filename.includes('Commented')
              ? meta.filename
              : meta.filename.replace(/\.docx$/i, '_Commented.docx'),
            title: meta.title,
            buffer: commented.buffer,
            summary: `Added comment #${commented.commentId}`,
            wordCount: meta.wordCount,
            pageCountEstimate: meta.pageCountEstimate,
            source: 'edited',
          });
          producedAttachments.push(saved);
          step.summary = `Comment #${commented.commentId}`;
          toolOutput = {
            success: true,
            fileId: saved.id,
            filename: saved.filename,
            commentId: commented.commentId,
            anchored: commented.anchored,
          };
        } else if (toolName === 'accept_docx_changes') {
          const fileId = String(args.fileId || '');
          const meta = workspaceStore.getFileMeta(fileId);
          if (!meta) throw new Error(`File "${fileId}" not found.`);
          const srcBuffer = workspaceStore.getFileBuffer(fileId);
          const accepted = await acceptAllDocxChangesBuffer(srcBuffer);
          const cleanName = args.newFilename
            ? String(args.newFilename)
            : meta.filename.replace(/_Redlined/i, '').replace(/\.docx$/i, '_Final.docx');
          const saved = workspaceStore.saveDocxFile({
            sessionId: params.sessionId,
            filename: cleanName,
            title: meta.title,
            buffer: accepted.buffer,
            summary: `Accepted ${accepted.acceptedInsertions} insertion(s), ${accepted.acceptedDeletions} deletion(s).`,
            wordCount: meta.wordCount,
            pageCountEstimate: meta.pageCountEstimate,
            source: 'edited',
          });
          producedAttachments.push(saved);
          step.summary = `Clean copy ready`;
          toolOutput = {
            success: true,
            fileId: saved.id,
            filename: saved.filename,
            acceptedInsertions: accepted.acceptedInsertions,
            acceptedDeletions: accepted.acceptedDeletions,
          };
        } else {
          throw new Error(`Unsupported tool "${toolName}".`);
        }

        step.status = 'finished';
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Tool error';
        step.status = 'error';
        step.summary = msg;
        toolOutput = { error: msg };
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
