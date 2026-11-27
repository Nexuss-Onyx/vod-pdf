import { AlertCircle, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { AgentToolStep } from '../types/vod';

interface TurnDetailsDisclosureProps {
  thoughtText?: string;
  toolSteps?: AgentToolStep[];
}

export function TurnDetailsDisclosure({ thoughtText, toolSteps }: TurnDetailsDisclosureProps) {
  const [isOpen, setIsOpen] = useState(false);

  const steps = toolSteps ?? [];
  const hasThought = Boolean(thoughtText && thoughtText.trim().length > 0);
  if (!hasThought && steps.length === 0) return null;

  const hasError = steps.some((s) => s.status === 'error');
  const summaryLabel =
    steps.length > 0
      ? `${steps.length} step${steps.length === 1 ? '' : 's'} completed`
      : 'Details';

  return (
    <div className="mb-2.5">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#63565C] hover:text-[#6E162B] transition-colors cursor-pointer"
      >
        {hasError ? (
          <AlertCircle className="w-3.5 h-3.5 text-[#D97706] shrink-0" />
        ) : (
          <Check className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
        )}
        <span>{summaryLabel}</span>
        {isOpen ? (
          <ChevronDown className="w-3 h-3 text-[#8F848A]" />
        ) : (
          <ChevronRight className="w-3 h-3 text-[#8F848A]" />
        )}
      </button>

      {isOpen && (
        <div className="mt-2 rounded-lg border border-[#E3DFE4] bg-[#F8F7F8] p-3 space-y-2.5 text-xs">
          {steps.length > 0 && (
            <div className="space-y-1.5">
              {steps.map((step) => (
                <div key={step.id} className="flex items-center gap-2 text-[#1F171B]">
                  {step.status === 'error' ? (
                    <AlertCircle className="w-3.5 h-3.5 text-[#D97706] shrink-0" />
                  ) : (
                    <Check className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                  )}
                  <span className="font-medium">{step.label}</span>
                  {step.summary && (
                    <span className="text-[#63565C] font-mono-tabular">· {step.summary}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {hasThought && (
            <div className={steps.length > 0 ? 'pt-2 border-t border-[#E3DFE4]' : ''}>
              <div className="text-[11px] font-medium text-[#63565C] mb-1">Reasoning</div>
              <div className="max-h-40 overflow-y-auto text-[11.5px] leading-relaxed text-[#63565C] whitespace-pre-wrap">
                {thoughtText}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
