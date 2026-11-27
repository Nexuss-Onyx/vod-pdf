import express, { type Express } from 'express';
import { runAutonomousPdfAgent } from './geminiAgent.ts';
import { assertPdfBuffer, inspectPdfBuffer, PdfEngineError, searchPdfBuffer } from './pdfEngine.ts';
import { isValidEntityId, sanitizePdfFilename } from './pdfUtils.ts';
import { workspaceStore, type WorkspaceStore } from './store.ts';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function errorPayload(err: unknown, fallback: string): { error: string; code: string } {
  if (err instanceof PdfEngineError) {
    return { error: err.message, code: err.code };
  }
  return { error: err instanceof Error ? err.message : fallback, code: 'engine_error' };
}

/**
 * All Vod PDF API routes. The store is injectable so tests can run against a
 * disposable data directory without touching the process-wide workspace.
 */
export function createVodPdfApp(store: WorkspaceStore = workspaceStore): Express {
  const app = express();
  app.use(express.json({ limit: '40mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'vod-pdf' });
  });

  app.get('/api/workspace', (_req, res) => {
    res.json(store.getWorkspaceSnapshot());
  });

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    if (isServerlessRuntime()) {
      res.write(
        `event: connected\ndata: ${JSON.stringify({ ok: true, mode: 'serverless' })}\n\n`,
      );
      res.end();
      return;
    }
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    store.subscribeSse(res);
    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      store.unsubscribeSse(res);
    });
  });

  app.post('/api/sessions', async (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title : 'New Chat';
    const requestedId =
      typeof req.body?.id === 'string' && isValidEntityId(req.body.id) ? req.body.id : undefined;
    const session = store.createSession(title, requestedId);
    if (isServerlessRuntime()) {
      await store.flush();
    }
    res.status(201).json({ session });
  });

  app.get('/api/sessions/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (!isValidEntityId(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID.', code: 'invalid_session_id' });
      return;
    }
    const session = store.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found.', code: 'session_not_found' });
      return;
    }
    res.json({
      session,
      messages: store.getSessionMessages(sessionId),
      files: store.getSessionFiles(sessionId),
    });
  });

  app.delete('/api/sessions/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    if (!isValidEntityId(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID.', code: 'invalid_session_id' });
      return;
    }
    const deleted = store.deleteSession(sessionId);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found.', code: 'session_not_found' });
      return;
    }
    if (isServerlessRuntime()) {
      await store.flush();
    }
    res.json({ ok: true });
  });

  app.post('/api/files/upload', async (req, res) => {
    try {
      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
      const requestedFileId =
        typeof req.body?.fileId === 'string' && isValidEntityId(req.body.fileId)
          ? req.body.fileId
          : undefined;
      const rawFilename = typeof req.body?.filename === 'string' ? req.body.filename : 'Uploaded.pdf';
      const base64Data = typeof req.body?.base64Data === 'string' ? req.body.base64Data : '';

      if (!isValidEntityId(sessionId)) {
        res.status(400).json({ error: 'Invalid target session ID.', code: 'invalid_session_id' });
        return;
      }
      if (!store.getSession(sessionId)) {
        store.createSession('New Chat', sessionId);
      }

      const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
        res.status(400).json({
          error: 'Uploaded PDF must be between 1 byte and 25 MB.',
          code: 'invalid_upload_size',
        });
        return;
      }

      if (/\.(docx?|docm|odt|rtf)$/i.test(rawFilename) || (buffer[0] === 0x50 && buffer[1] === 0x4b)) {
        res.status(400).json({
          error:
            'Vod PDF only accepts .pdf documents. Export non-PDF documents to .pdf first.',
          code: 'invalid_pdf',
        });
        return;
      }

      if (!/\.pdf$/i.test(rawFilename)) {
        res.status(400).json({ error: 'Vod PDF only accepts .pdf documents.', code: 'invalid_pdf' });
        return;
      }

      const pdfBuffer = assertPdfBuffer(buffer);
      const safeFilename = sanitizePdfFilename(rawFilename);
      const now = new Date().toISOString();
      const tempMeta = {
        id: 'temp_inspect',
        sessionId,
        filename: safeFilename,
        title: safeFilename.replace(/\.pdf$/i, '').replace(/_/g, ' '),
        sizeBytes: pdfBuffer.length,
        createdAt: now,
        updatedAt: now,
        version: 1,
        summary: 'Uploaded PDF document',
        source: 'uploaded' as const,
      };

      const inspection = await inspectPdfBuffer(pdfBuffer, tempMeta);
      const pageCount = inspection.pageCount;
      const textWordCount = inspection.file.textWordCount;

      const saved = store.savePdfFile({
        sessionId,
        filename: safeFilename,
        title: tempMeta.title,
        buffer: pdfBuffer,
        summary: `${pageCount} page(s) · ${textWordCount} words${
          inspection.file.metadataFlags?.scannedLikely ? ' · scanned (no text layer)' : ''
        }`,
        pageCount,
        textWordCount,
        source: 'uploaded',
        metadataFlags: inspection.file.metadataFlags,
        requestedId: requestedFileId,
      });

      if (isServerlessRuntime()) {
        await store.flush();
      }
      res.status(201).json({ file: saved, inspection: { ...inspection, file: saved } });
    } catch (err) {
      res.status(400).json(errorPayload(err, 'Failed to process the uploaded PDF.'));
    }
  });

  app.get('/api/files/:fileId/download', async (req, res) => {
    try {
      const { fileId } = req.params;
      if (!isValidEntityId(fileId)) {
        res.status(400).json({ error: 'Invalid file ID.', code: 'invalid_file_id' });
        return;
      }
      const meta = store.getFileMeta(fileId);
      if (!meta) {
        res.status(404).json({ error: 'File not found.', code: 'file_not_found' });
        return;
      }
      const buffer = await store.getFileBufferAsync(fileId);
      const inline = req.query.inline === '1';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${meta.filename}"`,
      );
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('ETag', `"${fileId}"`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json(errorPayload(err, 'File read error.'));
    }
  });

  app.get('/api/files/:fileId/inspect', async (req, res) => {
    try {
      const { fileId } = req.params;
      if (!isValidEntityId(fileId)) {
        res.status(400).json({ error: 'Invalid file ID.', code: 'invalid_file_id' });
        return;
      }
      const meta = store.getFileMeta(fileId);
      if (!meta) {
        res.status(404).json({ error: 'File not found.', code: 'file_not_found' });
        return;
      }
      const buffer = await store.getFileBufferAsync(fileId);
      const inspection = await inspectPdfBuffer(buffer, meta);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.json(inspection);
    } catch (err) {
      res.status(500).json(errorPayload(err, 'Failed to inspect the PDF.'));
    }
  });

  app.get('/api/files/:fileId/search', async (req, res) => {
    try {
      const { fileId } = req.params;
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!isValidEntityId(fileId)) {
        res.status(400).json({ error: 'Invalid file ID.', code: 'invalid_file_id' });
        return;
      }
      if (!query) {
        res.status(400).json({ error: 'Search query (q) is required.', code: 'unsupported_operation' });
        return;
      }
      const meta = store.getFileMeta(fileId);
      if (!meta) {
        res.status(404).json({ error: 'File not found.', code: 'file_not_found' });
        return;
      }
      const buffer = await store.getFileBufferAsync(fileId);
      const result = await searchPdfBuffer(buffer, query);
      res.json(result);
    } catch (err) {
      res.status(500).json(errorPayload(err, 'Failed to search the PDF.'));
    }
  });

  // Real-time SSE token + thought + tool streaming chat endpoint
  app.post('/api/chat/stream', async (req, res) => {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
    const promptInput = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const attachedFileId =
      typeof req.body?.attachedFileId === 'string' && isValidEntityId(req.body.attachedFileId)
        ? req.body.attachedFileId
        : undefined;
    const regenerateAssistantId =
      typeof req.body?.regenerateAssistantId === 'string' &&
      isValidEntityId(req.body.regenerateAssistantId)
        ? req.body.regenerateAssistantId
        : undefined;

    if (!isValidEntityId(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID.', code: 'invalid_session_id' });
      return;
    }
    if (!store.getSession(sessionId)) {
      store.createSession('New Chat', sessionId);
    }

    let prompt = promptInput;
    let effectiveAttachedFileId = attachedFileId;

    if (regenerateAssistantId) {
      const msgs = store.getSessionMessages(sessionId);
      const targetIdx = msgs.findIndex((m) => m.id === regenerateAssistantId);
      if (targetIdx > 0 && msgs[targetIdx - 1].role === 'user') {
        const prevUser = msgs[targetIdx - 1];
        prompt = prevUser.content;
        effectiveAttachedFileId = prevUser.attachments?.[0]?.id;
        store.deleteMessage(sessionId, regenerateAssistantId);
      }
    }

    if (!prompt) {
      res.status(400).json({ error: 'Message prompt is required.', code: 'empty_prompt' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendSse = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    if (!regenerateAssistantId) {
      const attachedMeta = effectiveAttachedFileId
        ? store.getFileMeta(effectiveAttachedFileId)
        : undefined;
      const userMessage = store.appendMessage({
        sessionId,
        role: 'user',
        content: prompt,
        attachments: attachedMeta ? [attachedMeta] : undefined,
      });
      store.renameSessionIfDefault(sessionId, prompt);
      sendSse('user_message', userMessage);
    }

    try {
      const result = await runAutonomousPdfAgent({
        sessionId,
        userPrompt: prompt,
        attachedFileId: effectiveAttachedFileId,
        onEvent: (ev) => {
          sendSse(ev.type, ev.payload);
        },
      });

      const assistantMessage = store.appendMessage({
        sessionId,
        role: 'assistant',
        content: result.assistantText,
        thoughtText: result.thoughtText || undefined,
        toolSteps: result.toolSteps.length > 0 ? result.toolSteps : undefined,
        attachments: result.attachments.length > 0 ? result.attachments : undefined,
      });

      if (isServerlessRuntime()) {
        await store.flush();
      }
      sendSse('done', { message: assistantMessage });
      res.end();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unexpected agent error.';
      const errorMessage = store.appendMessage({
        sessionId,
        role: 'assistant',
        content: `Error: ${errorMsg}`,
        error: errorMsg,
      });
      if (isServerlessRuntime()) {
        await store.flush();
      }
      sendSse('error', { error: errorMsg, message: errorMessage });
      res.end();
    }
  });

  return app;
}
