import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { inspectDocxBuffer } from './server/docxEngine.ts';
import { isValidEntityId, sanitizeDocxFilename } from './server/docxUtils.ts';
import { runAutonomousWordAgent } from './server/geminiAgent.ts';
import { workspaceStore } from './server/store.ts';

const PORT = Number(process.env.PORT) || 3000;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

async function startServer() {
  await workspaceStore.init();

  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'vod-word' });
  });

  app.get('/api/workspace', (_req, res) => {
    res.json(workspaceStore.getWorkspaceSnapshot());
  });

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    workspaceStore.subscribeSse(res);
    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      workspaceStore.unsubscribeSse(res);
    });
  });

  app.post('/api/sessions', (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title : 'New Chat';
    const requestedId =
      typeof req.body?.id === 'string' && isValidEntityId(req.body.id) ? req.body.id : undefined;
    const session = workspaceStore.createSession(title, requestedId);
    res.status(201).json({ session });
  });

  app.get('/api/sessions/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (!isValidEntityId(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID.' });
      return;
    }
    const session = workspaceStore.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    res.json({
      session,
      messages: workspaceStore.getSessionMessages(sessionId),
      files: workspaceStore.getSessionFiles(sessionId),
    });
  });

  app.delete('/api/sessions/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (!isValidEntityId(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID.' });
      return;
    }
    const deleted = workspaceStore.deleteSession(sessionId);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found.' });
      return;
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
      const rawFilename = typeof req.body?.filename === 'string' ? req.body.filename : 'Uploaded.docx';
      const base64Data = typeof req.body?.base64Data === 'string' ? req.body.base64Data : '';

      if (!isValidEntityId(sessionId)) {
        res.status(400).json({ error: 'Invalid target session ID.' });
        return;
      }
      if (!workspaceStore.getSession(sessionId)) {
        workspaceStore.createSession('New Chat', sessionId);
      }

      const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
        res.status(400).json({ error: 'Uploaded file must be between 1 byte and 12 MB.' });
        return;
      }
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        res.status(400).json({ error: 'File is not a valid .docx ZIP archive.' });
        return;
      }

      const safeFilename = sanitizeDocxFilename(rawFilename);
      const tempMeta = {
        id: 'temp_inspect',
        sessionId,
        filename: safeFilename,
        title: safeFilename.replace(/\.docx$/i, '').replace(/_/g, ' '),
        sizeBytes: buffer.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        summary: 'Uploaded Word document',
        pageCountEstimate: 1,
        wordCount: 0,
        source: 'uploaded' as const,
      };

      const inspection = await inspectDocxBuffer(buffer, tempMeta);
      const saved = workspaceStore.saveDocxFile({
        sessionId,
        filename: safeFilename,
        title: tempMeta.title,
        buffer,
        summary: `${inspection.wordCount} words · ${inspection.outline.length} section(s)`,
        wordCount: inspection.wordCount,
        pageCountEstimate: Math.max(1, Math.ceil(inspection.wordCount / 380)),
        source: 'uploaded',
        requestedId: requestedFileId,
      });

      res.status(201).json({ file: saved, inspection: { ...inspection, file: saved } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to process uploaded .docx file.';
      res.status(400).json({ error: msg });
    }
  });

  app.get('/api/files/:fileId/download', async (req, res) => {
    try {
      const { fileId } = req.params;
      if (!isValidEntityId(fileId)) {
        res.status(400).json({ error: 'Invalid file ID.' });
        return;
      }
      const meta = workspaceStore.getFileMeta(fileId);
      if (!meta) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }
      const buffer = await workspaceStore.getFileBufferAsync(fileId);
      const inline = req.query.inline === '1';
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${meta.filename}"`,
      );
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('ETag', `"${fileId}"`);
      res.send(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'File read error.';
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/files/:fileId/inspect', async (req, res) => {
    try {
      const { fileId } = req.params;
      if (!isValidEntityId(fileId)) {
        res.status(400).json({ error: 'Invalid file ID.' });
        return;
      }
      const meta = workspaceStore.getFileMeta(fileId);
      if (!meta) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }
      const buffer = await workspaceStore.getFileBufferAsync(fileId);
      const inspection = await inspectDocxBuffer(buffer, meta);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.json(inspection);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to inspect .docx file.';
      res.status(500).json({ error: msg });
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
      res.status(400).json({ error: 'Invalid session ID.' });
      return;
    }
    if (!workspaceStore.getSession(sessionId)) {
      workspaceStore.createSession('New Chat', sessionId);
    }

    let prompt = promptInput;
    let effectiveAttachedFileId = attachedFileId;

    if (regenerateAssistantId) {
      const msgs = workspaceStore.getSessionMessages(sessionId);
      const targetIdx = msgs.findIndex((m) => m.id === regenerateAssistantId);
      if (targetIdx > 0 && msgs[targetIdx - 1].role === 'user') {
        const prevUser = msgs[targetIdx - 1];
        prompt = prevUser.content;
        effectiveAttachedFileId = prevUser.attachments?.[0]?.id;
        workspaceStore.deleteMessage(sessionId, regenerateAssistantId);
      }
    }

    if (!prompt) {
      res.status(400).json({ error: 'Message prompt is required.' });
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
        ? workspaceStore.getFileMeta(effectiveAttachedFileId)
        : undefined;
      const userMessage = workspaceStore.appendMessage({
        sessionId,
        role: 'user',
        content: prompt,
        attachments: attachedMeta ? [attachedMeta] : undefined,
      });
      workspaceStore.renameSessionIfDefault(sessionId, prompt);
      sendSse('user_message', userMessage);
    }

    try {
      const result = await runAutonomousWordAgent({
        sessionId,
        userPrompt: prompt,
        attachedFileId: effectiveAttachedFileId,
        onEvent: (ev) => {
          sendSse(ev.type, ev.payload);
        },
      });

      const assistantMessage = workspaceStore.appendMessage({
        sessionId,
        role: 'assistant',
        content: result.assistantText,
        thoughtText: result.thoughtText || undefined,
        toolSteps: result.toolSteps.length > 0 ? result.toolSteps : undefined,
        attachments: result.attachments.length > 0 ? result.attachments : undefined,
      });

      sendSse('done', { message: assistantMessage });
      res.end();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unexpected agent error.';
      const errorMessage = workspaceStore.appendMessage({
        sessionId,
        role: 'assistant',
        content: `Error: ${errorMsg}`,
        error: errorMsg,
      });
      sendSse('error', { error: errorMsg, message: errorMessage });
      res.end();
    }
  });

  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event === 'start';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vod Word server running on http://0.0.0.0:${PORT}`);
  });

  const handleShutdown = async () => {
    await workspaceStore.flush();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => void handleShutdown());
  process.on('SIGINT', () => void handleShutdown());
}

startServer().catch((err) => {
  console.error('Failed to start Vod Word server:', err);
  process.exit(1);
});
