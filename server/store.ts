import crypto from 'node:crypto';
import fs from 'node:fs';
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

const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILES_DIR = path.resolve(DATA_DIR, 'files');
const STATE_PATH = path.resolve(DATA_DIR, 'workspace.json');

interface PersistedWorkspace {
  sessions: ChatSession[];
  messages: ChatMessage[];
  files: DocxAttachment[];
}

function ensureStorageDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

function resolveSafeFilePath(fileId: string): string {
  if (!isValidEntityId(fileId)) {
    throw new Error('Invalid file identifier.');
  }
  const resolved = path.resolve(FILES_DIR, `${fileId}.docx`);
  if (!resolved.startsWith(FILES_DIR + path.sep)) {
    throw new Error('Path traversal rejected.');
  }
  return resolved;
}

class WorkspaceStore {
  private state: PersistedWorkspace = {
    sessions: [],
    messages: [],
    files: [],
  };
  private sseClients = new Set<Response>();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    ensureStorageDirs();

    if (fs.existsSync(STATE_PATH)) {
      try {
        const raw = fs.readFileSync(STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw) as Partial<PersistedWorkspace>;
        this.state = {
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
          messages: Array.isArray(parsed.messages) ? parsed.messages : [],
          files: Array.isArray(parsed.files) ? parsed.files : [],
        };
      } catch {
        this.state = { sessions: [], messages: [], files: [] };
      }
    }

    if (this.state.sessions.length === 0) {
      await this.seedInitialWorkspace();
    }
    this.initialized = true;
  }

  private persist(): void {
    ensureStorageDirs();
    const tmpPath = `${STATE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmpPath, STATE_PATH);
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
    fs.writeFileSync(resolveSafeFilePath(fileId1), doc1.buffer);

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
    fs.writeFileSync(resolveSafeFilePath(fileId2), doc2.buffer);

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
    fs.writeFileSync(resolveSafeFilePath(fileId3), doc3.buffer);

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
      content: 'Prepare a clean Q4 Operations & Budget Review Word document with an executive callout, KPI comparison table, and priority action items.',
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

    this.state = {
      sessions: [session],
      messages: [userMsg, assistantMsg],
      files: [att1, att2, att3],
    };
    this.persist();
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
      sessions: [...this.state.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      files: [...this.state.files].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  getSession(sessionId: string): ChatSession | undefined {
    return this.state.sessions.find((s) => s.id === sessionId);
  }

  getSessionMessages(sessionId: string): ChatMessage[] {
    return this.state.messages
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getSessionFiles(sessionId: string): DocxAttachment[] {
    return this.state.files
      .filter((f) => f.sessionId === sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getAllFiles(): DocxAttachment[] {
    return [...this.state.files].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getFileMeta(fileId: string): DocxAttachment | undefined {
    return this.state.files.find((f) => f.id === fileId);
  }

  getFileBuffer(fileId: string): Buffer {
    const targetPath = resolveSafeFilePath(fileId);
    if (!fs.existsSync(targetPath)) {
      throw new Error('DOCX file binary not found on disk.');
    }
    return fs.readFileSync(targetPath);
  }

  createSession(title: string): ChatSession {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: `session_${crypto.randomBytes(6).toString('hex')}`,
      title: (title || 'New Chat').trim().slice(0, 120),
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      fileCount: 0,
    };
    this.state.sessions.unshift(session);
    this.persist();
    this.broadcast('workspace_updated', { kind: 'session_created', session });
    return session;
  }

  renameSessionIfDefault(sessionId: string, firstPrompt: string): void {
    const session = this.state.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    if (session.title === 'New Chat' || session.title === 'Untitled Word Session') {
      const cleaned = firstPrompt.replace(/\s+/g, ' ').trim();
      session.title = cleaned.length > 52 ? `${cleaned.slice(0, 49)}...` : cleaned || 'Word Document';
      this.persist();
      this.broadcast('workspace_updated', { kind: 'session_updated', session });
    }
  }

  deleteSession(sessionId: string): boolean {
    const idx = this.state.sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) return false;
    this.state.sessions.splice(idx, 1);
    this.state.messages = this.state.messages.filter((m) => m.sessionId !== sessionId);
    const removedFiles = this.state.files.filter((f) => f.sessionId === sessionId);
    this.state.files = this.state.files.filter((f) => f.sessionId !== sessionId);
    for (const f of removedFiles) {
      try {
        const p = resolveSafeFilePath(f.id);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // Ignore cleanup errors
      }
    }
    this.persist();
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
    this.state.messages.push(fullMessage);

    const session = this.state.sessions.find((s) => s.id === message.sessionId);
    if (session) {
      session.updatedAt = now;
      session.messageCount = this.state.messages.filter((m) => m.sessionId === session.id).length;
    }

    this.persist();
    this.broadcast('workspace_updated', { kind: 'message_added', sessionId: message.sessionId });
    return fullMessage;
  }

  deleteMessage(sessionId: string, messageId: string): void {
    this.state.messages = this.state.messages.filter(
      (m) => !(m.sessionId === sessionId && m.id === messageId),
    );
    const session = this.state.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.messageCount = this.state.messages.filter((m) => m.sessionId === session.id).length;
    }
    this.persist();
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
  }): DocxAttachment {
    const now = new Date().toISOString();
    const safeName = sanitizeDocxFilename(params.filename);
    const fileId = `file_${crypto.randomBytes(6).toString('hex')}`;
    fs.writeFileSync(resolveSafeFilePath(fileId), params.buffer);

    const existingSameName = this.state.files.filter(
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

    this.state.files.unshift(attachment);
    const session = this.state.sessions.find((s) => s.id === params.sessionId);
    if (session) {
      session.updatedAt = now;
      session.fileCount = this.state.files.filter((f) => f.sessionId === session.id).length;
    }

    this.persist();
    this.broadcast('workspace_updated', { kind: 'file_created', file: attachment });
    return attachment;
  }
}

export const workspaceStore = new WorkspaceStore();
