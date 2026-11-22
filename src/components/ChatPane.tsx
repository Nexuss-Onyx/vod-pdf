import {
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardList,
  Copy,
  FileCheck2,
  FilePlus2,
  FileText,
  Loader2,
  Paperclip,
  RotateCcw,
  Scale,
  X,
} from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AgentToolStep,
  ChatMessage,
  PdfAttachment,
} from '../types/vod';
import { formatBytes, formatClockTime, formatPageCount, readFileAsBase64 } from '../utils/format';
import { saveLocalFileBlob } from '../utils/localWorkspaceDb';
import { AttachmentPopover } from './AttachmentPopover';
import { PdfAttachmentRow } from './PdfAttachmentCard';
import { InlineToolTiles } from './InlineToolTiles';
import { ThinkingCard } from './ThinkingCard';
import { PdfDocIcon, VodLogo } from './VodBrandMarks';

interface ChatPaneProps {
  sessionId: string;
  messages: ChatMessage[];
  allFiles: PdfAttachment[];
  activeFileId: string | null;
  isStreaming: boolean;
  liveThoughtText: string;
  liveSteps: AgentToolStep[];
  liveText: string;
  pendingFileAttachment: PdfAttachment | null;
  onClearPendingFile: () => void;
  onSelectPendingFile: (file: PdfAttachment) => void;
  onAttachUploadedFile: (file: PdfAttachment) => void;
  onSendMessage: (prompt: string) => void;
  onRegenerateMessage: (assistantMessageId: string) => void;
  onOpenFile: (file: PdfAttachment) => void;
  onViewAllFiles: () => void;
}

const STARTER_PROMPTS = [
  {
    title: 'Executive Operations Memo',
    icon: FilePlus2,
    prompt:
      'Create an executive Operations & Staffing Readiness Memo PDF with a summary callout, regional shift table, and priority action items.',
  },
  {
    title: 'Vendor MSA Review',
    icon: Scale,
    prompt:
      'Draft a SaaS Vendor Master Services Agreement PDF covering SLA uptime, Net 30 payment terms, and liability caps, then add a review comment on the indemnity clause.',
  },
  {
    title: 'Project Kickoff Brief',
    icon: FileCheck2,
    prompt:
      'Build a structured Q1 Product Launch Brief PDF with a cover page, milestones table, stakeholder roles, and risk matrix.',
  },
  {
    title: 'Standard Operating Procedure',
    icon: ClipboardList,
    prompt:
      'Generate an Incident Escalation SOP PDF with a severity tiers table, numbered response steps, and audit checklist.',
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
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Vod PDF only accepts .pdf documents. Export Word files to PDF first.');
      return;
    }

    setIsUploading(true);
    try {
      const [base64Data, arrayBuffer] = await Promise.all([
        readFileAsBase64(file),
        file.arrayBuffer(),
      ]);
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
      await saveLocalFileBlob(data.file.id, arrayBuffer, data.inspection);
      onAttachUploadedFile(data.file);
      setIsAttachmentMenuOpen(false);
      textareaRef.current?.focus();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload the PDF file.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <section
      aria-label="Vod PDF Chat"
      className="flex-1 flex flex-col min-w-0 bg-[#F4F6FB] relative"
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
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="text-[#2E2252] font-semibold">Vod Suite</span>
                <span aria-hidden="true" className="text-[#C3CFE4]">
                  ·
                </span>
                <span className="text-[#4A3680]">PDF Document Workspace</span>
              </div>
              <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-[#1E1935] tracking-tight text-balance">
                What PDF can I create or edit?
              </h1>
              <p className="mt-2 text-sm text-[#585470] max-w-xl leading-relaxed">
                Draft executive briefs, annotate review copies, search existing PDFs, or upload a
                .pdf document to inspect and edit.
              </p>

              <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {STARTER_PROMPTS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => onSendMessage(item.prompt)}
                      className="group p-4 rounded-xl border border-[#D9E1EF] bg-white hover:border-[#4A3680] hover:bg-[#F2EEF9]/45 text-left transition-all cursor-pointer shadow-[0_1px_2px_rgba(46,34,82,0.04)] focus-visible:outline-2 focus-visible:outline-[#2E2252]"
                    >
                      <div className="flex items-center gap-2.5 text-sm font-semibold text-[#1E1935] group-hover:text-[#2E2252]">
                        <span className="w-8 h-8 rounded-lg bg-[#F2EEF9] text-[#4A3680] flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4" />
                        </span>
                        <span>{item.title}</span>
                      </div>
                      <p className="mt-2 text-xs text-[#585470] leading-relaxed line-clamp-2">
                        {item.prompt}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex flex-col items-end">
                  <div className="max-w-xl rounded-xl border border-[#D6C9EE] bg-[#F2EEF9]/70 px-4 py-3 text-[15px] leading-relaxed text-[#1E1935]">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {msg.attachments.map((att) => (
                          <button
                            key={att.id}
                            type="button"
                            onClick={() => onOpenFile(att)}
                            className="inline-flex items-center gap-2 rounded-lg bg-white border border-[#D6C9EE] px-2.5 py-1.5 text-xs font-medium text-[#1E1935] hover:border-[#4A3680] cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#4A3680]" />
                            <span>{att.filename}</span>
                            <span className="text-[#585470] font-mono-tabular">
                              {formatBytes(att.sizeBytes)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 text-right text-[11px] text-[#585470] font-mono-tabular whitespace-nowrap">
                      You · {formatClockTime(msg.createdAt)}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <article key={msg.id} className="flex items-start gap-3">
                {/* Abstract Vod Brand Emblem */}
                <div
                  aria-hidden="true"
                  className="w-9 h-9 rounded-xl bg-white border border-[#D9E1EF] flex items-center justify-center shrink-0 mt-0.5 shadow-[0_1px_3px_rgba(46,34,82,0.06)]"
                >
                  <VodLogo className="w-5 h-5" />
                </div>

                <div className="flex-1 min-w-0 rounded-xl bg-white border border-[#D9E1EF] px-5 py-4 shadow-[0_1px_3px_rgba(46,34,82,0.04)]">
                  {msg.thoughtText && (
                    <ThinkingCard thoughtText={msg.thoughtText} isStreaming={false} />
                  )}

                  {msg.toolSteps && msg.toolSteps.length > 0 && (
                    <InlineToolTiles steps={msg.toolSteps} isTurnActive={false} />
                  )}

                  <div className="text-[15px] leading-[1.65] text-[#1E1935] space-y-2.5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold [&_code]:font-mono-tabular [&_code]:text-[13px] [&_code]:bg-[#F4F6FB] [&_code]:border [&_code]:border-[#D9E1EF] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_th]:bg-[#ECEFF7] [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_td]:border-t [&_td]:border-[#D9E1EF] [&_td]:px-3 [&_td]:py-2 [&_td]:text-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>

                  {msg.error && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-700">
                      {msg.error}
                    </div>
                  )}

                  {msg.attachments && msg.attachments.length > 0 && (
                    <PdfAttachmentRow
                      attachments={msg.attachments}
                      activeFileId={activeFileId}
                      onOpenFile={onOpenFile}
                      onViewAllFiles={onViewAllFiles}
                    />
                  )}

                  <div className="mt-4 pt-2.5 border-t border-[#ECEFF7] flex items-center justify-between gap-3 text-[11px] text-[#585470]">
                    <span className="font-mono-tabular whitespace-nowrap">
                      Vod PDF · {formatClockTime(msg.createdAt)}
                    </span>

                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.id, msg.content)}
                        className="inline-flex items-center gap-1 hover:text-[#4A3680] transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isStreaming}
                        onClick={() => onRegenerateMessage(msg.id)}
                        className="inline-flex items-center gap-1 hover:text-[#4A3680] transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
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
                className="w-9 h-9 rounded-xl bg-white border border-[#D9E1EF] flex items-center justify-center shrink-0 mt-0.5"
              >
                <Loader2 className="w-4 h-4 animate-spin text-[#4A3680]" />
              </div>

              <div className="flex-1 min-w-0 rounded-xl bg-white border border-[#D9E1EF] px-5 py-4 shadow-[0_1px_3px_rgba(46,34,82,0.04)]">
                <ThinkingCard
                  thoughtText={liveThoughtText}
                  isStreaming={!liveText && liveSteps.length === 0}
                />

                <InlineToolTiles steps={liveSteps} isTurnActive={true} />

                {liveText ? (
                  <div className="text-[15px] leading-[1.65] text-[#1E1935] space-y-2.5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveText}</ReactMarkdown>
                  </div>
                ) : (
                  !liveThoughtText &&
                  liveSteps.length === 0 && (
                    <div className="text-xs text-[#585470]">Thinking...</div>
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
          className="absolute right-6 bottom-28 z-20 w-10 h-10 rounded-full bg-white border border-[#D9E1EF] shadow-[0_4px_14px_rgba(46,34,82,0.12)] flex items-center justify-center text-[#2E2252] hover:text-[#4A3680] hover:border-[#4A3680] transition-colors cursor-pointer"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* Branded Enterprise Composer */}
      <div className="bg-[#F4F6FB] px-4 sm:px-6 pb-4 pt-2 shrink-0">
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
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => handleFileSelected(e.target.files?.[0])}
          />

          {pendingFileAttachment && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-[#D6C9EE] bg-white px-3 py-1.5 text-xs text-[#1E1935] shadow-xs">
              <PdfDocIcon className="w-5 h-5 shrink-0" />
              <span className="font-medium">{pendingFileAttachment.filename}</span>
              <span className="text-[#585470] font-mono-tabular">
                {formatBytes(pendingFileAttachment.sizeBytes)}
              </span>
              <button
                type="button"
                onClick={onClearPendingFile}
                aria-label={`Remove ${pendingFileAttachment.filename}`}
                className="ml-0.5 text-[#585470] hover:text-[#2E2252] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="rounded-xl border border-[#C3CFE4] bg-white shadow-[0_2px_10px_rgba(46,34,82,0.05)] focus-within:border-[#4A3680] focus-within:ring-2 focus-within:ring-[#4A3680]/15 transition-all flex items-end gap-2 px-3 py-2.5">
            {/* Icon-only attachment button */}
            <button
              type="button"
              data-attachment-trigger="true"
              aria-label="Attachments"
              aria-expanded={isAttachmentMenuOpen}
              disabled={isStreaming}
              onClick={() => setIsAttachmentMenuOpen((v) => !v)}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${
                isAttachmentMenuOpen
                  ? 'bg-[#F2EEF9] text-[#4A3680]'
                  : 'text-[#585470] hover:text-[#4A3680] hover:bg-[#F2EEF9]/70'
              }`}
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <label htmlFor="vod-chat-input" className="sr-only">
              Message Vod PDF
            </label>
            <textarea
              id="vod-chat-input"
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Vod PDF (.pdf)..."
              className="flex-1 resize-none bg-transparent py-2 text-sm text-[#1E1935] placeholder:text-[#706B88] focus:outline-none max-h-36"
            />

            <button
              type="submit"
              aria-label="Send message"
              disabled={!input.trim() || isStreaming}
              className="w-9 h-9 rounded-lg bg-[#2E2252] hover:bg-[#3E2E6E] disabled:bg-[#E4E9F2] disabled:text-[#8E98AE] text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
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
