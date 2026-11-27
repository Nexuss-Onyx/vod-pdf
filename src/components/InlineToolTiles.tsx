import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  FilePlus2,
  FileSearch,
  Layers,
  Loader2,
  MessageSquare,
  Play,
  Search,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AgentToolStep } from '../types/vod';

/** PDF-native tool icons mirroring the agent tool declarations. */
const TOOL_ICONS: Record<string, typeof FilePlus2> = {
  list_files: FileSearch,
  inspect_pdf: FileSearch,
  search_pdf: Search,
  create_pdf: FilePlus2,
  edit_pdf: FilePlus2,
  comment_pdf: MessageSquare,
  fill_pdf_form: FileCheck2,
  organize_pdf: Layers,
};

interface InlineToolTilesProps {
  steps: AgentToolStep[];
  isTurnActive: boolean;
}

export function InlineToolTiles({ steps, isTurnActive }: InlineToolTilesProps) {
  const allFinished =
    steps.length > 0 &&
    !isTurnActive &&
    steps.every((s) => s.status === 'finished' || s.status === 'error');

  const [isExpanded, setIsExpanded] = useState(!allFinished);
  const wasActiveRef = useRef(isTurnActive);

  useEffect(() => {
    if (isTurnActive) {
      setIsExpanded(true);
    } else if (wasActiveRef.current && allFinished) {
      setIsExpanded(false);
    }
    wasActiveRef.current = isTurnActive;
  }, [isTurnActive, allFinished]);

  if (!steps || steps.length === 0) return null;

  const hasError = steps.some((s) => s.status === 'error');
  const activeCount = steps.filter(
    (s) => s.status === 'started' || s.status === 'processing',
  ).length;

  return (
    <div className="mb-3">
      {allFinished ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#F8F7F8] hover:bg-[#FBF1F3] border border-[#E3DFE4] text-xs font-medium text-[#6E162B] hover:text-[#6E162B] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {hasError ? (
              <AlertCircle className="w-3.5 h-3.5 text-[#D97706]" />
            ) : (
              <Check className="w-3.5 h-3.5 text-[#16A34A]" />
            )}
            <span>
              {steps.length} tool{steps.length === 1 ? '' : 's'} · Done
            </span>
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-[#63565C]" />
            ) : (
              <ChevronRight className="w-3 h-3 text-[#63565C]" />
            )}
          </button>

          {isExpanded &&
            steps.map((step) => (
              <span
                key={step.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#F8F7F8] border border-[#E3DFE4] text-[11px] text-[#1F171B]"
              >
                {step.status === 'error' ? (
                  <AlertCircle className="w-3 h-3 text-[#D97706] shrink-0" />
                ) : (
                  <Check className="w-3 h-3 text-[#16A34A] shrink-0" />
                )}
                {(() => {
                  const ToolIcon = TOOL_ICONS[step.toolName];
                  return ToolIcon ? <ToolIcon className="w-3 h-3 text-[#A8203E] shrink-0" /> : null;
                })()}
                <span className="font-medium">{step.label}</span>
                {step.summary && (
                  <span className="text-[#63565C] font-mono-tabular">· {step.summary}</span>
                )}
              </span>
            ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {steps.map((step) => (
            <span
              key={step.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#F8F7F8] border border-[#E3DFE4] text-[11px] text-[#1F171B]"
            >
              {step.status === 'started' && (
                <Play className="w-3 h-3 text-[#63565C] shrink-0" />
              )}
              {step.status === 'processing' && (
                <Loader2 className="w-3 h-3 text-[#A8203E] animate-spin shrink-0" />
              )}
              {step.status === 'finished' && (
                <Check className="w-3 h-3 text-[#16A34A] shrink-0" />
              )}
              {step.status === 'error' && (
                <AlertCircle className="w-3 h-3 text-[#D97706] shrink-0" />
              )}
              {(() => {
                  const ToolIcon = TOOL_ICONS[step.toolName];
                  return ToolIcon ? <ToolIcon className="w-3 h-3 text-[#A8203E] shrink-0" /> : null;
                })()}
                <span className="font-medium">{step.label}</span>
              <span className="text-[#63565C]">
                {step.status === 'started'
                  ? 'Started'
                  : step.status === 'processing'
                    ? 'Processing'
                    : step.status === 'finished'
                      ? step.summary || 'Finished'
                      : step.summary || 'Failed'}
              </span>
            </span>
          ))}
          {activeCount > 0 && (
            <span className="sr-only">{activeCount} tools running</span>
          )}
        </div>
      )}
    </div>
  );
}
