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
        className="fixed inset-0 bg-[#2E2252]/30 z-30 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        aria-label="Chat History"
        className="fixed lg:static inset-y-0 left-0 z-40 w-72 border-r border-[#D9E1EF] bg-[#ECEFF7] flex flex-col shrink-0"
      >
        <div className="p-3.5 border-b border-[#D9E1EF] flex items-center gap-2 bg-[#F4F6FB]">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-[#585470] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <label htmlFor="session-search" className="sr-only">
              Search chats
            </label>
            <input
              id="session-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-[#D9E1EF] rounded-lg text-[#1E1935] placeholder:text-[#706B88] focus:outline-none focus:border-[#185ABD]"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat history"
            className="p-1.5 rounded-lg text-[#585470] hover:text-[#2E2252] hover:bg-[#D9E1EF]/60 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-1">
          {isLoading ? (
            <div className="space-y-2 px-1 py-2">
              <div className="h-11 rounded-lg bg-[#D9E1EF]/60 animate-pulse" />
              <div className="h-11 rounded-lg bg-[#D9E1EF]/60 animate-pulse" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[#585470]">
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
                      ? 'bg-white border border-[#C7D8F4] shadow-[0_1px_2px_rgba(46,34,82,0.06)]'
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
                          isActive ? 'text-[#185ABD]' : 'text-[#585470]'
                        }`}
                      />
                      <span
                        className={`text-[13px] font-medium truncate ${
                          isActive ? 'text-[#2E2252]' : 'text-[#3B3458]'
                        }`}
                      >
                        {session.title}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-5.5 text-[11px] text-[#585470] font-mono-tabular truncate">
                      {formatShortTime(session.updatedAt)} · {session.fileCount} docx
                    </div>
                  </button>

                  {sessions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteSession(session.id)}
                      aria-label={`Delete chat ${session.title}`}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-md text-[#585470] hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer shrink-0"
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
