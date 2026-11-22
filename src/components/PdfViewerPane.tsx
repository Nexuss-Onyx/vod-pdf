import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Info,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  RotateCw,
  ScanLine,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PdfAttachment, PdfInspection, PdfViewerMode } from '../types/vod';
import { formatBytes, formatPageCount, formatWordCount } from '../utils/format';
import { loadLocalFileBlob, saveLocalFileBlob } from '../utils/localWorkspaceDb';
import { PdfDocIcon } from './VodBrandMarks';

// Explicitly bundled worker: the viewer never depends on a browser PDF plugin.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3;

interface PdfViewerPaneProps {
  file: PdfAttachment;
  onClose: () => void;
  onAskToEdit: (file: PdfAttachment) => void;
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(3))));
}

interface PdfPageViewProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  baseWidth: number;
  baseHeight: number;
  hasTextLayer: boolean;
  registerRef: (pageNumber: number, node: HTMLDivElement | null) => void;
}

function PdfPageView({
  pdf,
  pageNumber,
  scale,
  baseWidth,
  baseHeight,
  hasTextLayer,
  registerRef,
}: PdfPageViewProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(pageNumber <= 2);
  const [hasRendered, setHasRendered] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setIsVisible(true);
        }
      },
      { root: null, rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let textLayerTask: { cancel?: () => void } | null = null;

    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        void context;
        renderTask = page.render({
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        }) as unknown as { cancel: () => void; promise: Promise<unknown> };
        await renderTask.promise;
        if (cancelled) return;
        setHasRendered(true);

        const layer = textLayerRef.current;
        if (layer) {
          layer.innerHTML = '';
          layer.style.setProperty('--total-scale-factor', String(viewport.scale));
          if (hasTextLayer) {
            const textContent = await page.getTextContent();
            if (cancelled) return;
            const textLayer = new pdfjsLib.TextLayer({
              textContentSource: textContent,
              container: layer,
              viewport,
            });
            textLayerTask = textLayer;
            await textLayer.render();
          }
        }
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        if (name === 'RenderingCancelledException') return;
        setPageError(err instanceof Error ? err.message : 'Page render failed.');
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // Ignore cancel races
      }
      try {
        textLayerTask?.cancel?.();
      } catch {
        // Ignore cancel races
      }
    };
  }, [pdf, pageNumber, scale, isVisible, hasTextLayer]);

  const width = Math.round(baseWidth * scale);
  const height = Math.round(baseHeight * scale);

  return (
    <div
      ref={(node) => {
        wrapperRef.current = node;
        registerRef(pageNumber, node);
      }}
      data-pdf-page={pageNumber}
      className="pdf-page"
      style={{ width, height }}
    >
      <canvas ref={canvasRef} className="pdf-canvas" aria-hidden="true" />
      <div ref={textLayerRef} className="pdf-text-layer textLayer" />
      {!hasRendered && !pageError && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70">
          <span className="text-[11px] text-[#585470] font-mono-tabular">Page {pageNumber}</span>
        </div>
      )}
      {pageError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/90 px-4 text-center">
          <AlertTriangle className="w-4 h-4 text-[#D97706]" />
          <span className="text-[11px] text-[#585470]">Page {pageNumber} could not be rendered.</span>
        </div>
      )}
      <span className="pdf-page-number" aria-hidden="true">
        {pageNumber}
      </span>
    </div>
  );
}

export function PdfViewerPane({ file, onClose, onAskToEdit }: PdfViewerPaneProps) {
  const [mode, setMode] = useState<PdfViewerMode>('document');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [inspection, setInspection] = useState<PdfInspection | null>(null);
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');
  const [fitScale, setFitScale] = useState(1);
  const [pageCount, setPageCount] = useState(file.pageCount || 1);
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpValue, setJumpValue] = useState('1');
  const [reloadToken, setReloadToken] = useState(0);

  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const frameRef = useRef<number | null>(null);

  const pageOne = inspection?.pages?.[0];
  const baseWidth = pageOne ? pageOne.width : DEFAULT_PAGE_WIDTH;
  const baseHeight = pageOne ? pageOne.height : DEFAULT_PAGE_HEIGHT;
  const scale = zoomMode === 'fit' ? fitScale : zoomMode;

  const registerRef = useCallback((pageNumber: number, node: HTMLDivElement | null) => {
    if (node) pageRefs.current.set(pageNumber, node);
    else pageRefs.current.delete(pageNumber);
  }, []);

  // Load PDF bytes (local-first) + inspection, then hand the bytes to our renderer.
  useEffect(() => {
    let cancelled = false;
    let loadedDoc: PDFDocumentProxy | null = null;

    async function loadDocument() {
      setIsLoading(true);
      setLoadError(null);
      setPdf(null);
      try {
        const cached = await loadLocalFileBlob(file.id);
        let buffer = cached?.buffer;
        let resolvedInspection = cached?.inspection ?? null;

        if (!buffer || !resolvedInspection) {
          const [binRes, inspectRes] = await Promise.all([
            buffer
              ? Promise.resolve(null)
              : fetch(`/api/files/${encodeURIComponent(file.id)}/download?inline=1`),
            resolvedInspection
              ? Promise.resolve(null)
              : fetch(`/api/files/${encodeURIComponent(file.id)}/inspect`),
          ]);

          if (binRes) {
            if (!binRes.ok) {
              const payload = (await binRes.json().catch(() => null)) as { error?: string } | null;
              throw new Error(payload?.error || 'Could not load the PDF file.');
            }
            buffer = await binRes.arrayBuffer();
          }
          if (inspectRes && inspectRes.ok) {
            resolvedInspection = (await inspectRes.json()) as PdfInspection;
          }
          if (buffer) {
            void saveLocalFileBlob(file.id, buffer, resolvedInspection ?? undefined);
          }
        }

        if (cancelled || !buffer) return;
        if (resolvedInspection) {
          setInspection(resolvedInspection);
          if (resolvedInspection.pageCount > 0) setPageCount(resolvedInspection.pageCount);
        }

        // Copy the bytes: pdf.js takes ownership of the transferred buffer.
        const data = new Uint8Array(buffer.slice(0));
        loadedDoc = await pdfjsLib.getDocument({
          data,
          useSystemFonts: true,
        }).promise;
        if (cancelled) {
          void loadedDoc.destroy();
          return;
        }
        setPdf(loadedDoc);
        setPageCount(loadedDoc.numPages);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to render the PDF.';
        setLoadError(
          /password/i.test(message)
            ? 'This PDF is password-protected, so Vod PDF cannot render it. Remove the password and upload it again.'
            : message,
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadDocument();
    return () => {
      cancelled = true;
      if (loadedDoc) void loadedDoc.destroy();
    };
  }, [file.id, file.version, file.updatedAt, reloadToken]);

  // Fit-width calculation against the actual scroll viewport.
  useEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;

    const compute = () => {
      const available = Math.max(260, host.clientWidth - 56);
      setFitScale(clampScale(available / baseWidth));
    };
    compute();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(compute);
    observer.observe(host);
    return () => observer.disconnect();
  }, [baseWidth, isExpanded, mode]);

  // Track the page currently in view for the navigation indicator.
  const handleScroll = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const host = scrollHostRef.current;
      if (!host) return;
      const hostTop = host.getBoundingClientRect().top;
      let bestPage = currentPage;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const [pageNumber, node] of pageRefs.current.entries()) {
        const distance = Math.abs(node.getBoundingClientRect().top - hostTop - 12);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPage = pageNumber;
        }
      }
      setCurrentPage((previous) => {
        if (previous !== bestPage) setJumpValue(String(bestPage));
        return bestPage;
      });
    });
  };

  const goToPage = (pageNumber: number) => {
    const target = Math.min(pageCount, Math.max(1, Math.trunc(pageNumber) || 1));
    const node = pageRefs.current.get(target);
    const host = scrollHostRef.current;
    if (node && host) {
      const top =
        node.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 16;
      host.scrollTo({ top, behavior: 'smooth' });
    }
    setCurrentPage(target);
    setJumpValue(String(target));
  };

  const pageInfoMap = useMemo(() => {
    const map = new Map<number, PdfInspection['pages'][number]>();
    for (const page of inspection?.pages ?? []) map.set(page.pageNumber, page);
    return map;
  }, [inspection]);

  const pageTextMap = useMemo(() => {
    const map = new Map<number, string>();
    if (inspection?.plainTextByPage) {
      for (const page of inspection.plainTextByPage) map.set(page.pageNumber, page.text);
    }
    return map;
  }, [inspection]);

  const flattenedText = useMemo(() => {
    if (inspection?.plainTextByPage?.length) return null;
    return inspection?.textPreview ?? '';
  }, [inspection]);

  const capabilities = inspection?.capabilities;
  const warnings = inspection?.validation?.warnings ?? [];
  const extractionWarnings = inspection?.extractionWarnings ?? [];
  const allWarnings = Array.from(new Set([...warnings, ...extractionWarnings]));

  const tabClass = (active: boolean) =>
    `px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
      active ? 'bg-white text-[#2E2252] shadow-xs' : 'text-[#585470] hover:text-[#1E1935]'
    }`;

  return (
    <aside
      aria-label="PDF Reader and Viewer"
      className={
        isExpanded
          ? 'fixed inset-0 z-50 bg-[#ECEFF7] flex flex-col'
          : 'w-full lg:w-[540px] xl:w-[640px] border-l border-[#D9E1EF] bg-[#ECEFF7] flex flex-col shrink-0'
      }
    >
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-[#D9E1EF] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <PdfDocIcon className="w-8 h-8 shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold text-[#1E1935] truncate">
              {file.filename}
            </h2>
            <p className="text-[11px] text-[#585470] font-mono-tabular truncate">
              v{file.version} · {formatBytes(file.sizeBytes)} · {formatPageCount(pageCount)} ·{' '}
              {formatWordCount(file.textWordCount)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onAskToEdit(file)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#2E2252] bg-[#F4F6FB] hover:bg-[#F2EEF9] hover:text-[#2E2252] border border-[#D9E1EF] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#2E2252]"
          >
            <Pencil className="w-3.5 h-3.5 text-[#4A3680]" />
            <span>Edit in Chat</span>
          </button>

          <a
            href={`/api/files/${encodeURIComponent(file.id)}/download`}
            download={file.filename}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-white bg-[#2E2252] hover:bg-[#3E2E6E] inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </a>

          <button
            type="button"
            onClick={() => setIsExpanded((value) => !value)}
            aria-label={isExpanded ? 'Exit fullscreen PDF viewer' : 'Expand PDF viewer'}
            className="p-1.5 rounded-lg text-[#585470] hover:text-[#2E2252] hover:bg-[#ECEFF7] cursor-pointer"
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close PDF viewer"
            className="p-1.5 rounded-lg text-[#585470] hover:text-[#2E2252] hover:bg-[#ECEFF7] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode switcher */}
      <div className="px-4 py-2 bg-[#F4F6FB] border-b border-[#D9E1EF] flex items-center justify-between gap-2 shrink-0">
        <div
          role="tablist"
          aria-label="PDF view modes"
          className="inline-flex items-center gap-1 p-1 bg-[#E2E9F5] rounded-lg"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'document'}
            onClick={() => setMode('document')}
            className={tabClass(mode === 'document')}
          >
            <span className="inline-flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" /> Document
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'outline'}
            onClick={() => setMode('outline')}
            className={tabClass(mode === 'outline')}
          >
            <span className="inline-flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> Outline &amp; Details
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'text'}
            onClick={() => setMode('text')}
            className={tabClass(mode === 'text')}
          >
            <span className="inline-flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Text
            </span>
          </button>
        </div>

        {mode === 'document' && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-label="Zoom out PDF"
              disabled={scale <= MIN_SCALE}
              onClick={() => setZoomMode(clampScale(scale - 0.15))}
              className="p-1 rounded hover:bg-[#D9E1EF]/60 text-[#585470] hover:text-[#1E1935] cursor-pointer disabled:opacity-40"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomMode('fit')}
              title="Fit to width"
              aria-pressed={zoomMode === 'fit'}
              className={`px-1.5 py-0.5 rounded font-mono-tabular text-[11px] cursor-pointer ${
                zoomMode === 'fit'
                  ? 'bg-white text-[#2E2252] shadow-xs'
                  : 'hover:bg-[#D9E1EF]/60 text-[#585470]'
              }`}
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              aria-label="Zoom in PDF"
              disabled={scale >= MAX_SCALE}
              onClick={() => setZoomMode(clampScale(scale + 0.15))}
              className="p-1 rounded hover:bg-[#D9E1EF]/60 text-[#585470] hover:text-[#1E1935] cursor-pointer disabled:opacity-40"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col">
        {mode === 'document' && (
          <>
            <div
              ref={scrollHostRef}
              onScroll={handleScroll}
              className="pdf-viewer-host flex-1 overflow-auto px-4 py-5 flex flex-col items-center gap-4"
            >
              {isLoading && (
                <div className="w-full max-w-[560px] animate-pulse space-y-4" aria-live="polite">
                  <div className="h-[320px] rounded-md bg-white border border-[#D9E1EF]" />
                  <div className="flex items-center justify-center gap-2 text-xs text-[#585470]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Rendering PDF pages…</span>
                  </div>
                </div>
              )}

              {!isLoading && loadError && (
                <div className="w-full max-w-[560px] rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="w-4 h-4" />
                    <span>This PDF could not be rendered</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed">{loadError}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setReloadToken((value) => value + 1)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-red-300 text-xs font-medium text-red-700 hover:bg-red-100 cursor-pointer"
                    >
                      <RotateCw className="w-3.5 h-3.5" /> Retry
                    </button>
                    <a
                      href={`/api/files/${encodeURIComponent(file.id)}/download`}
                      download={file.filename}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2E2252] text-xs font-medium text-white hover:bg-[#3E2E6E]"
                    >
                      <Download className="w-3.5 h-3.5" /> Download instead
                    </a>
                  </div>
                </div>
              )}

              {!isLoading &&
                !loadError &&
                pdf &&
                Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => {
                  const info = pageInfoMap.get(pageNumber);
                  return (
                    <PdfPageView
                      key={`${file.id}-${file.version}-${pageNumber}`}
                      pdf={pdf}
                      pageNumber={pageNumber}
                      scale={scale}
                      baseWidth={info?.width ?? DEFAULT_PAGE_WIDTH}
                      baseHeight={info?.height ?? DEFAULT_PAGE_HEIGHT}
                      hasTextLayer={(info?.textWordCount ?? 1) > 0}
                      registerRef={registerRef}
                    />
                  );
                })}
            </div>

            {/* Page navigation */}
            <div className="px-4 py-2 bg-white border-t border-[#D9E1EF] flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={currentPage <= 1}
                  onClick={() => goToPage(currentPage - 1)}
                  className="p-1.5 rounded-lg border border-[#D9E1EF] text-[#585470] hover:text-[#2E2252] hover:bg-[#F4F6FB] disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    goToPage(Number(jumpValue));
                  }}
                  className="flex items-center gap-1 text-[11px] text-[#585470] font-mono-tabular"
                >
                  <label htmlFor="pdf-page-input" className="sr-only">
                    Jump to page
                  </label>
                  <input
                    id="pdf-page-input"
                    value={jumpValue}
                    onChange={(event) => setJumpValue(event.target.value.replace(/[^0-9]/g, ''))}
                    inputMode="numeric"
                    className="w-10 px-1.5 py-1 rounded border border-[#D9E1EF] bg-white text-center text-[11px] text-[#1E1935] focus:outline-none focus:ring-2 focus:ring-[#2E2252]/20"
                  />
                  <span>/ {pageCount}</span>
                </form>
                <button
                  type="button"
                  aria-label="Next page"
                  disabled={currentPage >= pageCount}
                  onClick={() => goToPage(currentPage + 1)}
                  className="p-1.5 rounded-lg border border-[#D9E1EF] text-[#585470] hover:text-[#2E2252] hover:bg-[#F4F6FB] disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-2 min-w-0">
                {file.metadataFlags?.scannedLikely && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] px-1.5 py-0.5 rounded whitespace-nowrap">
                    <ScanLine className="w-3 h-3" /> Scanned
                  </span>
                )}
                <span className="text-[11px] text-[#585470] font-mono-tabular truncate">
                  In-app PDF engine · canvas + text layer
                </span>
              </div>
            </div>
          </>
        )}

        {mode === 'outline' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {!inspection && (
              <div className="flex items-center gap-2 text-xs text-[#585470]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Inspecting PDF…
              </div>
            )}

            {inspection && (
              <>
                <section className="rounded-xl border border-[#D9E1EF] bg-white p-4">
                  <h3 className="font-display text-sm font-semibold text-[#1E1935] mb-2">
                    Document metadata
                  </h3>
                  <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-xs">
                    {[
                      ['Title', inspection.metadata.title || file.title],
                      ['Author', inspection.metadata.author || '—'],
                      ['Subject', inspection.metadata.subject || '—'],
                      ['Producer', inspection.metadata.producer || '—'],
                      ['Creator', inspection.metadata.creator || '—'],
                      ['Created', inspection.metadata.creationDate || file.createdAt],
                      ['Modified', inspection.metadata.modificationDate || file.updatedAt],
                    ].map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="text-[#585470]">{label}</dt>
                        <dd className="text-[#1E1935] break-words">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="rounded-xl border border-[#D9E1EF] bg-white p-4">
                  <h3 className="font-display text-sm font-semibold text-[#1E1935] mb-2">
                    Page geometry
                  </h3>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {inspection.pages.map((page) => (
                      <button
                        key={page.pageNumber}
                        type="button"
                        onClick={() => {
                          setMode('document');
                          goToPage(page.pageNumber);
                        }}
                        className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px] text-[#585470] hover:bg-[#F4F6FB] cursor-pointer"
                      >
                        <span className="font-medium text-[#1E1935]">Page {page.pageNumber}</span>
                        <span className="font-mono-tabular">
                          {page.width} × {page.height} pt · {page.rotation}° ·{' '}
                          {page.textWordCount > 0 ? `${page.textWordCount} words` : 'no text'}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-[#D9E1EF] bg-white p-4">
                  <h3 className="font-display text-sm font-semibold text-[#1E1935] mb-2">
                    Outline &amp; bookmarks
                  </h3>
                  {inspection.outline.length === 0 ? (
                    <p className="text-xs text-[#585470]">
                      This PDF has no bookmarks. Generated Vod PDFs use headings for visual structure.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {inspection.outline.map((item, index) => (
                        <li key={`${item.title}-${index}`} style={{ paddingLeft: (item.level - 1) * 12 }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (!item.pageNumber) return;
                              setMode('document');
                              goToPage(item.pageNumber);
                            }}
                            className="text-left text-xs text-[#1E1935] hover:text-[#4A3680] cursor-pointer"
                          >
                            {item.title}
                            {item.pageNumber ? (
                              <span className="text-[#585470] font-mono-tabular"> · p.{item.pageNumber}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-xl border border-[#D9E1EF] bg-white p-4">
                  <h3 className="font-display text-sm font-semibold text-[#1E1935] mb-2">
                    Forms &amp; annotations
                  </h3>
                  <p className="text-xs text-[#585470]">
                    {inspection.forms.hasAcroForm
                      ? `${inspection.forms.fieldCount} AcroForm field(s): ${inspection.forms.fields
                          .map((field) => field.name)
                          .slice(0, 8)
                          .join(', ')}`
                      : 'No AcroForm fields (not a fillable form).'}
                  </p>
                  {inspection.annotations.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {inspection.annotations.map((annotation) => (
                        <div
                          key={annotation.id}
                          className="rounded-lg border border-[#D9E1EF] bg-[#F4F6FB] p-2.5 text-xs"
                        >
                          <div className="flex items-center justify-between text-[#585470] mb-1">
                            <span className="font-semibold text-[#1E1935]">
                              {annotation.author || 'Reviewer'} · p.{annotation.pageNumber}
                            </span>
                            <span className="font-mono-tabular">{annotation.type}</span>
                          </div>
                          <p className="text-[#2E2252] leading-relaxed">
                            {annotation.content || 'Annotation'}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-[#585470]">No annotations/comments on this PDF.</p>
                  )}
                </section>

                <section className="rounded-xl border border-[#D9E1EF] bg-white p-4">
                  <h3 className="font-display text-sm font-semibold text-[#1E1935] mb-2">
                    Engine capabilities
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {capabilities &&
                      Object.entries(capabilities).map(([key, supported]) => (
                        <span
                          key={key}
                          className={`px-2 py-0.5 rounded border text-[10px] font-medium font-mono-tabular ${
                            supported
                              ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                              : 'bg-[#F4F6FB] border-[#D9E1EF] text-[#8E98AE]'
                          }`}
                        >
                          {key.replace(/^can/, '')} · {supported ? 'yes' : 'no'}
                        </span>
                      ))}
                  </div>
                  {allWarnings.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {allWarnings.map((warning, index) => (
                        <li key={index} className="text-[11px] text-[#B45309] flex gap-1.5">
                          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                          <span>{warning}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
        )}

        {mode === 'text' && (
          <div className="flex-1 overflow-y-auto p-4">
            {!inspection ? (
              <div className="flex items-center gap-2 text-xs text-[#585470]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Extracting text…
              </div>
            ) : inspection.file.textWordCount === 0 ? (
              <div className="rounded-xl border border-[#D9E1EF] bg-white p-4 text-xs text-[#585470] leading-relaxed">
                <div className="flex items-center gap-2 font-semibold text-[#1E1935] mb-1.5">
                  <ScanLine className="w-4 h-4 text-[#B45309]" /> No extractable text layer
                </div>
                This PDF is image-only (likely a scan). Pages still render in Document view and you can
                add review comments, but text search and grounding are unavailable.
              </div>
            ) : (
              <div className="rounded-xl border border-[#D9E1EF] bg-white p-4 space-y-4">
                {pageTextMap.size > 0
                  ? Array.from(pageTextMap.entries()).map(([pageNumber, text]) => (
                      <div key={pageNumber}>
                        <div className="text-[11px] font-semibold text-[#2E2252] mb-1">
                          Page {pageNumber}
                        </div>
                        <p className="font-mono-tabular text-[11px] leading-relaxed text-[#2E2252] whitespace-pre-wrap break-words">
                          {text || '—'}
                        </p>
                      </div>
                    ))
                  : (
                      <pre className="font-mono-tabular text-[11px] leading-relaxed text-[#2E2252] whitespace-pre-wrap break-words">
                        {flattenedText || 'No text preview available.'}
                      </pre>
                    )}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
