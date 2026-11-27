import { MessageSquare, Search, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { ChatSession } from '../types/vod';
import { formatShortTime } from '../utils/format';

interface SessionSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  isLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  isLoading,
  isOpen,
  onClose,
  onSelectSession,
  onDeleteSession,
}: SessionSidebarProps) {
  const [query, setQuery] = useState('');

  if (!isOpen) return null;

  const filtered = sessions.filter((s) =>
    s.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <div
        className="fixed inset-0 bg-[#6E162B]/25 z-30 xl:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        aria-label="Chat History"
        className="fixed xl:static inset-y-0 left-0 z-40 w-[min(85vw,18rem)] border-r border-[#E3DFE4] bg-[#F1EFF2] flex flex-col shrink-0 shadow-xl xl:shadow-none"
      >
        <div className="p-3.5 border-b border-[#E3DFE4] flex items-center gap-2 bg-[#F8F7F8]">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-[#63565C] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <label htmlFor="session-search" className="sr-only">
              Search chats
            </label>
            <input
              id="session-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-[#E3DFE4] rounded-lg text-[#1F171B] placeholder:text-[#7D6E75] focus:outline-none focus:border-[#A8203E]"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat history"
            className="p-1.5 rounded-lg text-[#63565C] hover:text-[#6E162B] hover:bg-[#E3DFE4]/60 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-1">
          {isLoading ? (
            <div className="space-y-2 px-1 py-2">
              <div className="h-11 rounded-lg bg-[#E3DFE4]/60 animate-pulse" />
              <div className="h-11 rounded-lg bg-[#E3DFE4]/60 animate-pulse" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[#63565C]">
              No chats found.
            </div>
          ) : (
            filtered.map((session) => {
              const isActive = session.id === activeSessionId;
              return (
                <div
                  key={session.id}
                  className={`group flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                    isActive
                      ? 'bg-white border border-[#EBCBD2] shadow-[0_1px_2px_rgba(110,22,43,0.06)]'
                      : 'border border-transparent hover:bg-white/65'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isActive ? 'text-[#A8203E]' : 'text-[#63565C]'
                        }`}
                      />
                      <span
                        className={`text-[13px] font-medium truncate ${
                          isActive ? 'text-[#6E162B]' : 'text-[#3D2E35]'
                        }`}
                      >
                        {session.title}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-5.5 text-[11px] text-[#63565C] font-mono-tabular truncate">
                      {formatShortTime(session.updatedAt)} · {session.fileCount} PDF
                    </div>
                  </button>

                  {sessions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteSession(session.id)}
                      aria-label={`Delete chat ${session.title}`}
                      className="opacity-70 xl:opacity-0 xl:group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-md text-[#63565C] hover:text-amber-700 hover:bg-amber-50 transition-all cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
