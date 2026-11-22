import { Menu, Plus } from 'lucide-react';
import { VodLogo } from './VodBrandMarks';

interface TopBarProps {
  onToggleSidebar: () => void;
  onNewChat: () => void;
}

export function TopBar({ onToggleSidebar, onNewChat }: TopBarProps) {
  return (
    <header className="relative h-14 border-b border-[#D9E1EF] bg-white px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
      {/* Dual-Brand Top Accent Hairline: Vod Plum -> PDF Amethyst -> Soft Lilac */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2.5px] bg-gradient-to-r from-[#2E2252] via-[#4A3680] to-[#B9A9DC]"
      />

      {/* Left: Chat History Drawer Toggle */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle chat history"
        className="w-9 h-9 rounded-lg border border-[#D9E1EF] bg-white hover:bg-[#ECEFF7] hover:border-[#C3CFE4] text-[#2E2252] flex items-center justify-center transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-[#2E2252]"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Center: Abstract Vod Logo + PDF app lockup */}
      <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
        <VodLogo className="w-7 h-7 shrink-0" />
        <div className="flex items-center gap-1.5">
          <span className="font-display text-[15px] font-bold tracking-tight text-[#2E2252]">
            Vod
          </span>
          <span aria-hidden="true" className="text-[#C3CFE4] font-normal">
            /
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-[#4A3680]">
            PDF
          </span>
        </div>
      </div>

      {/* Right: Primary New Chat CTA in Vod Sovereign Plum */}
      <button
        type="button"
        onClick={onNewChat}
        className="px-4 py-2 text-xs font-medium text-white bg-[#2E2252] hover:bg-[#3E2E6E] rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E2252]"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>New Chat</span>
      </button>
    </header>
  );
}
