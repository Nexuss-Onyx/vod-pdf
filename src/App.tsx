import { useCallback, useEffect, useRef, useState } from 'react';
import { AllFilesModal } from './components/AllFilesModal';
import { ChatPane } from './components/ChatPane';
import { PdfViewerPane } from './components/PdfViewerPane';
import { SessionSidebar } from './components/SessionSidebar';
import { TopBar } from './components/TopBar';
import type {
  AgentToolStep,
  ChatMessage,
  ChatSession,
  PdfAttachment,
  WorkspaceSnapshot,
} from './types/vod';
import {
  createClientSessionId,
  deleteLocalSessionData,
  flushPendingSyncOps,
  loadLocalMeta,
  loadLocalSessionMessages,
  loadPendingSyncOps,
  prefetchFileToLocalCache,
  recordSyncOp,
  saveLocalMeta,
  saveLocalSessionMessages,
} from './utils/localWorkspaceDb';
import { mergeSessionMessages, mergeWorkspaceSnapshots } from './utils/syncMerge';

const SESSION_STORAGE_KEY = 'vod_pdf_active_session';

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [allFiles, setAllFiles] = useState<PdfAttachment[]>([]);

  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionFiles, setSessionFiles] = useState<PdfAttachment[]>([]);

  const [viewerFile, setViewerFile] = useState<PdfAttachment | null>(null);
  const [pendingFileAttachment, setPendingFileAttachment] = useState<PdfAttachment | null>(null);
  const [composerPrefill, setComposerPrefill] = useState<{ text: string; key: number } | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAllFilesOpen, setIsAllFilesOpen] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Real-time SSE streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveThoughtText, setLiveThoughtText] = useState('');
  const [liveSteps, setLiveSteps] = useState<AgentToolStep[]>([]);
  const [liveText, setLiveText] = useState('');

  const activeSessionRef = useRef(activeSessionId);
  activeSessionRef.current = activeSessionId;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const allFilesRef = useRef(allFiles);
  allFilesRef.current = allFiles;

  const syncSessionDetailFromCloud = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        session: ChatSession;
        messages: ChatMessage[];
        files: PdfAttachment[];
      };

      const localMsgs = (await loadLocalSessionMessages(sessionId)) || [];
      const merged = mergeSessionMessages(localMsgs, data.messages);
      await saveLocalSessionMessages(sessionId, merged);

      if (activeSessionRef.current === sessionId) {
        setMessages(merged);
        setSessionFiles(data.files);
      }

      // Warm local blob cache in background for recent session attachments
      for (const f of data.files.slice(0, 3)) {
        void prefetchFileToLocalCache(f.id);
      }
    } catch {
      // Offline / transient network errors keep local-first data intact
    }
  }, []);

  const loadSessionLocalFirst = useCallback(
    async (sessionId: string, filesSource?: PdfAttachment[]) => {
      if (!sessionId) return;
      const localMsgs = await loadLocalSessionMessages(sessionId);
      const sourceFiles = filesSource ?? allFilesRef.current;
      const localFiles = sourceFiles.filter((f) => f.sessionId === sessionId);
      if (localMsgs !== null) {
        setMessages(localMsgs);
        setSessionFiles(localFiles);
      }
      try {
        localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      } catch {
        // Ignore storage failures
      }
      void syncSessionDetailFromCloud(sessionId);
    },
    [syncSessionDetailFromCloud],
  );

  const syncWorkspaceWithCloud = useCallback(async () => {
    try {
      await flushPendingSyncOps();
      const res = await fetch('/api/workspace');
      if (!res.ok) return;
      const serverSnap = (await res.json()) as WorkspaceSnapshot;
      const pendingOps = await loadPendingSyncOps();
      const localMeta = await loadLocalMeta();
      const localSnap: WorkspaceSnapshot = {
        sessions: localMeta?.sessions ?? sessionsRef.current,
        files: localMeta?.files ?? allFilesRef.current,
      };
      const mergedSnap = mergeWorkspaceSnapshots(localSnap, serverSnap, pendingOps);

      setSessions(mergedSnap.sessions);
      setAllFiles(mergedSnap.files);

      const savedId = (() => {
        try {
          return localStorage.getItem(SESSION_STORAGE_KEY) || localMeta?.activeSessionId || '';
        } catch {
          return localMeta?.activeSessionId || '';
        }
      })();

      const currentId = activeSessionRef.current;
      const targetSession =
        mergedSnap.sessions.find((s) => s.id === currentId) ||
        mergedSnap.sessions.find((s) => s.id === savedId) ||
        mergedSnap.sessions[0];

      await saveLocalMeta({
        sessions: mergedSnap.sessions,
        files: mergedSnap.files,
        activeSessionId: targetSession?.id || currentId,
      });

      if (targetSession) {
        if (targetSession.id !== currentId) {
          setActiveSessionId(targetSession.id);
        }
        await syncSessionDetailFromCloud(targetSession.id);
      }
    } catch {
      // Offline / transient network errors keep local-first state active
    } finally {
      setIsInitializing(false);
    }
  }, [syncSessionDetailFromCloud]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Instant local-first paint from IndexedDB on disk
      const localMeta = await loadLocalMeta();
      if (!cancelled && localMeta && localMeta.sessions.length > 0) {
        setSessions(localMeta.sessions);
        setAllFiles(localMeta.files);

        const savedId = (() => {
          try {
            return localStorage.getItem(SESSION_STORAGE_KEY) || localMeta.activeSessionId || '';
          } catch {
            return localMeta.activeSessionId || '';
          }
        })();

        const target =
          localMeta.sessions.find((s) => s.id === savedId) || localMeta.sessions[0];

        if (target) {
          setActiveSessionId(target.id);
          const localMsgs = await loadLocalSessionMessages(target.id);
          if (!cancelled && localMsgs) {
            setMessages(localMsgs);
            setSessionFiles(localMeta.files.filter((f) => f.sessionId === target.id));
          }
        }
        setIsInitializing(false);
      }

      // 2. Background cloud sync
      if (!cancelled) {
        await syncWorkspaceWithCloud();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [syncWorkspaceWithCloud]);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { mode?: string };
        if (data.mode === 'serverless') {
          es.close();
        }
      } catch {
        // Ignore non-JSON connected payloads
      }
    });
    es.addEventListener('workspace_updated', () => {
      void syncWorkspaceWithCloud();
    });
    const onOnline = () => {
      void syncWorkspaceWithCloud();
    };
    window.addEventListener('online', onOnline);
    return () => {
      es.close();
      window.removeEventListener('online', onOnline);
    };
  }, [syncWorkspaceWithCloud]);

  const handleNewChat = async () => {
    const now = new Date().toISOString();
    const newSession: ChatSession = {
      id: createClientSessionId(),
      title: 'New Chat',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      fileCount: 0,
    };

    const nextSessions = [newSession, ...sessionsRef.current];
    setSessions(nextSessions);
    setActiveSessionId(newSession.id);
    setMessages([]);
    setSessionFiles([]);
    setPendingFileAttachment(null);
    setViewerFile(null);

    try {
      localStorage.setItem(SESSION_STORAGE_KEY, newSession.id);
    } catch {
      // Ignore storage errors
    }

    // Persist locally first (0ms UI) and sync in background
    await Promise.all([
      saveLocalMeta({
        sessions: nextSessions,
        files: allFilesRef.current,
        activeSessionId: newSession.id,
      }),
      saveLocalSessionMessages(newSession.id, []),
      recordSyncOp({
        type: 'create_session',
        sessionId: newSession.id,
        title: newSession.title,
        createdAt: now,
      }),
    ]);
    void flushPendingSyncOps();
  };

  const handleSelectSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setPendingFileAttachment(null);
    setIsSidebarOpen(false);
    void saveLocalMeta({
      sessions: sessionsRef.current,
      files: allFilesRef.current,
      activeSessionId: sessionId,
    });
    await loadSessionLocalFirst(sessionId);
  };

  const handleDeleteSession = async (sessionId: string) => {
    const remaining = sessionsRef.current.filter((s) => s.id !== sessionId);
    const removedFileIds = allFilesRef.current
      .filter((f) => f.sessionId === sessionId)
      .map((f) => f.id);
    const nextFiles = allFilesRef.current.filter((f) => f.sessionId !== sessionId);

    setSessions(remaining);
    setAllFiles(nextFiles);

    const nextActiveId =
      activeSessionId === sessionId ? (remaining[0]?.id ?? '') : activeSessionId;
    if (activeSessionId === sessionId) {
      setActiveSessionId(nextActiveId);
      if (nextActiveId) {
        await loadSessionLocalFirst(nextActiveId, nextFiles);
      } else {
        setMessages([]);
        setSessionFiles([]);
      }
    }
    if (viewerFile && viewerFile.sessionId === sessionId) {
      setViewerFile(null);
    }

    await Promise.all([
      saveLocalMeta({
        sessions: remaining,
        files: nextFiles,
        activeSessionId: nextActiveId,
      }),
      deleteLocalSessionData(sessionId, removedFileIds),
      recordSyncOp({
        type: 'delete_session',
        sessionId,
        createdAt: new Date().toISOString(),
      }),
    ]);
    void flushPendingSyncOps();
  };

  const streamChatRequest = async (bodyPayload: Record<string, unknown>) => {
    const targetSessionId = String(bodyPayload.sessionId || activeSessionRef.current);
    setIsStreaming(true);
    setLiveThoughtText('');
    setLiveSteps([]);
    setLiveText('');

    try {
      // Ensure session exists on server before streaming if created optimistically offline
      await flushPendingSyncOps();

      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });

      if (!response.ok || !response.body) {
        const errText = await response.text();
        throw new Error(errText || 'Chat stream failed.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const lines = frame.split('\n');
          let eventType = 'message';
          let dataLine = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataLine = line.slice(6);
            }
          }
          if (!dataLine) continue;

          const payload = JSON.parse(dataLine);
          if (eventType === 'user_message') {
            const userMsg = payload as ChatMessage;
            setMessages((prev) => {
              const next = [...prev, userMsg];
              void saveLocalSessionMessages(targetSessionId, next);
              return next;
            });
          } else if (eventType === 'thought_delta') {
            setLiveThoughtText((prev) => prev + String(payload.delta || ''));
          } else if (eventType === 'tool_update') {
            const step = payload as AgentToolStep;
            setLiveSteps((prev) => {
              const exists = prev.some((s) => s.id === step.id);
              return exists ? prev.map((s) => (s.id === step.id ? step : s)) : [...prev, step];
            });
          } else if (eventType === 'text_delta') {
            setLiveText((prev) => prev + String(payload.delta || ''));
          } else if (eventType === 'done') {
            const assistantMsg = payload.message as ChatMessage;
            setMessages((prev) => {
              const next = [...prev, assistantMsg];
              void saveLocalSessionMessages(targetSessionId, next);
              return next;
            });
            if (assistantMsg.attachments && assistantMsg.attachments.length > 0) {
              const latest = assistantMsg.attachments[assistantMsg.attachments.length - 1];
              setViewerFile(latest);
              for (const att of assistantMsg.attachments) {
                void prefetchFileToLocalCache(att.id);
              }
            }
            void syncWorkspaceWithCloud();
          } else if (eventType === 'error') {
            if (payload.message) {
              const errMsg = payload.message as ChatMessage;
              setMessages((prev) => {
                const next = [...prev, errMsg];
                void saveLocalSessionMessages(targetSessionId, next);
                return next;
              });
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Streaming connection failed.';
      setMessages((prev) => {
        const next = [
          ...prev,
          {
            id: `err_${Date.now()}`,
            sessionId: targetSessionId,
            role: 'assistant' as const,
            content: `Unable to complete the request: ${msg}`,
            createdAt: new Date().toISOString(),
            error: msg,
          },
        ];
        void saveLocalSessionMessages(targetSessionId, next);
        return next;
      });
    } finally {
      setIsStreaming(false);
      setLiveThoughtText('');
      setLiveSteps([]);
      setLiveText('');
    }
  };

  const handleSendMessage = async (prompt: string) => {
    if (!activeSessionId || isStreaming) return;
    const attachedId = pendingFileAttachment?.id;
    setPendingFileAttachment(null);
    await streamChatRequest({
      sessionId: activeSessionId,
      prompt,
      attachedFileId: attachedId,
    });
  };

  const handleRegenerateMessage = async (assistantMessageId: string) => {
    if (!activeSessionId || isStreaming) return;
    setMessages((prev) => {
      const next = prev.filter((m) => m.id !== assistantMessageId);
      void saveLocalSessionMessages(activeSessionId, next);
      return next;
    });
    await streamChatRequest({
      sessionId: activeSessionId,
      regenerateAssistantId: assistantMessageId,
    });
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div
      data-vod-app="pdf"
      className="h-[100dvh] w-full overflow-hidden flex flex-col bg-[#F8F7F8] text-[#1F171B]"
    >
      <TopBar
        onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
        onNewChat={handleNewChat}
      />

      <main className="flex-1 flex min-h-0 overflow-hidden relative">
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          isLoading={isInitializing}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
        />

        <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
          <div
            className={`${
              viewerFile ? 'hidden lg:flex' : 'flex'
            } flex-1 min-w-0 min-h-0 overflow-hidden`}
          >
            <ChatPane
              sessionId={activeSessionId}
              messages={messages}
              allFiles={allFiles}
              activeFileId={viewerFile?.id ?? null}
              isStreaming={isStreaming}
              liveThoughtText={liveThoughtText}
              liveSteps={liveSteps}
              liveText={liveText}
              pendingFileAttachment={pendingFileAttachment}
              composerPrefill={composerPrefill}
              onClearPendingFile={() => setPendingFileAttachment(null)}
              onSelectPendingFile={(file) => setPendingFileAttachment(file)}
              onAttachUploadedFile={(file) => {
                setPendingFileAttachment(file);
                const nextSessionFiles = [file, ...sessionFiles];
                const nextAllFiles = [file, ...allFiles];
                setSessionFiles(nextSessionFiles);
                setAllFiles(nextAllFiles);
                void saveLocalMeta({
                  sessions: sessionsRef.current,
                  files: nextAllFiles,
                  activeSessionId,
                });
              }}
              onSendMessage={handleSendMessage}
              onRegenerateMessage={handleRegenerateMessage}
              onOpenFile={(file) => setViewerFile(file)}
              onViewAllFiles={() => setIsAllFilesOpen(true)}
            />
          </div>

          {viewerFile && (
            <PdfViewerPane
              file={viewerFile}
              onClose={() => setViewerFile(null)}
              onAskToEdit={(file, prefillPrompt) => {
                setPendingFileAttachment(file);
                if (prefillPrompt) {
                  setComposerPrefill({ text: prefillPrompt, key: Date.now() });
                }
                if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                  setViewerFile(null);
                }
                setTimeout(() => document.getElementById('vod-chat-input')?.focus(), 0);
              }}
            />
          )}
        </div>
      </main>

      <AllFilesModal
        isOpen={isAllFilesOpen}
        title={`Files in "${activeSession?.title || 'Current Task'}"`}
        files={sessionFiles.length > 0 ? sessionFiles : allFiles}
        onClose={() => setIsAllFilesOpen(false)}
        onOpenFile={(file) => setViewerFile(file)}
      />
    </div>
  );
}
