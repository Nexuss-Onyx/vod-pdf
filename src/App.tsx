import { useCallback, useEffect, useRef, useState } from 'react';
import { AllFilesModal } from './components/AllFilesModal';
import { ChatPane } from './components/ChatPane';
import { DocxViewerPane } from './components/DocxViewerPane';
import { SessionSidebar } from './components/SessionSidebar';
import { TopBar } from './components/TopBar';
import type {
  AgentToolStep,
  ChatMessage,
  ChatSession,
  DocxAttachment,
  WorkspaceSnapshot,
} from './types/vod';

const SESSION_STORAGE_KEY = 'vod_word_active_session';

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [allFiles, setAllFiles] = useState<DocxAttachment[]>([]);

  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionFiles, setSessionFiles] = useState<DocxAttachment[]>([]);

  const [viewerFile, setViewerFile] = useState<DocxAttachment | null>(null);
  const [pendingFileAttachment, setPendingFileAttachment] = useState<DocxAttachment | null>(null);

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

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      session: ChatSession;
      messages: ChatMessage[];
      files: DocxAttachment[];
    };
    setMessages(data.messages);
    setSessionFiles(data.files);
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } catch {
      // Ignore storage failures
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    const res = await fetch('/api/workspace');
    if (!res.ok) return;
    const snap = (await res.json()) as WorkspaceSnapshot;
    setSessions(snap.sessions);
    setAllFiles(snap.files);

    const savedId = (() => {
      try {
        return localStorage.getItem(SESSION_STORAGE_KEY) || '';
      } catch {
        return '';
      }
    })();

    const currentId = activeSessionRef.current;
    const targetSession =
      snap.sessions.find((s) => s.id === currentId) ||
      snap.sessions.find((s) => s.id === savedId) ||
      snap.sessions[0];

    if (targetSession) {
      if (targetSession.id !== currentId) {
        setActiveSessionId(targetSession.id);
      }
      await loadSessionDetail(targetSession.id);
    }
    setIsInitializing(false);
  }, [loadSessionDetail]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('workspace_updated', () => {
      loadWorkspace();
    });
    return () => {
      es.close();
    };
  }, [loadWorkspace]);

  const handleNewChat = async () => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Chat' }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { session: ChatSession };
    setSessions((prev) => [data.session, ...prev]);
    setActiveSessionId(data.session.id);
    setMessages([]);
    setSessionFiles([]);
    setPendingFileAttachment(null);
    setViewerFile(null);
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, data.session.id);
    } catch {
      // Ignore storage errors
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setPendingFileAttachment(null);
    setIsSidebarOpen(false);
    await loadSessionDetail(sessionId);
  };

  const handleDeleteSession = async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return;
    const remaining = sessions.filter((s) => s.id !== sessionId);
    setSessions(remaining);
    if (activeSessionId === sessionId && remaining[0]) {
      setActiveSessionId(remaining[0].id);
      await loadSessionDetail(remaining[0].id);
    }
    if (viewerFile && viewerFile.sessionId === sessionId) {
      setViewerFile(null);
    }
  };

  const streamChatRequest = async (bodyPayload: Record<string, unknown>) => {
    setIsStreaming(true);
    setLiveThoughtText('');
    setLiveSteps([]);
    setLiveText('');

    try {
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
            setMessages((prev) => [...prev, payload as ChatMessage]);
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
            setMessages((prev) => [...prev, assistantMsg]);
            if (assistantMsg.attachments && assistantMsg.attachments.length > 0) {
              setViewerFile(assistantMsg.attachments[assistantMsg.attachments.length - 1]);
            }
            await loadWorkspace();
          } else if (eventType === 'error') {
            if (payload.message) {
              setMessages((prev) => [...prev, payload.message as ChatMessage]);
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Streaming connection failed.';
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sessionId: activeSessionId,
          role: 'assistant',
          content: `Unable to complete the request: ${msg}`,
          createdAt: new Date().toISOString(),
          error: msg,
        },
      ]);
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
    setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId));
    await streamChatRequest({
      sessionId: activeSessionId,
      regenerateAssistantId: assistantMessageId,
    });
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#FAF9F6] text-neutral-900">
      <TopBar
        onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
        onNewChat={handleNewChat}
      />

      <main className="flex-1 flex min-h-0 overflow-hidden">
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
            onClearPendingFile={() => setPendingFileAttachment(null)}
            onSelectPendingFile={(file) => setPendingFileAttachment(file)}
            onAttachUploadedFile={(file) => {
              setPendingFileAttachment(file);
              setSessionFiles((prev) => [file, ...prev]);
              setAllFiles((prev) => [file, ...prev]);
            }}
            onSendMessage={handleSendMessage}
            onRegenerateMessage={handleRegenerateMessage}
            onOpenFile={(file) => setViewerFile(file)}
            onViewAllFiles={() => setIsAllFilesOpen(true)}
          />

          {viewerFile && (
            <DocxViewerPane
              file={viewerFile}
              onClose={() => setViewerFile(null)}
              onAskToEdit={(file) => {
                setPendingFileAttachment(file);
                document.getElementById('vod-chat-input')?.focus();
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
