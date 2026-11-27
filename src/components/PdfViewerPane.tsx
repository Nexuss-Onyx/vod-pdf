import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  AlertTriangle,
  ArrowLeft,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Info,
  Layers,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  MoreHorizontal,
  Pencil,
  RotateCw,
  ScanLine,
  Search,
  Stamp,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PdfAttachment, PdfInspection, PdfSearchResult, PdfViewerMode } from '../types/vod';
import { downloadPdfAttachment } from '../utils/downloadPdf';
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
  onAskToEdit: (file: PdfAttachment, prefillPrompt?: string) => void;
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
          <span className="text-[11px] text-[#63565C] font-mono-tabular">Page {pageNumber}</span>
        </div>
      )}
      {pageError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/90 px-4 text-center">
          <AlertTriangle className="w-4 h-4 text-[#D97706]" />
          <span className="text-[11px] text-[#63565C]">Page {pageNumber} could not be rendered.</span>
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<PdfSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const frameRef = useRef<number | null>(null);
  const pendingScrollPageRef = useRef<number | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

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
      const margin = host.clientWidth < 520 ? 20 : 52;
      const available = Math.max(240, host.clientWidth - margin);
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

  const goToPage = useCallback(
    (pageNumber: number) => {
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
    },
    [pageCount],
  );

  const jumpToDocumentPage = useCallback(
    (pageNumber: number) => {
      if (mode !== 'document') {
        pendingScrollPageRef.current = pageNumber;
        setMode('document');
      } else {
        goToPage(pageNumber);
      }
    },
    [mode, goToPage],
  );

  useEffect(() => {
    if (mode === 'document' && pdf && pendingScrollPageRef.current !== null) {
      const target = pendingScrollPageRef.current;
      pendingScrollPageRef.current = null;
      requestAnimationFrame(() => goToPage(target));
    }
  }, [mode, pdf, goToPage]);

  useEffect(() => {
    setSearchResult(null);
    setSearchError(null);
    setIsMoreMenuOpen(false);
  }, [file.id, file.version]);

  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMoreMenuOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMoreMenuOpen]);

  const handleSearchSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResult(null);
      setSearchError(null);
      return;
    }
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/files/${encodeURIComponent(file.id)}/search?q=${encodeURIComponent(trimmed)}`,
      );
      const payload = (await res.json().catch(() => null)) as
        | (PdfSearchResult & { error?: string })
        | null;
      if (!res.ok || !payload) {
        throw new Error(payload?.error || 'Could not search this PDF.');
      }
      setSearchResult(payload);
      if (payload.matches.length > 0) {
        jumpToDocumentPage(payload.matches[0].pageNumber);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'PDF search failed.');
    } finally {
      setIsSearching(false);
    }
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
    `px-2 sm:px-2.5 py-2 text-[11px] sm:text-xs font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap -mb-px ${
      active
        ? 'border-[#6E162B] text-[#6E162B]'
        : 'border-transparent text-[#63565C] hover:text-[#1F171B]'
    }`;

  const triggerAdvancedTool = (prompt: string) => {
    setIsMoreMenuOpen(false);
    onAskToEdit(file, prompt);
  };

  return (
    <aside
      aria-label="PDF Reader and Viewer"
      className={
        isExpanded
          ? 'fixed inset-0 z-50 bg-[#F1EFF2] flex flex-col'
          : 'w-full lg:w-[46%] lg:min-w-[440px] lg:max-w-[640px] xl:w-[620px] lg:border-l border-[#E3DFE4] bg-[#F1EFF2] flex flex-col shrink-0 min-w-0'
      }
    >
      {/* Header */}
      <div className="px-3 sm:px-4 py-2.5 bg-white border-b border-[#E3DFE4] flex items-center justify-between gap-2 sm:gap-3 shrink-0">
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to chat"
            title="Back to chat"
            className="lg:hidden p-1.5 -ml-1 rounded-lg text-[#63565C] hover:text-[#6E162B] hover:bg-[#F1EFF2] cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <PdfDocIcon className="w-7 h-7 sm:w-8 sm:h-8 shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-xs sm:text-sm font-semibold text-[#1F171B] truncate">
              {file.filename}
            </h2>
            <p className="text-[11px] text-[#63565C] font-mono-tabular truncate">
              {formatPageCount(pageCount)} · {formatBytes(file.sizeBytes)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onAskToEdit(file)}
            aria-label="Edit in Chat"
            title="Edit in Chat"
            className="px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#1F171B] hover:text-[#6E162B] hover:bg-[#F8F7F8] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#6E162B]"
          >
            <Pencil className="w-3.5 h-3.5 text-[#A8203E]" />
            <span className="hidden sm:inline">Edit</span>
          </button>

          <a
            href={`/api/files/${encodeURIComponent(file.id)}/download`}
            download={file.filename}
            onClick={(event) => {
              event.preventDefault();
              void downloadPdfAttachment(file).catch((err) => {
                setLoadError(err instanceof Error ? err.message : 'Could not download PDF.');
              });
            }}
            aria-label="Download PDF"
            title="Download PDF"
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-white bg-[#6E162B] hover:bg-[#851D35] inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Download</span>
          </a>

          <div ref={moreMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setIsMoreMenuOpen((open) => !open)}
              aria-label="More PDF tools"
              aria-haspopup="menu"
              aria-expanded={isMoreMenuOpen}
              title="More PDF tools"
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                isMoreMenuOpen
                  ? 'bg-[#FBF1F3] text-[#6E162B]'
                  : 'text-[#63565C] hover:text-[#6E162B] hover:bg-[#F1EFF2]'
              }`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {isMoreMenuOpen && (
              <div
                role="menu"
                aria-label="PDF tools"
                className="absolute right-0 mt-1.5 w-56 rounded-xl border border-[#E3DFE4] bg-white shadow-lg py-1.5 z-30 text-xs text-[#1F171B]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    setMode('document');
                    setIsSearchOpen(true);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-[#F8F7F8] hover:text-[#6E162B] flex items-center gap-2.5 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5 text-[#63565C]" />
                  <span>Search inside PDF</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    triggerAdvancedTool(
                      'Add a subtle diagonal CONFIDENTIAL watermark across all pages of this PDF.',
                    )
                  }
                  className="w-full px-3 py-2 text-left hover:bg-[#F8F7F8] hover:text-[#6E162B] flex items-center gap-2.5 cursor-pointer"
                >
                  <Stamp className="w-3.5 h-3.5 text-[#63565C]" />
                  <span>Add watermark…</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    triggerAdvancedTool('Add a review comment on page 1 of this PDF about ')
                  }
                  className="w-full px-3 py-2 text-left hover:bg-[#F8F7F8] hover:text-[#6E162B] flex items-center gap-2.5 cursor-pointer"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5 text-[#63565C]" />
                  <span>Add review comment…</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    triggerAdvancedTool(
                      'Rotate page 1 clockwise or extract specific pages from this PDF.',
                    )
                  }
                  className="w-full px-3 py-2 text-left hover:bg-[#F8F7F8] hover:text-[#6E162B] flex items-center gap-2.5 cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5 text-[#63565C]" />
                  <span>Rotate or split pages…</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    triggerAdvancedTool(
                      'Inspect the fillable form fields in this PDF and help me fill them.',
                    )
                  }
                  className="w-full px-3 py-2 text-left hover:bg-[#F8F7F8] hover:text-[#6E162B] flex items-center gap-2.5 cursor-pointer"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-[#63565C]" />
                  <span>Fill form fields…</span>
                </button>
                <div className="my-1 border-t border-[#E3DFE4]" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    setIsExpanded((value) => !value);
                  }}
                  aria-label={isExpanded ? 'Exit fullscreen PDF viewer' : 'Expand PDF viewer'}
                  className="w-full px-3 py-2 text-left hover:bg-[#F8F7F8] hover:text-[#6E162B] flex items-center gap-2.5 cursor-pointer"
                >
                  {isExpanded ? (
                    <Minimize2 className="w-3.5 h-3.5 text-[#63565C]" />
                  ) : (
                    <Maximize2 className="w-3.5 h-3.5 text-[#63565C]" />
                  )}
                  <span>{isExpanded ? 'Exit fullscreen' : 'Expand fullscreen'}</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close PDF viewer"
            className="hidden lg:inline-flex p-1.5 rounded-lg text-[#63565C] hover:text-[#6E162B] hover:bg-[#F1EFF2] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode switcher */}
      <div className="px-3 sm:px-4 bg-white border-b border-[#E3DFE4] flex flex-wrap items-center justify-between gap-x-2 shrink-0">
        <div
          role="tablist"
          aria-label="PDF view modes"
          className="inline-flex items-center gap-0.5 sm:gap-1 max-w-full overflow-x-auto"
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
          <div className="flex items-center gap-0.5 py-1 shrink-0">
            <button
              type="button"
              aria-label="Search inside PDF"
              aria-expanded={isSearchOpen}
              title="Search inside PDF"
              onClick={() => setIsSearchOpen((v) => !v)}
              className={`p-1 rounded-md cursor-pointer transition-colors ${
                isSearchOpen
                  ? 'bg-[#FBF1F3] text-[#6E162B]'
                  : 'hover:bg-[#F1EFF2] text-[#63565C] hover:text-[#1F171B]'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <div className="h-3.5 w-px bg-[#E3DFE4] mx-0.5" aria-hidden="true" />
            <button
              type="button"
              aria-label="Zoom out PDF"
              disabled={scale <= MIN_SCALE}
              onClick={() => setZoomMode(clampScale(scale - 0.15))}
              className="p-1 rounded-md hover:bg-[#F1EFF2] text-[#63565C] hover:text-[#1F171B] cursor-pointer disabled:opacity-40"
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
                  ? 'text-[#6E162B] font-medium bg-[#FBF1F3]'
                  : 'hover:bg-[#F1EFF2] text-[#63565C]'
              }`}
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              aria-label="Zoom in PDF"
              disabled={scale >= MAX_SCALE}
              onClick={() => setZoomMode(clampScale(scale + 0.15))}
              className="p-1 rounded-md hover:bg-[#F1EFF2] text-[#63565C] hover:text-[#1F171B] cursor-pointer disabled:opacity-40"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {mode === 'document' && isSearchOpen && (
        <div className="px-3 sm:px-4 py-2 bg-white border-b border-[#E3DFE4] space-y-2 shrink-0">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-[#63565C] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search PDF text layer..."
                aria-label="Search PDF text layer"
                className="w-full pl-8 pr-2.5 py-1 rounded-md border border-[#E3DFE4] bg-[#F8F7F8] text-xs text-[#1F171B] placeholder:text-[#7D6E75] focus:outline-none focus:border-[#A8203E]"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className="px-2.5 py-1 rounded-md bg-[#6E162B] hover:bg-[#851D35] text-white text-xs font-medium cursor-pointer disabled:opacity-45 whitespace-nowrap"
            >
              {isSearching ? 'Finding…' : 'Find'}
            </button>
          </form>

          {searchError && (
            <p className="text-[11px] text-amber-800">{searchError}</p>
          )}

          {searchResult && !searchError && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-[#63565C] font-mono-tabular">
                <span>
                  {searchResult.totalMatches} match{searchResult.totalMatches === 1 ? '' : 'es'} across{' '}
                  {searchResult.pagesSearched} page{searchResult.pagesSearched === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSearchResult(null);
                    setSearchQuery('');
                  }}
                  className="text-[#6E162B] hover:underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
              {searchResult.matches.length > 0 && (
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {searchResult.matches.slice(0, 12).map((match, index) => (
                    <button
                      key={`${match.pageNumber}-${match.matchIndex}-${index}`}
                      type="button"
                      onClick={() => jumpToDocumentPage(match.pageNumber)}
                      className="w-full text-left px-2 py-1 rounded-md bg-[#F8F7F8] hover:bg-[#FBF1F3] border border-[#E3DFE4] text-[11px] text-[#1F171B] flex items-start gap-2 cursor-pointer"
                    >
                      <span className="font-mono-tabular font-semibold text-[#6E162B] shrink-0">
                        p.{match.pageNumber}
                      </span>
                      <span className="text-[#63565C] truncate">{match.snippet}</span>
                    </button>
                  ))}
                </div>
              )}
              {searchResult.warnings.length > 0 && searchResult.totalMatches === 0 && (
                <p className="text-[11px] text-[#63565C]">{searchResult.warnings[0]}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col">
        {mode === 'document' && (
          <>
            <div
              ref={scrollHostRef}
              onScroll={handleScroll}
              className="pdf-viewer-host flex-1 overflow-auto px-2.5 sm:px-4 py-3 sm:py-5 flex flex-col items-center gap-3 sm:gap-4"
            >
              {isLoading && (
                <div className="w-full max-w-[560px] animate-pulse space-y-4" aria-live="polite">
                  <div className="h-[320px] rounded-md bg-white border border-[#E3DFE4]" />
                  <div className="flex items-center justify-center gap-2 text-xs text-[#63565C]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Rendering PDF pages…</span>
                  </div>
                </div>
              )}

              {!isLoading && loadError && (
                <div className="w-full max-w-[560px] rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                    <span>This PDF could not be rendered</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed">{loadError}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setReloadToken((value) => value + 1)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-medium text-amber-900 hover:bg-amber-100 cursor-pointer"
                    >
                      <RotateCw className="w-3.5 h-3.5" /> Retry
                    </button>
                    <a
                      href={`/api/files/${encodeURIComponent(file.id)}/download`}
                      download={file.filename}
                      onClick={(event) => {
                        event.preventDefault();
                        void downloadPdfAttachment(file).catch(() => {});
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6E162B] text-xs font-medium text-white hover:bg-[#851D35]"
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
            <div className="px-3 sm:px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-white border-t border-[#E3DFE4] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 mx-auto">
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={currentPage <= 1}
                  onClick={() => goToPage(currentPage - 1)}
                  className="p-1.5 rounded-lg text-[#63565C] hover:text-[#6E162B] hover:bg-[#F8F7F8] disabled:opacity-35 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    goToPage(Number(jumpValue));
                  }}
                  className="flex items-center gap-1.5 text-[11px] text-[#63565C] font-mono-tabular"
                >
                  <label htmlFor="pdf-page-input" className="sr-only">
                    Jump to page
                  </label>
                  <input
                    id="pdf-page-input"
                    value={jumpValue}
                    onChange={(event) => setJumpValue(event.target.value.replace(/[^0-9]/g, ''))}
                    inputMode="numeric"
                    className="w-9 px-1 py-0.5 rounded border border-[#E3DFE4] bg-white text-center text-[11px] text-[#1F171B] focus:outline-none focus:ring-2 focus:ring-[#6E162B]/20"
                  />
                  <span>of {pageCount}</span>
                </form>
                <button
                  type="button"
                  aria-label="Next page"
                  disabled={currentPage >= pageCount}
                  onClick={() => goToPage(currentPage + 1)}
                  className="p-1.5 rounded-lg text-[#63565C] hover:text-[#6E162B] hover:bg-[#F8F7F8] disabled:opacity-35 cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {file.metadataFlags?.scannedLikely && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">
                  <ScanLine className="w-3 h-3" /> Scanned
                </span>
              )}
            </div>
          </>
        )}

        {mode === 'outline' && (
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
            {!inspection && (
              <div className="flex items-center gap-2 text-xs text-[#63565C]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Inspecting PDF…
              </div>
            )}

            {inspection && (
              <>
                <section className="rounded-xl border border-[#E3DFE4] bg-white p-4">
                  <h3 className="font-display text-sm font-semibold text-[#1F171B] mb-2.5">
                    Overview
                  </h3>
                  <dl className="grid grid-cols-[96px_1fr] gap-y-1.5 text-xs">
                    {[
                      ['Title', inspection.metadata.title || file.title],
                      ...(inspection.metadata.author
                        ? [['Author', inspection.metadata.author]]
                        : []),
                      ['Pages', formatPageCount(pageCount)],
                      ['Words', formatWordCount(file.textWordCount)],
                      ['File size', formatBytes(file.sizeBytes)],
                      ['Version', `v${file.version}`],
                    ].map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="text-[#63565C]">{label}</dt>
                        <dd className="text-[#1F171B] break-words">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="rounded-xl border border-[#E3DFE4] bg-white p-4">
                  <h3 className="font-display text-sm font-semibold text-[#1F171B] mb-2">
                    Bookmarks &amp; pages
                  </h3>
                  {inspection.outline.length > 0 ? (
                    <ul className="space-y-1">
                      {inspection.outline.map((item, index) => (
                        <li key={`${item.title}-${index}`} style={{ paddingLeft: (item.level - 1) * 12 }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (!item.pageNumber) return;
                              jumpToDocumentPage(item.pageNumber);
                            }}
                            className="text-left text-xs text-[#1F171B] hover:text-[#A8203E] cursor-pointer"
                          >
                            {item.title}
                            {item.pageNumber ? (
                              <span className="text-[#63565C] font-mono-tabular"> · p.{item.pageNumber}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs text-[#63565C]">
                        No embedded bookmarks. Jump directly to a page:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {inspection.pages.map((page) => (
                          <button
                            key={page.pageNumber}
                            type="button"
                            onClick={() => jumpToDocumentPage(page.pageNumber)}
                            className="px-2.5 py-1 rounded-md border border-[#E3DFE4] bg-[#F8F7F8] hover:bg-[#FBF1F3] hover:border-[#EBCBD2] text-[11px] font-mono-tabular text-[#1F171B] hover:text-[#6E162B] cursor-pointer"
                          >
                            Page {page.pageNumber}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                {(inspection.forms.hasAcroForm || inspection.annotations.length > 0) && (
                  <section className="rounded-xl border border-[#E3DFE4] bg-white p-4">
                    <h3 className="font-display text-sm font-semibold text-[#1F171B] mb-2">
                      Comments &amp; forms
                    </h3>
                    {inspection.forms.hasAcroForm && (
                      <p className="text-xs text-[#63565C]">
                        {inspection.forms.fieldCount} fillable form field(s):{' '}
                        {inspection.forms.fields
                          .map((field) => field.name)
                          .slice(0, 8)
                          .join(', ')}
                      </p>
                    )}
                    {inspection.annotations.length > 0 && (
                      <div className="mt-2.5 space-y-2">
                        {inspection.annotations.map((annotation) => (
                          <div
                            key={annotation.id}
                            className="rounded-lg border border-[#E3DFE4] bg-[#F8F7F8] p-2.5 text-xs"
                          >
                            <div className="flex items-center justify-between text-[#63565C] mb-1">
                              <span className="font-semibold text-[#1F171B]">
                                {annotation.author || 'Reviewer'} · p.{annotation.pageNumber}
                              </span>
                              <span className="font-mono-tabular">{annotation.type}</span>
                            </div>
                            <p className="text-[#6E162B] leading-relaxed">
                              {annotation.content || 'Annotation'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                <details className="group rounded-xl border border-[#E3DFE4] bg-white">
                  <summary className="list-none px-4 py-3 flex items-center justify-between gap-2 cursor-pointer select-none text-xs font-medium text-[#1F171B] hover:text-[#6E162B]">
                    <span>Technical metadata &amp; engine capabilities</span>
                    <ChevronDown className="w-3.5 h-3.5 text-[#63565C] transition-transform group-open:rotate-180" />
                  </summary>

                  <div className="px-4 pb-4 pt-1 border-t border-[#E3DFE4] space-y-4">
                    <div>
                      <h4 className="text-[11px] font-semibold text-[#63565C] mb-1.5">
                        Document properties
                      </h4>
                      <dl className="grid grid-cols-[96px_1fr] gap-y-1 text-xs">
                        {[
                          ['Subject', inspection.metadata.subject || '—'],
                          ['Producer', inspection.metadata.producer || '—'],
                          ['Creator', inspection.metadata.creator || '—'],
                          ['Created', inspection.metadata.creationDate || file.createdAt],
                          ['Modified', inspection.metadata.modificationDate || file.updatedAt],
                        ].map(([label, value]) => (
                          <div key={label} className="contents">
                            <dt className="text-[#63565C]">{label}</dt>
                            <dd className="text-[#1F171B] break-words">{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>

                    <div>
                      <h4 className="text-[11px] font-semibold text-[#63565C] mb-1.5">
                        Page geometry
                      </h4>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {inspection.pages.map((page) => (
                          <button
                            key={page.pageNumber}
                            type="button"
                            onClick={() => jumpToDocumentPage(page.pageNumber)}
                            className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px] text-[#63565C] hover:bg-[#F8F7F8] cursor-pointer"
                          >
                            <span className="font-medium text-[#1F171B]">Page {page.pageNumber}</span>
                            <span className="font-mono-tabular">
                              {page.width} × {page.height} pt · {page.rotation}° ·{' '}
                              {page.textWordCount > 0 ? `${page.textWordCount} words` : 'no text'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-[11px] font-semibold text-[#63565C] mb-1.5">
                        Engine capabilities
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {capabilities &&
                          Object.entries(capabilities).map(([key, supported]) => (
                            <span
                              key={key}
                              className={`px-2 py-0.5 rounded border text-[10px] font-medium font-mono-tabular ${
                                supported
                                  ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                                  : 'bg-[#F8F7F8] border-[#E3DFE4] text-[#8F848A]'
                              }`}
                            >
                              {key.replace(/^can/, '')} · {supported ? 'yes' : 'no'}
                            </span>
                          ))}
                      </div>
                    </div>

                    {allWarnings.length > 0 && (
                      <ul className="space-y-1">
                        {allWarnings.map((warning, index) => (
                          <li key={index} className="text-[11px] text-[#B45309] flex gap-1.5">
                            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                            <span>{warning}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              </>
            )}
          </div>
        )}

        {mode === 'text' && (
          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            {!inspection ? (
              <div className="flex items-center gap-2 text-xs text-[#63565C]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Extracting text…
              </div>
            ) : inspection.file.textWordCount === 0 ? (
              <div className="rounded-xl border border-[#E3DFE4] bg-white p-4 text-xs text-[#63565C] leading-relaxed">
                <div className="flex items-center gap-2 font-semibold text-[#1F171B] mb-1.5">
                  <ScanLine className="w-4 h-4 text-[#B45309]" /> No extractable text layer
                </div>
                This PDF is image-only (likely a scan). Pages still render in Document view and you can
                add review comments, but text search and grounding are unavailable.
              </div>
            ) : (
              <div className="rounded-xl border border-[#E3DFE4] bg-white p-4 space-y-4">
                {pageTextMap.size > 0
                  ? Array.from(pageTextMap.entries()).map(([pageNumber, text]) => (
                      <div key={pageNumber}>
                        <div className="text-[11px] font-semibold text-[#6E162B] mb-1">
                          Page {pageNumber}
                        </div>
                        <p className="font-mono-tabular text-[11px] leading-relaxed text-[#1F171B] whitespace-pre-wrap break-words">
                          {text || '—'}
                        </p>
                      </div>
                    ))
                  : (
                      <pre className="font-mono-tabular text-[11px] leading-relaxed text-[#1F171B] whitespace-pre-wrap break-words">
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
