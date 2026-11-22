import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Response } from 'express';
import type {
  ChatMessage,
  ChatSession,
  PdfAttachment,
  PdfMetadataFlags,
  WorkspaceSnapshot,
} from '../src/types/vod.ts';
import { createPdfFromSpec } from './pdfEngine.ts';
import { isValidEntityId, sanitizePdfFilename } from './pdfUtils.ts';

export function resolveWritableDataDir(preferredOverride?: string): string {
  const candidates = [
    preferredOverride,
    process.env.VOD_DATA_DIR,
    path.resolve(process.cwd(), 'data'),
    path.resolve(os.tmpdir(), 'vod-pdf-data'),
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
  return path.resolve(os.tmpdir(), 'vod-pdf-data');
}

interface PersistedIndex {
  version: 3;
  sessions: ChatSession[];
  files: PdfAttachment[];
}

interface LegacyWorkspace {
  sessions?: ChatSession[];
  messages?: ChatMessage[];
  files?: Array<Record<string, unknown>>;
}

/** Files with DOCX-era metadata or non-PDF names are excluded from a PDF workspace. */
function normalizePersistedFile(raw: unknown): PdfAttachment | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  const filename = typeof record.filename === 'string' ? record.filename : '';
  if (!isValidEntityId(id) || !/\.pdf$/i.test(filename)) return null;
  return {
    id,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : '',
    filename,
    title: typeof record.title === 'string' ? record.title : filename.replace(/\.pdf$/i, ''),
    mimeType: 'application/pdf',
    sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : 0,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
    version: typeof record.version === 'number' ? record.version : 1,
    summary: typeof record.summary === 'string' ? record.summary : '',
    pageCount: typeof record.pageCount === 'number' ? record.pageCount : 1,
    textWordCount: typeof record.textWordCount === 'number' ? record.textWordCount : 0,
    source:
      record.source === 'generated' || record.source === 'uploaded' || record.source === 'edited'
        ? record.source
        : 'generated',
    ...(record.metadataFlags && typeof record.metadataFlags === 'object'
      ? { metadataFlags: record.metadataFlags as PdfMetadataFlags }
      : {}),
  };
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
  private files: PdfAttachment[] = [];
  private messagesBySession = new Map<string, ChatMessage[]>();

  private sseClients = new Set<Response>();
  private initialized = false;
  private skippedLegacyFiles = 0;

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

  /** Enforces `<filesDir>/<id>.pdf` — the only writable document layout for Vod PDF. */
  private resolveSafeFilePath(fileId: string): string {
    if (!isValidEntityId(fileId)) {
      throw new Error('Invalid file identifier.');
    }
    const resolved = path.resolve(this.filesDir, `${fileId}.pdf`);
    if (!resolved.startsWith(this.filesDir + path.sep) || !resolved.endsWith('.pdf')) {
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
        const parsed = JSON.parse(raw) as Partial<PersistedIndex> & {
          files?: Array<Record<string, unknown>>;
        };
        this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
        const rawFiles = Array.isArray(parsed.files) ? parsed.files : [];
        this.files = rawFiles
          .map((file) => normalizePersistedFile(file))
          .filter((file): file is PdfAttachment => Boolean(file));
        this.skippedLegacyFiles += rawFiles.length - this.files.length;
        // Drop records whose PDF binary is missing (e.g. a DOCX-era volume).
        this.files = this.files.filter((file) => {
          try {
            return fs.existsSync(this.resolveSafeFilePath(file.id));
          } catch {
            return false;
          }
        });
      } catch {
        this.sessions = [];
        this.files = [];
      }
    } else if (fs.existsSync(this.legacyStatePath)) {
      // Seamless session/message migration from monolithic workspace.json.
      try {
        const raw = await fs.promises.readFile(this.legacyStatePath, 'utf8');
        const legacy = JSON.parse(raw) as LegacyWorkspace;
        this.sessions = Array.isArray(legacy.sessions) ? legacy.sessions : [];
        const legacyMsgs = Array.isArray(legacy.messages) ? legacy.messages : [];
        for (const msg of legacyMsgs) {
          const list = this.messagesBySession.get(msg.sessionId) ?? [];
          list.push(msg);
          this.messagesBySession.set(msg.sessionId, list);
        }
        // Legacy file records can only survive if they are genuine PDFs on disk.
        this.files = (Array.isArray(legacy.files) ? legacy.files : [])
          .map((file) => normalizePersistedFile(file))
          .filter((file): file is PdfAttachment => Boolean(file))
          .filter((file) => {
            try {
              return fs.existsSync(this.resolveSafeFilePath(file.id));
            } catch {
              return false;
            }
          });
        this.skippedLegacyFiles +=
          (Array.isArray(legacy.files) ? legacy.files.length : 0) - this.files.length;
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

    if (this.skippedLegacyFiles > 0) {
      console.warn(
        `[vod-pdf] Ignored ${this.skippedLegacyFiles} non-PDF file record(s) from a previous data directory. ` +
          'Vod PDF only serves .pdf artifacts; no automatic conversion is performed.',
      );
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
          version: 3,
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

    const doc1 = await createPdfFromSpec({
      filename: 'Q4_Operations_Review.pdf',
      title: 'Q4 Operations & Budget Review',
      subtitle: 'Executive Briefing · Operations Leadership',
      headerText: 'Confidential Internal Brief',
      includePageNumbers: true,
      blocks: [
        {
          type: 'cover_page',
          text: 'Q4 Operations & Budget Review',
          subtitle: 'Executive Briefing · Operations Leadership',
        },
        {
          type: 'callout',
          calloutTitle: 'Executive Summary',
          text: 'Q4 regional fulfillment velocity improved by 14.2% while unit handling cost declined by $1.85 per order. Two vendor SLA renewals require legal sign-off before November 30.',
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
          type: 'numbered_list',
          items: [
            'Vendor MSA review: finalize Section 8 liability cap before November 28.',
            'Regional staffing plan: circulate updated shift roster for peak December volume.',
            'Board packet assembly: consolidate appendix metrics into the final distribution.',
          ],
        },
      ],
    });
    fs.writeFileSync(this.resolveSafeFilePath(fileId1), doc1.buffer);

    const doc2 = await createPdfFromSpec({
      filename: 'Vendor_MSA_Draft.pdf',
      title: 'Master Services Agreement',
      subtitle: 'Standard Commercial Terms · Legal Review Copy',
      includePageNumbers: true,
      blocks: [
        { type: 'cover_page', text: 'Master Services Agreement', subtitle: 'Legal Review Copy' },
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

    const doc3 = await createPdfFromSpec({
      filename: 'Incident_Response_SOP.pdf',
      title: 'Incident Escalation SOP',
      subtitle: 'Standard Operating Procedure · v2.1',
      includePageNumbers: true,
      blocks: [
        { type: 'cover_page', text: 'Incident Escalation SOP', subtitle: 'Standard Operating Procedure · v2.1' },
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

    const att1: PdfAttachment = {
      id: fileId1,
      sessionId,
      filename: doc1.filename,
      title: 'Q4 Operations & Budget Review',
      mimeType: 'application/pdf',
      sizeBytes: doc1.buffer.length,
      createdAt: todayIso,
      updatedAt: todayIso,
      version: 1,
      summary: 'Executive operational briefing with KPI comparison table and action checklist.',
      pageCount: doc1.pageCount,
      textWordCount: doc1.textWordCount,
      source: 'generated',
      metadataFlags: { encrypted: false, scannedLikely: false, hasForms: false, hasAnnotations: false },
    };

    const att2: PdfAttachment = {
      id: fileId2,
      sessionId,
      filename: doc2.filename,
      title: 'Master Services Agreement',
      mimeType: 'application/pdf',
      sizeBytes: doc2.buffer.length,
      createdAt: yesterdayIso,
      updatedAt: yesterdayIso,
      version: 1,
      summary: 'Commercial MSA template ready for legal review.',
      pageCount: doc2.pageCount,
      textWordCount: doc2.textWordCount,
      source: 'uploaded',
      metadataFlags: { encrypted: false, scannedLikely: false, hasForms: false, hasAnnotations: false },
    };

    const att3: PdfAttachment = {
      id: fileId3,
      sessionId,
      filename: doc3.filename,
      title: 'Incident Escalation SOP',
      mimeType: 'application/pdf',
      sizeBytes: doc3.buffer.length,
      createdAt: earlierIso,
      updatedAt: earlierIso,
      version: 1,
      summary: 'Severity SLA response matrix and escalation guidelines.',
      pageCount: doc3.pageCount,
      textWordCount: doc3.textWordCount,
      source: 'generated',
      metadataFlags: { encrypted: false, scannedLikely: false, hasForms: false, hasAnnotations: false },
    };

    const userMsg: ChatMessage = {
      id: 'msg_seed_1',
      sessionId,
      role: 'user',
      content:
        'Prepare a clean Q4 Operations & Budget Review PDF with an executive callout, KPI comparison table, and priority action items.',
      createdAt: todayIso,
    };

    const assistantMsg: ChatMessage = {
      id: 'msg_seed_2',
      sessionId,
      role: 'assistant',
      content: `I have prepared **Q4_Operations_Review.pdf** with an executive summary callout, a 5-column KPI comparison table, and prioritized next steps.\n\nClick the file card below to open it in the PDF viewer, inspect the outline and metadata, or download the document.`,
      createdAt: todayIso,
      thoughtText:
        'Planning the Q4 Operations & Budget Review as US Letter portrait with 56pt margins.\n1. Cover page with plum title band and document metadata.\n2. Executive Summary callout with accent rule.\n3. Section 1 narrative + 5-column KPI table.\n4. Section 2 numbered priority actions.\nThen re-inspecting the generated bytes to confirm page count and extracted text.',
      toolSteps: [
        {
          id: 'step_seed_1',
          toolName: 'create_pdf',
          label: 'Created Q4_Operations_Review.pdf',
          status: 'finished',
          summary: `${doc1.pageCount} page(s) · ${doc1.textWordCount} words`,
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

  getSessionFiles(sessionId: string): PdfAttachment[] {
    return this.files
      .filter((f) => f.sessionId === sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getAllFiles(): PdfAttachment[] {
    return [...this.files].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getFileMeta(fileId: string): PdfAttachment | undefined {
    return this.files.find((f) => f.id === fileId);
  }

  getFileBuffer(fileId: string): Buffer {
    const targetPath = this.resolveSafeFilePath(fileId);
    if (!fs.existsSync(targetPath)) {
      throw new Error('PDF binary not found in the workspace store.');
    }
    return fs.readFileSync(targetPath);
  }

  async getFileBufferAsync(fileId: string): Promise<Buffer> {
    const targetPath = this.resolveSafeFilePath(fileId);
    try {
      return await fs.promises.readFile(targetPath);
    } catch {
      throw new Error('PDF binary not found in the workspace store.');
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
    if (session.title === 'New Chat' || session.title === 'Untitled PDF Session') {
      const cleaned = firstPrompt.replace(/\s+/g, ' ').trim();
      session.title = cleaned.length > 52 ? `${cleaned.slice(0, 49)}...` : cleaned || 'PDF Document';
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

  savePdfFile(params: {
    sessionId: string;
    filename: string;
    title: string;
    buffer: Buffer;
    summary: string;
    pageCount: number;
    textWordCount: number;
    source: 'generated' | 'uploaded' | 'edited';
    metadataFlags?: PdfMetadataFlags;
    requestedId?: string;
  }): PdfAttachment {
    const cleanId =
      params.requestedId && isValidEntityId(params.requestedId) ? params.requestedId : undefined;
    if (cleanId) {
      const existing = this.files.find((f) => f.id === cleanId);
      if (existing) {
        return existing;
      }
    }

    const now = new Date().toISOString();
    const safeName = sanitizePdfFilename(params.filename);
    const fileId = cleanId || `file_${crypto.randomBytes(6).toString('hex')}`;
    this.ensureStorageDirs();
    fs.writeFileSync(this.resolveSafeFilePath(fileId), params.buffer);

    const existingSameName = this.files.filter(
      (f) => f.sessionId === params.sessionId && f.filename.toLowerCase() === safeName.toLowerCase(),
    );

    const attachment: PdfAttachment = {
      id: fileId,
      sessionId: params.sessionId,
      filename: safeName,
      title: params.title || safeName.replace(/\.pdf$/i, ''),
      mimeType: 'application/pdf',
      sizeBytes: params.buffer.length,
      createdAt: now,
      updatedAt: now,
      version: existingSameName.length + 1,
      summary: params.summary,
      pageCount: Math.max(1, Math.round(params.pageCount)),
      textWordCount: Math.max(0, Math.round(params.textWordCount)),
      source: params.source,
      metadataFlags: {
        encrypted: false,
        ...params.metadataFlags,
      },
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
