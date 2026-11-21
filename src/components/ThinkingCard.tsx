import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ThinkingCardProps {
  thoughtText: string;
  isStreaming: boolean;
}

export function ThinkingCard({ thoughtText, isStreaming }: ThinkingCardProps) {
  const [isOpen, setIsOpen] = useState(isStreaming);
  const prevStreamingRef = useRef(isStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-open while thinking streams; auto-collapse as soon as streaming finishes
    if (isStreaming && !prevStreamingRef.current) {
      setIsOpen(true);
    } else if (!isStreaming && prevStreamingRef.current) {
      setIsOpen(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (isOpen && isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thoughtText, isOpen, isStreaming]);

  if (!thoughtText) return null;

  return (
    <div className="mb-2.5">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/80 hover:bg-white border border-[#E2DFD7] text-xs font-medium text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
      >
        <Brain className="w-3.5 h-3.5 text-neutral-500" />
        <span>{isStreaming ? 'Thinking...' : 'Thought process'}</span>
        {isOpen ? (
          <ChevronDown className="w-3 h-3 text-neutral-400" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neutral-400" />
        )}
      </button>

      {isOpen && (
        <div
          ref={scrollRef}
          className="mt-1.5 max-h-48 overflow-y-auto rounded-xl border border-[#E2DFD7] bg-white/75 px-3.5 py-2.5 text-xs leading-relaxed text-neutral-600 font-mono-tabular whitespace-pre-wrap"
        >
          {thoughtText}
        </div>
      )}
    </div>
  );
}
