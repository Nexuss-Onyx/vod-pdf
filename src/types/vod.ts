/**
 * Vod PDF shared data model.
 *
 * Everything the workspace stores, serves, inspects, and renders is a PDF.
 * There is no DOCX/OOXML shape in this model by design: files are `.pdf`
 * binaries plus a structured `PdfInspection` produced by the server PDF engine.
 */

export type PdfViewerMode = 'document' | 'outline' | 'text';

export interface PdfMetadataFlags {
  encrypted?: boolean;
  scannedLikely?: boolean;
  hasForms?: boolean;
  hasAnnotations?: boolean;
}

export interface PdfAttachment {
  id: string;
  sessionId: string;
  /** Always ends in `.pdf`. */
  filename: string;
  title: string;
  mimeType: 'application/pdf';
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  summary: string;
  /** Actual page count parsed from the PDF (never an estimate). */
  pageCount: number;
  /** Words recovered from the PDF text layer; 0 for image-only/scanned files. */
  textWordCount: number;
  source: 'generated' | 'uploaded' | 'edited';
  metadataFlags?: PdfMetadataFlags;
}

export interface PdfPageInfo {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  textWordCount: number;
}

export interface PdfOutlineItem {
  title: string;
  pageNumber?: number;
  level: number;
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
}

export interface PdfFormField {
  name: string;
  type: string;
  value?: string;
  readOnly?: boolean;
  required?: boolean;
  options?: string[];
}

export interface PdfFormsSummary {
  hasAcroForm: boolean;
  fieldCount: number;
  fields: PdfFormField[];
}

export type PdfAnnotationType =
  | 'text'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'freeText'
  | 'link'
  | 'widget'
  | 'stamp'
  | 'other';

export interface PdfAnnotation {
  id: string;
  pageNumber: number;
  type: PdfAnnotationType;
  author?: string;
  date?: string;
  content?: string;
  rect?: [number, number, number, number];
}

export interface PdfCapabilities {
  canCreate: boolean;
  canExtractText: boolean;
  canSearch: boolean;
  canRenderPages: boolean;
  canFillForms: boolean;
  canAddAnnotations: boolean;
  canEditExistingText: boolean;
  canMerge: boolean;
  canSplit: boolean;
  canRotate: boolean;
  canWatermark: boolean;
  canCrop: boolean;
  canEncrypt: boolean;
  canRedact: boolean;
}

export interface PdfValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PdfTextPage {
  pageNumber: number;
  text: string;
}

export interface PdfInspection {
  file: PdfAttachment;
  pageCount: number;
  pages: PdfPageInfo[];
  outline: PdfOutlineItem[];
  metadata: PdfMetadata;
  forms: PdfFormsSummary;
  annotations: PdfAnnotation[];
  /** Bounded plain-text preview for UI/agent grounding. */
  textPreview: string;
  /** Full extracted text per page. Omitted from client payloads when large. */
  plainTextByPage?: PdfTextPage[];
  extractionWarnings: string[];
  validation: PdfValidation;
  capabilities: PdfCapabilities;
}

export interface PdfSearchMatch {
  pageNumber: number;
  snippet: string;
  matchIndex: number;
}

export interface PdfSearchResult {
  query: string;
  matches: PdfSearchMatch[];
  totalMatches: number;
  pagesSearched: number;
  warnings: string[];
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
  attachments?: PdfAttachment[];
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

export interface WorkspaceSnapshot {
  sessions: ChatSession[];
  files: PdfAttachment[];
}

/** Structured engine error codes surfaced through the API and agent tools. */
export type PdfErrorCode =
  | 'invalid_pdf'
  | 'encrypted_pdf'
  | 'corrupt_pdf'
  | 'unsupported_operation'
  | 'page_out_of_range'
  | 'no_text_layer'
  | 'form_not_found'
  | 'engine_error';
