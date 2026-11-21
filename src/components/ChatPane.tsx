import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FilePlus2,
  FileText,
  Loader2,
  Paperclip,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AgentToolStep,
  ChatMessage,
  DocxAttachment,
} from '../types/vod';
import { formatBytes, formatClockTime, readFileAsBase64 } from '../utils/format';
import { AttachmentPopover } from './AttachmentPopover';
import { DocxAttachmentRow } from './DocxAttachmentCard';
import { InlineToolTiles } from './InlineToolTiles';
import { ThinkingCard } from './ThinkingCard';

interface ChatPaneProps {
  sessionId: string;
  messages: ChatMessage[];
  allFiles: DocxAttachment[];
  activeFileId: string | null;
  isStreaming: boolean;
  liveThoughtText: string;
  liveSteps: AgentToolStep[];
  liveText: string;
  pendingFileAttachment: DocxAttachment | null;
  onClearPendingFile: () => void;
  onSelectPendingFile: (file: DocxAttachment) => void;
  onAttachUploadedFile: (file: DocxAttachment) => void;
  onSendMessage: (prompt: string) => void;
  onRegenerateMessage: (assistantMessageId: string) => void;
  onOpenFile: (file: DocxAttachment) => void;
  onViewAllFiles: () => void;
}

const STARTER_PROMPTS = [
  {
    title: 'Executive Operations Memo',
    prompt:
      'Create an executive Operations & Staffing Readiness Memo (.docx) with a summary callout, regional shift table, and priority action items.',
  },
  {
    title: 'Vendor MSA & Redline',
    prompt:
      'Draft a SaaS Vendor Master Services Agreement (.docx) covering SLA uptime, Net 30 payment terms, and liability caps, and add a review comment on the indemnity clause.',
  },
  {
    title: 'Project Kickoff Brief',
    prompt:
      'Build a structured Q1 Product Launch Brief (.docx) with cover page, milestones table, stakeholder roles, and risk matrix.',
  },
  {
    title: 'Standard Operating Procedure',
    prompt:
      'Generate an Incident Escalation SOP (.docx) with severity tiers table, numbered response steps, and audit checklist.',
  },
];

export function ChatPane({
  sessionId,
  messages,
  allFiles,
  activeFileId,
  isStreaming,
  liveThoughtText,
  liveSteps,
  liveText,
  pendingFileAttachment,
  onClearPendingFile,
  onSelectPendingFile,
  onAttachUploadedFile,
  onSendMessage,
  onRegenerateMessage,
  onOpenFile,
  onViewAllFiles,
}: ChatPaneProps) {
  const [input, setInput] = useState('');
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = (smooth = true) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  useEffect(() => {
    scrollToBottom(false);
  }, [sessionId]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 260) {
      scrollToBottom(true);
    }
  }, [messages.length, liveText, liveThoughtText, liveSteps.length]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBottom(distanceFromBottom > 140);
  };

  const handleSubmit = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    onSendMessage(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1500);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setUploadError('Please select a valid .docx Word document.');
      return;
    }

    setIsUploading(true);
    try {
      const base64Data = await readFileAsBase64(file);
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          filename: file.name,
          base64Data,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed.');
      }
      onAttachUploadedFile(data.file);
      setIsAttachmentMenuOpen(false);
      textareaRef.current?.focus();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload .docx file.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <section
      aria-label="Vod Word Chat"
      className="flex-1 flex flex-col min-w-0 bg-[#FAF9F6] relative"
    >
      {/* Message Viewport */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-6"
      >
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && !isStreaming && (
            <div className="py-10">
              <h1 className="font-display text-2xl font-bold text-neutral-900 tracking-tight text-balance">
                What Word document can I create or edit?
              </h1>
              <p className="mt-1.5 text-sm text-neutral-500">
                Draft reports, redline agreements, add review comments, or upload a .docx to inspect.
              </p>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {STARTER_PROMPTS.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => onSendMessage(item.prompt)}
                    className="p-4 rounded-2xl border border-[#E5E2DA] bg-white hover:bg-[#F5F3EE] text-left transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                      <FilePlus2 className="w-4 h-4 text-[#1A73E8] shrink-0" />
                      <span>{item.title}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-neutral-500 leading-relaxed line-clamp-2">
                      {item.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex flex-col items-end">
                  <div className="max-w-xl rounded-2xl border border-[#E5E2DA] bg-white px-4 py-3 text-[15px] leading-relaxed text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {msg.attachments.map((att) => (
                          <button
                            key={att.id}
                            type="button"
                            onClick={() => onOpenFile(att)}
                            className="inline-flex items-center gap-2 rounded-xl bg-[#FAF9F6] border border-[#E2DFD7] px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:border-neutral-400 cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#1A73E8]" />
                            <span>{att.filename}</span>
                            <span className="text-neutral-400 font-mono-tabular">
                              {formatBytes(att.sizeBytes)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 text-right text-[11px] text-neutral-400 font-mono-tabular">
                      You · {formatClockTime(msg.createdAt)}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <article key={msg.id} className="flex items-start gap-3">
                {/* Small circular emblem matching reference */}
                <div
                  aria-hidden="true"
                  className="w-8 h-8 rounded-full bg-[#1C1C1C] text-white flex items-center justify-center shrink-0 mt-1 shadow-xs"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </div>

                <div className="flex-1 min-w-0 rounded-2xl bg-[#F4F2EC] border border-[#E5E1D8] px-5 py-4">
                  {msg.thoughtText && (
                    <ThinkingCard thoughtText={msg.thoughtText} isStreaming={false} />
                  )}

                  {msg.toolSteps && msg.toolSteps.length > 0 && (
                    <InlineToolTiles steps={msg.toolSteps} isTurnActive={false} />
                  )}

                  <div className="text-[15px] leading-[1.65] text-neutral-900 space-y-2.5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold [&_code]:font-mono-tabular [&_code]:text-[13px] [&_code]:bg-white [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>

                  {msg.error && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-700">
                      {msg.error}
                    </div>
                  )}

                  {msg.attachments && msg.attachments.length > 0 && (
                    <DocxAttachmentRow
                      attachments={msg.attachments}
                      activeFileId={activeFileId}
                      onOpenFile={onOpenFile}
                      onViewAllFiles={onViewAllFiles}
                    />
                  )}

                  <div className="mt-3.5 pt-2.5 border-t border-[#E3DFD6] flex items-center justify-between gap-4 text-[11px] text-neutral-500">
                    <span className="font-mono-tabular">
                      Vod Word · {formatClockTime(msg.createdAt)}
                    </span>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.id, msg.content)}
                        className="inline-flex items-center gap-1 hover:text-neutral-900 transition-colors cursor-pointer"
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isStreaming}
                        onClick={() => onRegenerateMessage(msg.id)}
                        className="inline-flex items-center gap-1 hover:text-neutral-900 transition-colors cursor-pointer disabled:opacity-40"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Regenerate</span>
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}

          {isStreaming && (
            <div className="flex items-start gap-3" aria-live="polite">
              <div
                aria-hidden="true"
                className="w-8 h-8 rounded-full bg-[#1C1C1C] text-white flex items-center justify-center shrink-0 mt-1"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              </div>

              <div className="flex-1 min-w-0 rounded-2xl bg-[#F4F2EC] border border-[#E5E1D8] px-5 py-4">
                <ThinkingCard
                  thoughtText={liveThoughtText}
                  isStreaming={!liveText && liveSteps.length === 0}
                />

                <InlineToolTiles steps={liveSteps} isTurnActive={true} />

                {liveText ? (
                  <div className="text-[15px] leading-[1.65] text-neutral-900 space-y-2.5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveText}</ReactMarkdown>
                  </div>
                ) : (
                  !liveThoughtText &&
                  liveSteps.length === 0 && (
                    <div className="text-xs text-neutral-500">Thinking...</div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Scroll-to-Bottom Button */}
      {showScrollBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          aria-label="Scroll to latest message"
          className="absolute right-6 bottom-28 z-20 w-10 h-10 rounded-full bg-white border border-[#E2DFD7] shadow-md flex items-center justify-center text-neutral-700 hover:text-neutral-900 hover:bg-[#F5F3EE] transition-colors cursor-pointer"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* Minimal ChatGPT-style Composer */}
      <div className="bg-[#FAF9F6] px-4 sm:px-6 pb-4 pt-2 shrink-0">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative">
          <AttachmentPopover
            isOpen={isAttachmentMenuOpen}
            files={allFiles}
            isUploading={isUploading}
            uploadError={uploadError}
            onClose={() => setIsAttachmentMenuOpen(false)}
            onTriggerUpload={() => fileInputRef.current?.click()}
            onSelectFileToAttach={(file) => onSelectPendingFile(file)}
            onPreviewFile={(file) => onOpenFile(file)}
          />

          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => handleFileSelected(e.target.files?.[0])}
          />

          {pendingFileAttachment && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-xl border border-[#DFDBD2] bg-white px-3 py-1.5 text-xs text-neutral-800 shadow-xs">
              <FileText className="w-3.5 h-3.5 text-[#1A73E8]" />
              <span className="font-medium">{pendingFileAttachment.filename}</span>
              <span className="text-neutral-400 font-mono-tabular">
                {formatBytes(pendingFileAttachment.sizeBytes)}
              </span>
              <button
                type="button"
                onClick={onClearPendingFile}
                aria-label={`Remove ${pendingFileAttachment.filename}`}
                className="ml-0.5 text-neutral-400 hover:text-neutral-900 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="rounded-2xl border border-[#DFDBD2] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)] focus-within:border-neutral-500 transition-colors flex items-end gap-2 px-3 py-2.5">
            {/* Icon-only attachment button */}
            <button
              type="button"
              data-attachment-trigger="true"
              aria-label="Attachments"
              aria-expanded={isAttachmentMenuOpen}
              disabled={isStreaming}
              onClick={() => setIsAttachmentMenuOpen((v) => !v)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${
                isAttachmentMenuOpen
                  ? 'bg-[#F4F2EC] text-neutral-900'
                  : 'text-neutral-500 hover:text-neutral-900 hover:bg-[#F4F2EC]'
              }`}
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <label htmlFor="vod-chat-input" className="sr-only">
              Message Vod Word
            </label>
            <textarea
              id="vod-chat-input"
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Vod Word to create, inspect, or edit a .docx..."
              className="flex-1 resize-none bg-transparent py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none max-h-36"
            />

            <button
              type="submit"
              aria-label="Send message"
              disabled={!input.trim() || isStreaming}
              className="w-9 h-9 rounded-xl bg-[#191919] hover:bg-[#333333] disabled:bg-neutral-200 disabled:text-neutral-400 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              {isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
