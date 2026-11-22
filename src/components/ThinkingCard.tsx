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
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#F4F6FB] hover:bg-[#E8F0FC] border border-[#D9E1EF] text-xs font-medium text-[#2E2252] hover:text-[#103F91] transition-colors cursor-pointer whitespace-nowrap"
      >
        <Brain className="w-3.5 h-3.5 text-[#185ABD]" />
        <span>{isStreaming ? 'Thinking...' : 'Thought process'}</span>
        {isOpen ? (
          <ChevronDown className="w-3 h-3 text-[#585470]" />
        ) : (
          <ChevronRight className="w-3 h-3 text-[#585470]" />
        )}
      </button>

      {isOpen && (
        <div
          ref={scrollRef}
          className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-[#D9E1EF] bg-[#F4F6FB] px-3.5 py-2.5 text-xs leading-relaxed text-[#585470] font-mono-tabular whitespace-pre-wrap"
        >
          {thoughtText}
        </div>
      )}
    </div>
  );
}
