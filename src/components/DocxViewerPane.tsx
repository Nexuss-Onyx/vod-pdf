import { renderAsync } from 'docx-preview';
import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pencil,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  DocxAttachment,
  DocxInspection,
  DocxViewerMode,
} from '../types/vod';
import { formatBytes } from '../utils/format';

interface DocxViewerPaneProps {
  file: DocxAttachment;
  onClose: () => void;
  onAskToEdit: (file: DocxAttachment) => void;
}

export function DocxViewerPane({ file, onClose, onAskToEdit }: DocxViewerPaneProps) {
  const [mode, setMode] = useState<DocxViewerMode>('document');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoadingDoc, setIsLoadingDoc] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<DocxInspection | null>(null);
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');
  const [computedScale, setComputedScale] = useState(1);

  const scrollHostRef = useRef<HTMLDivElement>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);

  const updateFitScale = () => {
    const container = scrollHostRef.current;
    const host = previewHostRef.current;
    if (!container || !host) return;

    const firstPage = host.querySelector('section.docx') as HTMLElement | null;
    if (!firstPage) {
      setComputedScale(1);
      return;
    }

    if (zoomMode !== 'fit') {
      setComputedScale(zoomMode);
      return;
    }

    const availableWidth = Math.max(280, container.clientWidth - 40);
    const naturalWidth = Math.max(firstPage.offsetWidth || 0, firstPage.scrollWidth || 0, 816);
    const nextScale = Math.min(1, Number((availableWidth / naturalWidth).toFixed(3)));
    setComputedScale(nextScale);
  };

  useEffect(() => {
    updateFitScale();
    const container = scrollHostRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateFitScale());
    observer.observe(container);
    return () => observer.disconnect();
  }, [zoomMode, isExpanded, mode]);

  useEffect(() => {
    let cancelled = false;

    async function loadDocument() {
      setIsLoadingDoc(true);
      setRenderError(null);
      try {
        const [binRes, inspectRes] = await Promise.all([
          fetch(`/api/files/${encodeURIComponent(file.id)}/download?inline=1`),
          fetch(`/api/files/${encodeURIComponent(file.id)}/inspect`),
        ]);

        if (!binRes.ok) {
          throw new Error('Could not load .docx binary file.');
        }

        const arrayBuffer = await binRes.arrayBuffer();
        if (cancelled) return;

        if (inspectRes.ok) {
          const inspectJson = (await inspectRes.json()) as DocxInspection;
          if (!cancelled) setInspection(inspectJson);
        }

        if (previewHostRef.current) {
          previewHostRef.current.innerHTML = '';
          await renderAsync(arrayBuffer, previewHostRef.current, undefined, {
            className: 'docx',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true,
            useBase64URL: true,
          });
          if (!cancelled) {
            requestAnimationFrame(() => updateFitScale());
          }
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : 'Failed to render .docx preview.');
        }
      } finally {
        if (!cancelled) setIsLoadingDoc(false);
      }
    }

    loadDocument();
    return () => {
      cancelled = true;
    };
  }, [file.id, file.version, file.updatedAt]);

  return (
    <aside
      aria-label="DOCX Reader and Viewer"
      className={
        isExpanded
          ? 'fixed inset-0 z-50 bg-[#F4F2EC] flex flex-col'
          : 'w-full lg:w-[500px] xl:w-[580px] border-l border-[#E5E2DA] bg-[#F4F2EC] flex flex-col shrink-0'
      }
    >
      {/* Viewer Header */}
      <div className="px-4 py-3 bg-white border-b border-[#E5E2DA] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#1A73E8] text-white flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold text-slate-900 truncate">
              {file.filename}
            </h2>
            <p className="text-[11px] text-slate-500 font-mono-tabular truncate">
              v{file.version} · {formatBytes(file.sizeBytes)} · {file.wordCount} words
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onAskToEdit(file)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Edit in Chat</span>
          </button>

          <a
            href={`/api/files/${encodeURIComponent(file.id)}/download`}
            download={file.filename}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-white bg-[#1A73E8] hover:bg-[#1557B0] inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </a>

          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            aria-label={isExpanded ? 'Exit fullscreen viewer' : 'Expand DOCX viewer'}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close DOCX viewer"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewer Mode Switcher & Zoom Controls */}
      <div className="px-4 py-2 bg-white border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
        <div
          role="tablist"
          aria-label="Document view modes"
          className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'document'}
            onClick={() => setMode('document')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              mode === 'document'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Document View
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'structure'}
            onClick={() => setMode('structure')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              mode === 'structure'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Structure &amp; Redlines
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'xml'}
            onClick={() => setMode('xml')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              mode === 'xml'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            OOXML Source
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {mode === 'document' && (
            <div className="inline-flex items-center gap-1 text-xs text-slate-600">
              <button
                type="button"
                aria-label="Zoom out document"
                onClick={() =>
                  setZoomMode(Math.max(0.5, Number((computedScale - 0.1).toFixed(2))))
                }
                className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoomMode('fit')}
                className="px-1.5 py-0.5 rounded hover:bg-slate-100 font-mono-tabular text-[11px] text-slate-700 cursor-pointer"
                title="Reset to Fit Width"
              >
                {Math.round(computedScale * 100)}%
              </button>
              <button
                type="button"
                aria-label="Zoom in document"
                onClick={() =>
                  setZoomMode(Math.min(1.5, Number((computedScale + 0.1).toFixed(2))))
                }
                className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {inspection?.validation && (
            <div className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
              <CheckCircle2
                className={`w-3.5 h-3.5 ${
                  inspection.validation.valid ? 'text-emerald-600' : 'text-amber-600'
                }`}
              />
              <span>{inspection.validation.valid ? 'OOXML Valid' : 'Warnings'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Viewer Content */}
      <div ref={scrollHostRef} className="flex-1 overflow-auto relative">
        {isLoadingDoc && (
          <div className="absolute inset-0 bg-slate-100/80 z-10 flex items-center justify-center gap-2 text-sm text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin text-[#1A73E8]" />
            <span>Rendering Microsoft Word pages...</span>
          </div>
        )}

        {renderError && (
          <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {renderError}
          </div>
        )}

        <div
          ref={previewHostRef}
          style={{ zoom: computedScale }}
          className={`docx-viewer-host min-h-full ${mode === 'document' ? 'block' : 'hidden'}`}
        />

        {mode === 'structure' && (
          <div className="p-5 space-y-6 max-w-3xl mx-auto">
            {!inspection ? (
              <p className="text-sm text-slate-500">Loading document structure...</p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] text-slate-500">Words</div>
                    <div className="text-lg font-semibold text-slate-900 font-mono-tabular mt-0.5">
                      {inspection.wordCount}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] text-slate-500">Paragraphs</div>
                    <div className="text-lg font-semibold text-slate-900 font-mono-tabular mt-0.5">
                      {inspection.paragraphCount}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] text-slate-500">Tables</div>
                    <div className="text-lg font-semibold text-slate-900 font-mono-tabular mt-0.5">
                      {inspection.tableCount}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] text-slate-500">Comments</div>
                    <div className="text-lg font-semibold text-slate-900 font-mono-tabular mt-0.5">
                      {inspection.comments.length}
                    </div>
                  </div>
                </div>

                {/* Outline */}
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-xs font-semibold text-slate-900 mb-3">Document Outline</h3>
                  {inspection.outline.length === 0 ? (
                    <p className="text-xs text-slate-500">No heading styles detected.</p>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {inspection.outline.map((item, idx) => (
                        <li
                          key={`${item.text}-${idx}`}
                          style={{ paddingLeft: `${(item.level - 1) * 14}px` }}
                          className="text-slate-700"
                        >
                          <span className="font-mono-tabular text-[11px] text-slate-400 mr-2">
                            H{item.level}
                          </span>
                          <span>{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Tracked Changes */}
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-xs font-semibold text-slate-900 mb-3">
                    Tracked Redlines ({inspection.trackedChanges.length})
                  </h3>
                  {inspection.trackedChanges.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No pending tracked insertions or deletions in this document.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {inspection.trackedChanges.map((tc) => (
                        <div
                          key={`${tc.type}-${tc.id}`}
                          className="rounded-lg border border-slate-200 p-2.5 text-xs"
                        >
                          <div className="flex items-center justify-between text-slate-500 mb-1">
                            <span
                              className={`font-semibold ${
                                tc.type === 'insertion' ? 'text-emerald-700' : 'text-red-700'
                              }`}
                            >
                              {tc.type === 'insertion' ? 'Inserted' : 'Deleted'}
                            </span>
                            <span className="font-mono-tabular">{tc.author}</span>
                          </div>
                          <p
                            className={
                              tc.type === 'deletion'
                                ? 'line-through text-red-700'
                                : 'text-emerald-800'
                            }
                          >
                            {tc.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Word Comments */}
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-xs font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                    <span>Word Comments ({inspection.comments.length})</span>
                  </h3>
                  {inspection.comments.length === 0 ? (
                    <p className="text-xs text-slate-500">No review comments attached yet.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {inspection.comments.map((c) => (
                        <div
                          key={c.id}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
                        >
                          <div className="flex items-center justify-between text-slate-500 mb-1">
                            <span className="font-semibold text-slate-800">{c.author}</span>
                            <span className="font-mono-tabular">#{c.id}</span>
                          </div>
                          <p className="text-slate-700 leading-relaxed">{c.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {mode === 'xml' && (
          <div className="p-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 overflow-x-auto">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                word/document.xml
              </div>
              <pre className="font-mono-tabular text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap break-all">
                {inspection?.documentXml || 'Loading XML...'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
