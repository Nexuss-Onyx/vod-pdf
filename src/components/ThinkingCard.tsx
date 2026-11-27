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
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#F8F7F8] hover:bg-[#FBF1F3] border border-[#E3DFE4] text-xs font-medium text-[#6E162B] hover:text-[#6E162B] transition-colors cursor-pointer whitespace-nowrap"
      >
        <Brain className="w-3.5 h-3.5 text-[#A8203E]" />
        <span>{isStreaming ? 'Thinking...' : 'Thought process'}</span>
        {isOpen ? (
          <ChevronDown className="w-3 h-3 text-[#63565C]" />
        ) : (
          <ChevronRight className="w-3 h-3 text-[#63565C]" />
        )}
      </button>

      {isOpen && (
        <div
          ref={scrollRef}
          className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-[#E3DFE4] bg-[#F8F7F8] px-3.5 py-2.5 text-xs leading-relaxed text-[#63565C] font-mono-tabular whitespace-pre-wrap"
        >
          {thoughtText}
        </div>
      )}
    </div>
  );
}
