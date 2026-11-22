/**
 * Minimal ambient types for the pdf.js *legacy* (Node-compatible) build.
 * The package ships types only for its root browser entry, so the server
 * engine declares the narrow surface it actually uses here.
 */
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export interface PdfJsTextItem {
    str: string;
    hasEOL?: boolean;
    width?: number;
    height?: number;
    transform?: number[];
    fontName?: string;
  }

  export interface PdfJsTextContent {
    items: Array<PdfJsTextItem | { type: string }>;
    styles?: Record<string, unknown>;
  }

  export interface PdfJsViewport {
    width: number;
    height: number;
    rotation: number;
    scale: number;
    convertToPdfPoint(x: number, y: number): number[];
  }

  export interface PdfJsAnnotation {
    id?: string;
    subtype?: string;
    contentsObj?: { str?: string };
    titleObj?: { str?: string };
    modificationDate?: string;
    rect?: number[];
  }

  export interface PdfJsPage {
    pageNumber: number;
    rotate: number;
    getViewport(params: { scale: number; rotation?: number }): PdfJsViewport;
    getTextContent(): Promise<PdfJsTextContent>;
    getAnnotations(params?: { intent?: string }): Promise<PdfJsAnnotation[]>;
  }

  export interface PdfJsOutlineNode {
    title: string;
    dest?: unknown;
    items?: PdfJsOutlineNode[];
  }

  export interface PdfJsDocument {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfJsPage>;
    getMetadata(): Promise<{ info?: Record<string, unknown>; metadata?: unknown }>;
    getOutline(): Promise<PdfJsOutlineNode[] | null>;
    getFieldObjects(): Promise<Record<string, Array<Record<string, unknown>>> | null>;
    getPageIndex(ref: unknown): Promise<number>;
    destroy(): Promise<void>;
  }

  export interface PdfJsLoadingTask {
    promise: Promise<PdfJsDocument>;
    destroy(): void;
  }

  export function getDocument(params: Record<string, unknown>): PdfJsLoadingTask;
  export const GlobalWorkerOptions: { workerSrc: string };
  export const PasswordException: new (...args: unknown[]) => Error;
  export const InvalidPDFException: new (...args: unknown[]) => Error;
  export const VerbosityLevel: { ERRORS: number; WARNINGS: number; INFOS: number };
}
