import { Menu, Plus } from 'lucide-react';

interface TopBarProps {
  onToggleSidebar: () => void;
  onNewChat: () => void;
}

export function TopBar({ onToggleSidebar, onNewChat }: TopBarProps) {
  return (
    <header className="h-14 border-b border-[#E7E4DC] bg-[#FAF9F6] px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
      {/* Left: Sidebar toggle matching reference [≡] button */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle chat history"
        className="w-9 h-9 rounded-lg border border-[#E2DFD7] bg-white hover:bg-[#F3F1EC] text-neutral-700 flex items-center justify-center transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-neutral-900"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Center: Clean Brand Wordmark */}
      <div className="font-display text-base font-bold tracking-tight text-neutral-900 whitespace-nowrap shrink-0">
        Vod Word
      </div>

      {/* Right: Primary New Chat action */}
      <button
        type="button"
        onClick={onNewChat}
        className="px-4 py-2 text-xs font-medium text-white bg-[#191919] hover:bg-[#333333] rounded-xl transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>New Chat</span>
      </button>
    </header>
  );
}
