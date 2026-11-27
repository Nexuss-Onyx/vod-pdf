import { Menu, Plus } from 'lucide-react';
import { VodLogo } from './VodBrandMarks';

interface TopBarProps {
  onToggleSidebar: () => void;
  onNewChat: () => void;
}

export function TopBar({ onToggleSidebar, onNewChat }: TopBarProps) {
  return (
    <header className="relative h-14 border-b border-[#E3DFE4] bg-white px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 shrink-0">
      {/* Vod PDF Top Accent Hairline: Sovereign Garnet -> Venetian Carmine -> Rose Highlight */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2.5px] bg-gradient-to-r from-[#6E162B] via-[#A8203E] to-[#D98294]"
      />

      {/* Left: Chat History Drawer Toggle */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle chat history"
        className="w-9 h-9 rounded-lg border border-[#E3DFE4] bg-white hover:bg-[#F1EFF2] hover:border-[#CFC8D0] text-[#6E162B] flex items-center justify-center transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-[#6E162B]"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Center: Vod PDF Brand Lockup */}
      <div className="flex items-center gap-2 sm:gap-2.5 whitespace-nowrap shrink-0">
        <VodLogo className="w-6 h-6 sm:w-7 sm:h-7 shrink-0" />
        <div className="flex items-center gap-1 font-display text-[15px] tracking-tight">
          <span className="font-bold text-[#1F171B]">Vod</span>
          <span className="font-bold text-[#A8203E]">PDF</span>
        </div>
      </div>

      {/* Right: Primary New Chat CTA in Sovereign Garnet */}
      <button
        type="button"
        onClick={onNewChat}
        className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs font-medium text-white bg-[#6E162B] hover:bg-[#851D35] rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6E162B]"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>New Chat</span>
      </button>
    </header>
  );
}
