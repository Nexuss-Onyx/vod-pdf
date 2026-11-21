import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AgentToolStep } from '../types/vod';

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
    <div className="mb-2.5">
      {allFinished ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/80 hover:bg-white border border-[#E2DFD7] text-xs font-medium text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
          >
            {hasError ? (
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            ) : (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            )}
            <span>
              {steps.length} tool{steps.length === 1 ? '' : 's'} · Done
            </span>
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-neutral-400" />
            ) : (
              <ChevronRight className="w-3 h-3 text-neutral-400" />
            )}
          </button>

          {isExpanded &&
            steps.map((step) => (
              <span
                key={step.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-[#E2DFD7] text-[11px] text-neutral-700"
              >
                {step.status === 'error' ? (
                  <AlertCircle className="w-3 h-3 text-red-600 shrink-0" />
                ) : (
                  <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                )}
                <span className="font-medium">{step.label}</span>
                {step.summary && (
                  <span className="text-neutral-500 font-mono-tabular">· {step.summary}</span>
                )}
              </span>
            ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {steps.map((step) => (
            <span
              key={step.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-[#E2DFD7] text-[11px] text-neutral-800"
            >
              {step.status === 'started' && (
                <Play className="w-3 h-3 text-neutral-500 shrink-0" />
              )}
              {step.status === 'processing' && (
                <Loader2 className="w-3 h-3 text-[#1A73E8] animate-spin shrink-0" />
              )}
              {step.status === 'finished' && (
                <Check className="w-3 h-3 text-emerald-600 shrink-0" />
              )}
              {step.status === 'error' && (
                <AlertCircle className="w-3 h-3 text-red-600 shrink-0" />
              )}
              <span className="font-medium">{step.label}</span>
              <span className="text-neutral-400">
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
