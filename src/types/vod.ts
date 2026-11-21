export type DocxViewerMode = 'document' | 'structure' | 'xml';

export interface DocxAttachment {
  id: string;
  sessionId: string;
  filename: string;
  title: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  summary: string;
  pageCountEstimate: number;
  wordCount: number;
  source: 'generated' | 'uploaded' | 'edited';
}

export interface AgentToolStep {
  id: string;
  toolName: string;
  label: string;
  status: 'started' | 'processing' | 'finished' | 'error';
  summary?: string;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  thoughtText?: string;
  toolSteps?: AgentToolStep[];
  attachments?: DocxAttachment[];
  error?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  fileCount: number;
}

export interface DocxComment {
  id: string;
  author: string;
  date: string;
  text: string;
}

export interface DocxTrackedChange {
  id: string;
  type: 'insertion' | 'deletion';
  author: string;
  date: string;
  text: string;
}

export interface DocxOutlineItem {
  level: number;
  text: string;
}

export interface DocxInspection {
  file: DocxAttachment;
  wordCount: number;
  paragraphCount: number;
  tableCount: number;
  outline: DocxOutlineItem[];
  plainText: string;
  markdownPreview: string;
  comments: DocxComment[];
  trackedChanges: DocxTrackedChange[];
  documentXml: string;
  validation: {
    valid: boolean;
    errors: string[];
  };
}

export interface WorkspaceSnapshot {
  sessions: ChatSession[];
  files: DocxAttachment[];
}
