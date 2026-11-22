import { renderAsync } from 'docx-preview';
import {
  CheckCircle2,
  Download,
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
import { loadLocalFileBlob, saveLocalFileBlob } from '../utils/localWorkspaceDb';
import { WordDocIcon } from './VodBrandMarks';

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
        const cached = await loadLocalFileBlob(file.id);
        let arrayBuffer = cached?.buffer;
        let resolvedInspection = cached?.inspection ?? null;

        if (!arrayBuffer || !resolvedInspection) {
          const [binRes, inspectRes] = await Promise.all([
            arrayBuffer
              ? Promise.resolve(null)
              : fetch(`/api/files/${encodeURIComponent(file.id)}/download?inline=1`),
            resolvedInspection
              ? Promise.resolve(null)
              : fetch(`/api/files/${encodeURIComponent(file.id)}/inspect`),
          ]);

          if (binRes) {
            if (!binRes.ok) {
              throw new Error('Could not load .docx binary file.');
            }
            arrayBuffer = await binRes.arrayBuffer();
          }
          if (inspectRes && inspectRes.ok) {
            resolvedInspection = (await inspectRes.json()) as DocxInspection;
          }
          if (arrayBuffer) {
            void saveLocalFileBlob(file.id, arrayBuffer, resolvedInspection ?? undefined);
          }
        }

        if (cancelled || !arrayBuffer) return;
        if (resolvedInspection) {
          setInspection(resolvedInspection);
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
          ? 'fixed inset-0 z-50 bg-[#E9EEF8] flex flex-col'
          : 'w-full lg:w-[500px] xl:w-[580px] border-l border-[#D9E1EF] bg-[#E9EEF8] flex flex-col shrink-0'
      }
    >
      {/* Viewer Header */}
      <div className="px-4 py-3 bg-white border-b border-[#D9E1EF] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <WordDocIcon className="w-8 h-8 shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold text-[#1E1935] truncate">
              {file.filename}
            </h2>
            <p className="text-[11px] text-[#585470] font-mono-tabular truncate">
              v{file.version} · {formatBytes(file.sizeBytes)} · {file.wordCount} words
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onAskToEdit(file)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#2E2252] bg-[#F4F6FB] hover:bg-[#E8F0FC] hover:text-[#103F91] border border-[#D9E1EF] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Pencil className="w-3.5 h-3.5 text-[#185ABD]" />
            <span>Edit in Chat</span>
          </button>

          <a
            href={`/api/files/${encodeURIComponent(file.id)}/download`}
            download={file.filename}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-white bg-[#185ABD] hover:bg-[#103F91] inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </a>

          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            aria-label={isExpanded ? 'Exit fullscreen viewer' : 'Expand DOCX viewer'}
            className="p-1.5 rounded-lg text-[#585470] hover:text-[#2E2252] hover:bg-[#ECEFF7] cursor-pointer"
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close DOCX viewer"
            className="p-1.5 rounded-lg text-[#585470] hover:text-[#2E2252] hover:bg-[#ECEFF7] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewer Mode Switcher & Zoom Controls */}
      <div className="px-4 py-2 bg-[#F4F6FB] border-b border-[#D9E1EF] flex items-center justify-between gap-2 shrink-0">
        <div
          role="tablist"
          aria-label="Document view modes"
          className="inline-flex items-center gap-1 p-1 bg-[#E2E9F5] rounded-lg"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'document'}
            onClick={() => setMode('document')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              mode === 'document'
                ? 'bg-white text-[#103F91] shadow-xs'
                : 'text-[#585470] hover:text-[#1E1935]'
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
                ? 'bg-white text-[#103F91] shadow-xs'
                : 'text-[#585470] hover:text-[#1E1935]'
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
                ? 'bg-white text-[#103F91] shadow-xs'
                : 'text-[#585470] hover:text-[#1E1935]'
            }`}
          >
            OOXML Source
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {mode === 'document' && (
            <div className="inline-flex items-center gap-1 text-xs text-[#585470]">
              <button
                type="button"
                aria-label="Zoom out document"
                onClick={() =>
                  setZoomMode(Math.max(0.5, Number((computedScale - 0.1).toFixed(2))))
                }
                className="p-1 rounded hover:bg-[#D9E1EF]/60 text-[#585470] hover:text-[#1E1935] cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoomMode('fit')}
                className="px-1.5 py-0.5 rounded hover:bg-[#D9E1EF]/60 font-mono-tabular text-[11px] text-[#1E1935] cursor-pointer"
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
                className="p-1 rounded hover:bg-[#D9E1EF]/60 text-[#585470] hover:text-[#1E1935] cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {inspection?.validation && (
            <div className="hidden sm:inline-flex items-center gap-1 text-xs text-[#2E2252] whitespace-nowrap">
              <CheckCircle2
                className={`w-3.5 h-3.5 ${
                  inspection.validation.valid ? 'text-[#16A34A]' : 'text-[#D97706]'
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
          <div className="absolute inset-0 bg-[#E9EEF8]/85 z-10 flex items-center justify-center gap-2 text-sm text-[#2E2252]">
            <Loader2 className="w-4 h-4 animate-spin text-[#185ABD]" />
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
          <div className="p-5 space-y-5 max-w-3xl mx-auto">
            {!inspection ? (
              <p className="text-sm text-[#585470]">Loading document structure...</p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-xl border border-[#D9E1EF] bg-white p-3">
                    <div className="text-[11px] text-[#585470]">Words</div>
                    <div className="text-lg font-semibold text-[#1E1935] font-mono-tabular mt-0.5">
                      {inspection.wordCount}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#D9E1EF] bg-white p-3">
                    <div className="text-[11px] text-[#585470]">Paragraphs</div>
                    <div className="text-lg font-semibold text-[#1E1935] font-mono-tabular mt-0.5">
                      {inspection.paragraphCount}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#D9E1EF] bg-white p-3">
                    <div className="text-[11px] text-[#585470]">Tables</div>
                    <div className="text-lg font-semibold text-[#1E1935] font-mono-tabular mt-0.5">
                      {inspection.tableCount}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#D9E1EF] bg-white p-3">
                    <div className="text-[11px] text-[#585470]">Comments</div>
                    <div className="text-lg font-semibold text-[#1E1935] font-mono-tabular mt-0.5">
                      {inspection.comments.length}
                    </div>
                  </div>
                </div>

                {/* Outline */}
                <div className="rounded-xl border border-[#D9E1EF] bg-white p-4">
                  <h3 className="text-xs font-semibold text-[#1E1935] mb-3">Document Outline</h3>
                  {inspection.outline.length === 0 ? (
                    <p className="text-xs text-[#585470]">No heading styles detected.</p>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {inspection.outline.map((item, idx) => (
                        <li
                          key={`${item.text}-${idx}`}
                          style={{ paddingLeft: `${(item.level - 1) * 14}px` }}
                          className="text-[#1E1935]"
                        >
                          <span className="font-mono-tabular text-[11px] text-[#185ABD] mr-2">
                            H{item.level}
                          </span>
                          <span>{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Tracked Changes */}
                <div className="rounded-xl border border-[#D9E1EF] bg-white p-4">
                  <h3 className="text-xs font-semibold text-[#1E1935] mb-3">
                    Tracked Redlines ({inspection.trackedChanges.length})
                  </h3>
                  {inspection.trackedChanges.length === 0 ? (
                    <p className="text-xs text-[#585470]">
                      No pending tracked insertions or deletions in this document.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {inspection.trackedChanges.map((tc) => (
                        <div
                          key={`${tc.type}-${tc.id}`}
                          className="rounded-lg border border-[#D9E1EF] p-2.5 text-xs"
                        >
                          <div className="flex items-center justify-between text-[#585470] mb-1">
                            <span
                              className={`font-semibold ${
                                tc.type === 'insertion' ? 'text-[#16A34A]' : 'text-[#DC2626]'
                              }`}
                            >
                              {tc.type === 'insertion' ? 'Inserted' : 'Deleted'}
                            </span>
                            <span className="font-mono-tabular">{tc.author}</span>
                          </div>
                          <p
                            className={
                              tc.type === 'deletion'
                                ? 'line-through text-[#DC2626]'
                                : 'text-[#15803D]'
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
                <div className="rounded-xl border border-[#D9E1EF] bg-white p-4">
                  <h3 className="text-xs font-semibold text-[#1E1935] mb-3 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-[#185ABD]" />
                    <span>Word Comments ({inspection.comments.length})</span>
                  </h3>
                  {inspection.comments.length === 0 ? (
                    <p className="text-xs text-[#585470]">No review comments attached yet.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {inspection.comments.map((c) => (
                        <div
                          key={c.id}
                          className="rounded-lg border border-[#D9E1EF] bg-[#F4F6FB] p-3 text-xs"
                        >
                          <div className="flex items-center justify-between text-[#585470] mb-1">
                            <span className="font-semibold text-[#1E1935]">{c.author}</span>
                            <span className="font-mono-tabular">#{c.id}</span>
                          </div>
                          <p className="text-[#2E2252] leading-relaxed">{c.text}</p>
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
            <div className="rounded-xl border border-[#D9E1EF] bg-white p-4 overflow-x-auto">
              <div className="text-xs font-semibold text-[#103F91] mb-2">
                word/document.xml
              </div>
              <pre className="font-mono-tabular text-[11px] leading-relaxed text-[#2E2252] whitespace-pre-wrap break-all">
                {inspection?.documentXml || 'Loading XML...'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
