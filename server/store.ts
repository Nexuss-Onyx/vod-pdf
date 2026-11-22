import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Response } from 'express';
import type {
  ChatMessage,
  ChatSession,
  DocxAttachment,
  WorkspaceSnapshot,
} from '../src/types/vod.ts';
import { createDocxFromSpec } from './docxEngine.ts';
import { isValidEntityId, sanitizeDocxFilename } from './docxUtils.ts';

export function resolveWritableDataDir(preferredOverride?: string): string {
  const candidates = [
    preferredOverride,
    process.env.VOD_DATA_DIR,
    path.resolve(process.cwd(), 'data'),
    path.resolve(os.tmpdir(), 'vod-word-data'),
  ].filter((v): v is string => Boolean(v && v.trim()));

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {
      // Try next writable location
    }
  }
  return path.resolve(os.tmpdir(), 'vod-word-data');
}

interface PersistedIndex {
  version: 2;
  sessions: ChatSession[];
  files: DocxAttachment[];
}

interface LegacyWorkspace {
  sessions?: ChatSession[];
  messages?: ChatMessage[];
  files?: DocxAttachment[];
}

async function atomicWriteText(targetPath: string, content: string): Promise<void> {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmpPath, content, 'utf8');
  await fs.promises.rename(tmpPath, targetPath);
}

export class WorkspaceStore {
  private readonly dataDir: string;
  private readonly filesDir: string;
  private readonly sessionsDir: string;
  private readonly indexPath: string;
  private readonly legacyStatePath: string;

  private sessions: ChatSession[] = [];
  private files: DocxAttachment[] = [];
  private messagesBySession = new Map<string, ChatMessage[]>();

  private sseClients = new Set<Response>();
  private initialized = false;

  // Lightweight background disk write scheduling (coalesces bursts, never blocks HTTP)
  private indexDirty = false;
  private dirtySessions = new Set<string>();
  private deletedSessionIds = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private activeFlushPromise: Promise<void> | null = null;

  constructor(customDataDir?: string) {
    this.dataDir = resolveWritableDataDir(customDataDir);
    this.filesDir = path.resolve(this.dataDir, 'files');
    this.sessionsDir = path.resolve(this.dataDir, 'sessions');
    this.indexPath = path.resolve(this.dataDir, 'index.json');
    this.legacyStatePath = path.resolve(this.dataDir, 'workspace.json');
  }

  getDataDir(): string {
    return this.dataDir;
  }

  private ensureStorageDirs(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.filesDir, { recursive: true });
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  private resolveSafeFilePath(fileId: string): string {
    if (!isValidEntityId(fileId)) {
      throw new Error('Invalid file identifier.');
    }
    const resolved = path.resolve(this.filesDir, `${fileId}.docx`);
    if (!resolved.startsWith(this.filesDir + path.sep)) {
      throw new Error('Path traversal rejected.');
    }
    return resolved;
  }

  private resolveSafeSessionPath(sessionId: string): string {
    if (!isValidEntityId(sessionId)) {
      throw new Error('Invalid session identifier.');
    }
    const resolved = path.resolve(this.sessionsDir, `${sessionId}.json`);
    if (!resolved.startsWith(this.sessionsDir + path.sep)) {
      throw new Error('Path traversal rejected.');
    }
    return resolved;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.ensureStorageDirs();

    if (fs.existsSync(this.indexPath)) {
      try {
        const raw = await fs.promises.readFile(this.indexPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<PersistedIndex>;
        this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
        this.files = Array.isArray(parsed.files) ? parsed.files : [];
      } catch {
        this.sessions = [];
        this.files = [];
      }
    } else if (fs.existsSync(this.legacyStatePath)) {
      // Seamless migration from monolithic workspace.json -> partitioned index.json + sessions/<id>.json
      try {
        const raw = await fs.promises.readFile(this.legacyStatePath, 'utf8');
        const legacy = JSON.parse(raw) as LegacyWorkspace;
        this.sessions = Array.isArray(legacy.sessions) ? legacy.sessions : [];
        this.files = Array.isArray(legacy.files) ? legacy.files : [];
        const legacyMsgs = Array.isArray(legacy.messages) ? legacy.messages : [];
        for (const msg of legacyMsgs) {
          const list = this.messagesBySession.get(msg.sessionId) ?? [];
          list.push(msg);
          this.messagesBySession.set(msg.sessionId, list);
        }
        this.indexDirty = true;
        for (const s of this.sessions) {
          this.dirtySessions.add(s.id);
        }
        await this.flush();
      } catch {
        this.sessions = [];
        this.files = [];
      }
    }

    if (this.sessions.length === 0) {
      await this.seedInitialWorkspace();
    }
    this.initialized = true;
  }

  private schedulePersist(options: { index?: boolean; sessionId?: string; deleteSessionId?: string }): void {
    if (options.index) this.indexDirty = true;
    if (options.sessionId) {
      this.deletedSessionIds.delete(options.sessionId);
      this.dirtySessions.add(options.sessionId);
    }
    if (options.deleteSessionId) {
      this.dirtySessions.delete(options.deleteSessionId);
      this.deletedSessionIds.add(options.deleteSessionId);
    }

    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 30);
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.activeFlushPromise) {
      await this.activeFlushPromise;
    }

    const doFlush = async () => {
      this.ensureStorageDirs();
      const tasks: Promise<void>[] = [];

      if (this.indexDirty) {
        this.indexDirty = false;
        const payload: PersistedIndex = {
          version: 2,
          sessions: this.sessions,
          files: this.files,
        };
        tasks.push(atomicWriteText(this.indexPath, JSON.stringify(payload)));
      }

      const sessionIds = Array.from(this.dirtySessions);
      this.dirtySessions.clear();
      for (const sid of sessionIds) {
        const msgs = this.messagesBySession.get(sid) ?? [];
        try {
          const target = this.resolveSafeSessionPath(sid);
          tasks.push(atomicWriteText(target, JSON.stringify({ sessionId: sid, messages: msgs })));
        } catch {
          // Ignore invalid IDs
        }
      }

      const toDelete = Array.from(this.deletedSessionIds);
      this.deletedSessionIds.clear();
      for (const sid of toDelete) {
        try {
          const target = this.resolveSafeSessionPath(sid);
          tasks.push(
            fs.promises.unlink(target).catch(() => {
              // File may not exist on disk yet
            }),
          );
        } catch {
          // Ignore invalid IDs
        }
      }

      if (tasks.length > 0) {
        await Promise.all(tasks);
      }
    };

    this.activeFlushPromise = doFlush().finally(() => {
      this.activeFlushPromise = null;
    });
    await this.activeFlushPromise;
  }

  private ensureSessionMessagesLoaded(sessionId: string): ChatMessage[] {
    const cached = this.messagesBySession.get(sessionId);
    if (cached) return cached;

    try {
      const target = this.resolveSafeSessionPath(sessionId);
      if (fs.existsSync(target)) {
        const raw = fs.readFileSync(target, 'utf8');
        const parsed = JSON.parse(raw) as { messages?: ChatMessage[] };
        const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
        this.messagesBySession.set(sessionId, msgs);
        return msgs;
      }
    } catch {
      // Fallback to empty message list
    }
    const empty: ChatMessage[] = [];
    this.messagesBySession.set(sessionId, empty);
    return empty;
  }

  private async seedInitialWorkspace(): Promise<void> {
    const todayIso = new Date(Date.now() - 1000 * 60 * 35).toISOString();
    const yesterdayIso = new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString();
    const earlierIso = new Date(Date.now() - 1000 * 60 * 60 * 96).toISOString();

    const sessionId = 'session_q4_ops';
    const fileId1 = 'file_q4_ops_brief';
    const fileId2 = 'file_vendor_msa';
    const fileId3 = 'file_onboarding_sop';

    const doc1 = await createDocxFromSpec({
      filename: 'Q4_Operations_Review.docx',
      title: 'Q4 Operations & Budget Review',
      subtitle: 'Executive Briefing · Operations Leadership',
      headerText: 'Confidential Internal Brief',
      includePageNumbers: true,
      blocks: [
        {
          type: 'callout',
          calloutTitle: 'Executive Summary',
          text: 'Q4 regional fulfillment velocity improved by 14.2% while unit handling cost declined by $1.85 per order. Two vendor SLA renewals require legal redline sign-off before November 30.',
        },
        { type: 'heading1', text: '1. Operational Performance Overview' },
        {
          type: 'paragraph',
          text: 'Across the third and fourth quarter transition, weekly reporting from three regional hubs was consolidated into a single standardized executive brief. On-time dispatch averaged 97.8%, exceeding our quarterly target of 96.0%.',
        },
        {
          type: 'table',
          headers: ['Department', 'Q3 Baseline', 'Q4 Target', 'Q4 Actual', 'Variance'],
          rows: [
            ['Fulfillment Ops', '95.4%', '96.0%', '97.8%', '+1.8%'],
            ['Procurement', '$412,000', '$395,000', '$384,500', '-$10,500'],
            ['Enterprise Support', '4.2 hrs', '3.5 hrs', '3.1 hrs', '-0.4 hrs'],
            ['Contract Turnaround', '6.0 days', '4.0 days', '3.4 days', '-0.6 days'],
          ],
        },
        { type: 'heading1', text: '2. Priority Action Items' },
        {
          type: 'bullet_list',
          items: [
            '**Vendor MSA Redline**: Finalize Section 8 indemnity cap before November 28.',
            '**Regional Staffing Plan**: Circulate updated shift roster for peak December volume.',
            '**Board Packet Assembly**: Consolidate appendix metrics into the final distribution.',
          ],
        },
      ],
    });
    fs.writeFileSync(this.resolveSafeFilePath(fileId1), doc1.buffer);

    const doc2 = await createDocxFromSpec({
      filename: 'Vendor_MSA_Draft.docx',
      title: 'Master Services Agreement',
      subtitle: 'Standard Commercial Terms · Legal Review Copy',
      includePageNumbers: true,
      blocks: [
        { type: 'heading1', text: '1. Scope & Service Levels' },
        {
          type: 'paragraph',
          text: 'Provider guarantees 99.9% monthly platform uptime and Net 30 invoice settlement terms.',
        },
        { type: 'heading1', text: '2. Limitation of Liability' },
        {
          type: 'paragraph',
          text: 'Aggregate liability under this Agreement shall not exceed twelve (12) months of fees paid prior to the claim.',
        },
      ],
    });
    fs.writeFileSync(this.resolveSafeFilePath(fileId2), doc2.buffer);

    const doc3 = await createDocxFromSpec({
      filename: 'Incident_Response_SOP.docx',
      title: 'Incident Escalation SOP',
      subtitle: 'Standard Operating Procedure · v2.1',
      includePageNumbers: true,
      blocks: [
        { type: 'heading1', text: '1. Severity Classification' },
        {
          type: 'table',
          headers: ['Severity', 'Response SLA', 'Escalation Owner'],
          rows: [
            ['SEV-1 Critical', '15 minutes', 'On-Call Engineering Lead'],
            ['SEV-2 Major', '60 minutes', 'Service Desk Manager'],
          ],
        },
      ],
    });
    fs.writeFileSync(this.resolveSafeFilePath(fileId3), doc3.buffer);

    const att1: DocxAttachment = {
      id: fileId1,
      sessionId,
      filename: doc1.filename,
      title: 'Q4 Operations & Budget Review',
      sizeBytes: doc1.buffer.length,
      createdAt: todayIso,
      updatedAt: todayIso,
      version: 1,
      summary: 'Executive operational briefing with KPI comparison table and action checklist.',
      pageCountEstimate: doc1.pageCountEstimate,
      wordCount: doc1.wordCount,
      source: 'generated',
    };

    const att2: DocxAttachment = {
      id: fileId2,
      sessionId,
      filename: doc2.filename,
      title: 'Master Services Agreement',
      sizeBytes: doc2.buffer.length,
      createdAt: yesterdayIso,
      updatedAt: yesterdayIso,
      version: 1,
      summary: 'Commercial MSA template ready for redline review.',
      pageCountEstimate: doc2.pageCountEstimate,
      wordCount: doc2.wordCount,
      source: 'uploaded',
    };

    const att3: DocxAttachment = {
      id: fileId3,
      sessionId,
      filename: doc3.filename,
      title: 'Incident Escalation SOP',
      sizeBytes: doc3.buffer.length,
      createdAt: earlierIso,
      updatedAt: earlierIso,
      version: 1,
      summary: 'Severity SLA response matrix and escalation guidelines.',
      pageCountEstimate: doc3.pageCountEstimate,
      wordCount: doc3.wordCount,
      source: 'generated',
    };

    const userMsg: ChatMessage = {
      id: 'msg_seed_1',
      sessionId,
      role: 'user',
      content:
        'Prepare a clean Q4 Operations & Budget Review Word document with an executive callout, KPI comparison table, and priority action items.',
      createdAt: todayIso,
    };

    const assistantMsg: ChatMessage = {
      id: 'msg_seed_2',
      sessionId,
      role: 'assistant',
      content: `I have prepared **Q4_Operations_Review.docx** with an executive summary callout, a 5-column KPI comparison table, and prioritized next steps.\n\nClick the file card below to open it in the DOCX viewer, inspect the OOXML structure, or download the document.`,
      createdAt: todayIso,
      thoughtText:
        'Structuring Q4 Operations & Budget Review as US Letter portrait with 1-inch margins.\n1. Opening Executive Summary callout box with clear accent rule.\n2. Section 1 narrative + 5-column Department KPI table using explicit DXA column widths (total 9360 DXA).\n3. Section 2 priority bullet list with bold lead-ins and OOXML numbering.',
      toolSteps: [
        {
          id: 'step_seed_1',
          toolName: 'create_docx',
          label: 'Created Q4_Operations_Review.docx',
          status: 'finished',
          summary: `${doc1.wordCount} words · ${doc1.pageCountEstimate} page(s)`,
          timestamp: todayIso,
        },
      ],
      attachments: [att1],
    };

    const session: ChatSession = {
      id: sessionId,
      title: 'Q4 Operations & Budget Review',
      createdAt: todayIso,
      updatedAt: todayIso,
      messageCount: 2,
      fileCount: 1,
    };

    this.sessions = [session];
    this.files = [att1, att2, att3];
    this.messagesBySession.set(sessionId, [userMsg, assistantMsg]);
    this.indexDirty = true;
    this.dirtySessions.add(sessionId);
    await this.flush();
  }

  subscribeSse(res: Response): void {
    this.sseClients.add(res);
  }

  unsubscribeSse(res: Response): void {
    this.sseClients.delete(res);
  }

  broadcast(eventType: string, payload: unknown): void {
    const data = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(data);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  getWorkspaceSnapshot(): WorkspaceSnapshot {
    return {
      sessions: [...this.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      files: [...this.files].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.find((s) => s.id === sessionId);
  }

  getSessionMessages(sessionId: string): ChatMessage[] {
    const msgs = this.ensureSessionMessagesLoaded(sessionId);
    return [...msgs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getSessionFiles(sessionId: string): DocxAttachment[] {
    return this.files
      .filter((f) => f.sessionId === sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getAllFiles(): DocxAttachment[] {
    return [...this.files].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getFileMeta(fileId: string): DocxAttachment | undefined {
    return this.files.find((f) => f.id === fileId);
  }

  getFileBuffer(fileId: string): Buffer {
    const targetPath = this.resolveSafeFilePath(fileId);
    if (!fs.existsSync(targetPath)) {
      throw new Error('DOCX file binary not found on disk.');
    }
    return fs.readFileSync(targetPath);
  }

  async getFileBufferAsync(fileId: string): Promise<Buffer> {
    const targetPath = this.resolveSafeFilePath(fileId);
    try {
      return await fs.promises.readFile(targetPath);
    } catch {
      throw new Error('DOCX file binary not found on disk.');
    }
  }

  createSession(title: string, requestedId?: string): ChatSession {
    const cleanId = requestedId && isValidEntityId(requestedId) ? requestedId : undefined;
    if (cleanId) {
      const existing = this.sessions.find((s) => s.id === cleanId);
      if (existing) {
        return existing;
      }
    }

    const now = new Date().toISOString();
    const session: ChatSession = {
      id: cleanId || `session_${crypto.randomBytes(6).toString('hex')}`,
      title: (title || 'New Chat').trim().slice(0, 120),
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      fileCount: 0,
    };
    this.sessions.unshift(session);
    this.messagesBySession.set(session.id, []);
    this.schedulePersist({ index: true, sessionId: session.id });
    this.broadcast('workspace_updated', { kind: 'session_created', session });
    return session;
  }

  renameSessionIfDefault(sessionId: string, firstPrompt: string): void {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    if (session.title === 'New Chat' || session.title === 'Untitled Word Session') {
      const cleaned = firstPrompt.replace(/\s+/g, ' ').trim();
      session.title = cleaned.length > 52 ? `${cleaned.slice(0, 49)}...` : cleaned || 'Word Document';
      this.schedulePersist({ index: true });
      this.broadcast('workspace_updated', { kind: 'session_updated', session });
    }
  }

  deleteSession(sessionId: string): boolean {
    const idx = this.sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) return false;
    this.sessions.splice(idx, 1);
    this.messagesBySession.delete(sessionId);

    const removedFiles = this.files.filter((f) => f.sessionId === sessionId);
    this.files = this.files.filter((f) => f.sessionId !== sessionId);
    for (const f of removedFiles) {
      try {
        const p = this.resolveSafeFilePath(f.id);
        void fs.promises.unlink(p).catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
    }

    this.schedulePersist({ index: true, deleteSessionId: sessionId });
    this.broadcast('workspace_updated', { kind: 'session_deleted', sessionId });
    return true;
  }

  appendMessage(
    message: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  ): ChatMessage {
    const now = message.createdAt || new Date().toISOString();
    const fullMessage: ChatMessage = {
      ...message,
      id: message.id || `msg_${crypto.randomBytes(6).toString('hex')}`,
      createdAt: now,
    };

    const msgs = this.ensureSessionMessagesLoaded(message.sessionId);
    if (!msgs.some((m) => m.id === fullMessage.id)) {
      msgs.push(fullMessage);
    }

    const session = this.sessions.find((s) => s.id === message.sessionId);
    if (session) {
      session.updatedAt = now;
      session.messageCount = msgs.length;
    }

    this.schedulePersist({ index: true, sessionId: message.sessionId });
    this.broadcast('workspace_updated', { kind: 'message_added', sessionId: message.sessionId });
    return fullMessage;
  }

  deleteMessage(sessionId: string, messageId: string): void {
    const msgs = this.ensureSessionMessagesLoaded(sessionId);
    const filtered = msgs.filter((m) => m.id !== messageId);
    this.messagesBySession.set(sessionId, filtered);

    const session = this.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.messageCount = filtered.length;
    }
    this.schedulePersist({ index: true, sessionId });
  }

  saveDocxFile(params: {
    sessionId: string;
    filename: string;
    title: string;
    buffer: Buffer;
    summary: string;
    wordCount: number;
    pageCountEstimate: number;
    source: 'generated' | 'uploaded' | 'edited';
    requestedId?: string;
  }): DocxAttachment {
    const cleanId =
      params.requestedId && isValidEntityId(params.requestedId) ? params.requestedId : undefined;
    if (cleanId) {
      const existing = this.files.find((f) => f.id === cleanId);
      if (existing) {
        return existing;
      }
    }

    const now = new Date().toISOString();
    const safeName = sanitizeDocxFilename(params.filename);
    const fileId = cleanId || `file_${crypto.randomBytes(6).toString('hex')}`;
    this.ensureStorageDirs();
    fs.writeFileSync(this.resolveSafeFilePath(fileId), params.buffer);

    const existingSameName = this.files.filter(
      (f) => f.sessionId === params.sessionId && f.filename.toLowerCase() === safeName.toLowerCase(),
    );

    const attachment: DocxAttachment = {
      id: fileId,
      sessionId: params.sessionId,
      filename: safeName,
      title: params.title || safeName.replace(/\.docx$/i, ''),
      sizeBytes: params.buffer.length,
      createdAt: now,
      updatedAt: now,
      version: existingSameName.length + 1,
      summary: params.summary,
      pageCountEstimate: params.pageCountEstimate,
      wordCount: params.wordCount,
      source: params.source,
    };

    this.files.unshift(attachment);
    const session = this.sessions.find((s) => s.id === params.sessionId);
    if (session) {
      session.updatedAt = now;
      session.fileCount = this.files.filter((f) => f.sessionId === session.id).length;
    }

    this.schedulePersist({ index: true });
    this.broadcast('workspace_updated', { kind: 'file_created', file: attachment });
    return attachment;
  }
}

export const workspaceStore = new WorkspaceStore();
