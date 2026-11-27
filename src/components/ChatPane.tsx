import {
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardList,
  Copy,
  FilePlus2,
  FileText,
  Layers,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  RotateCcw,
  Upload,
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
import { formatBytes, formatClockTime, readFileAsBase64 } from '../utils/format';
import { saveLocalFileBlob } from '../utils/localWorkspaceDb';
import { AttachmentPopover } from './AttachmentPopover';
import { InlineToolTiles } from './InlineToolTiles';
import { PdfAttachmentRow } from './PdfAttachmentCard';
import { ThinkingCard } from './ThinkingCard';
import { TurnDetailsDisclosure } from './TurnDetailsDisclosure';
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
  composerPrefill?: { text: string; key: number } | null;
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
    title: 'Write a brief or memo',
    subtitle: 'Create a clean, structured PDF report with key takeaways and a summary table.',
    icon: FilePlus2,
    prompt:
      'Create an executive Operations & Staffing Readiness Memo PDF with a summary callout, regional shift table, and priority action items.',
  },
  {
    title: 'Review & comment',
    subtitle: 'Draft an agreement or review an existing PDF with anchored comments.',
    icon: MessageSquarePlus,
    prompt:
      'Draft a SaaS Vendor Master Services Agreement PDF covering SLA uptime, Net 30 payment terms, and liability caps, then add a review comment on the indemnity clause.',
  },
  {
    title: 'Checklist or SOP',
    subtitle: 'Turn steps, checklists, and response tables into a shareable PDF.',
    icon: ClipboardList,
    prompt:
      'Generate an Incident Escalation SOP PDF with a severity tiers table, numbered response steps, and audit checklist.',
  },
  {
    title: 'Organize & watermark',
    subtitle: 'Combine PDFs, extract pages, rotate orientation, or stamp a watermark.',
    icon: Layers,
    prompt:
      'Build a structured Q1 Product Launch Brief PDF with a cover page, milestones table, stakeholder roles, and a DRAFT watermark.',
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
  composerPrefill,
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

  useEffect(() => {
    if (composerPrefill) {
      setInput(composerPrefill.text);
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 0);
    }
  }, [composerPrefill]);

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
      setUploadError('Vod PDF only accepts .pdf documents. Export non-PDF files to .pdf first.');
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
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        file?: PdfAttachment;
        inspection?: unknown;
      } | null;
      if (!res.ok || !data?.file) {
        if (res.status === 413) {
          throw new Error('This PDF exceeds the 4.5 MB serverless upload limit.');
        }
        throw new Error(data?.error || 'Upload failed.');
      }
      await saveLocalFileBlob(data.file.id, arrayBuffer, data.inspection as never);
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
      className="flex-1 flex flex-col min-w-0 bg-[#F8F7F8] relative"
    >
      {/* Message Viewport */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6"
      >
        <div className="max-w-2xl mx-auto space-y-4 sm:space-y-5">
          {messages.length === 0 && !isStreaming && (
            <div className="py-5 sm:py-12">
              <h1 className="font-display text-xl sm:text-3xl font-bold text-[#1F171B] tracking-tight text-balance">
                How can I help with your PDF?
              </h1>
              <p className="mt-2 text-xs sm:text-sm text-[#63565C] max-w-lg leading-relaxed">
                Create a document, ask questions about a file, add comments, or organize pages.
              </p>

              <div className="mt-5 sm:mt-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                {STARTER_PROMPTS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => onSendMessage(item.prompt)}
                      className="group p-3.5 sm:p-4 rounded-xl border border-[#E3DFE4] bg-white hover:border-[#A8203E] hover:bg-[#FBF1F3]/40 text-left transition-all cursor-pointer shadow-[0_1px_2px_rgba(110,22,43,0.03)] focus-visible:outline-2 focus-visible:outline-[#6E162B]"
                    >
                      <div className="flex items-center gap-2.5 text-sm font-semibold text-[#1F171B] group-hover:text-[#6E162B]">
                        <span className="w-8 h-8 rounded-lg bg-[#FBF1F3] text-[#A8203E] flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4" />
                        </span>
                        <span>{item.title}</span>
                      </div>
                      <p className="mt-1.5 sm:mt-2 text-xs text-[#63565C] leading-relaxed">
                        {item.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 sm:mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 py-1 text-xs font-medium text-[#6E162B] hover:text-[#A8203E] cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Or upload a PDF from your device</span>
                </button>
              </div>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex flex-col items-end">
                  <div
                    title={formatClockTime(msg.createdAt)}
                    className="max-w-[92%] sm:max-w-xl rounded-xl border border-[#EBCBD2] bg-[#FBF1F3]/75 px-3.5 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-[15px] leading-relaxed text-[#1F171B] break-words"
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {msg.attachments.map((att) => (
                          <button
                            key={att.id}
                            type="button"
                            onClick={() => onOpenFile(att)}
                            className="max-w-full inline-flex items-center gap-2 rounded-lg bg-white border border-[#EBCBD2] px-2.5 py-1.5 text-xs font-medium text-[#1F171B] hover:border-[#A8203E] cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#A8203E] shrink-0" />
                            <span className="truncate">{att.filename}</span>
                            <span className="text-[#63565C] font-mono-tabular shrink-0">
                              {formatBytes(att.sizeBytes)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <article key={msg.id} className="group flex items-start gap-2.5 sm:gap-3">
                <div
                  aria-hidden="true"
                  className="hidden sm:flex w-8 h-8 rounded-lg bg-white border border-[#E3DFE4] items-center justify-center shrink-0 mt-0.5"
                >
                  <VodLogo className="w-4.5 h-4.5" />
                </div>

                <div className="flex-1 min-w-0 rounded-xl bg-white border border-[#E3DFE4] px-3.5 sm:px-5 py-3 sm:py-4 shadow-[0_1px_2px_rgba(110,22,43,0.03)]">
                  <TurnDetailsDisclosure
                    thoughtText={msg.thoughtText}
                    toolSteps={msg.toolSteps}
                  />

                  <div className="text-sm sm:text-[15px] leading-[1.65] text-[#1F171B] break-words space-y-2.5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold [&_code]:font-mono-tabular [&_code]:text-[12.5px] sm:[&_code]:text-[13px] [&_code]:bg-[#F8F7F8] [&_code]:border [&_code]:border-[#E3DFE4] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_pre]:overflow-x-auto [&_h1]:text-base sm:[&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-sm sm:[&_h2]:text-base [&_h2]:font-semibold [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_th]:bg-[#F1EFF2] [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_td]:border-t [&_td]:border-[#E3DFE4] [&_td]:px-3 [&_td]:py-2 [&_td]:text-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>

                  {msg.error && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-800">
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

                  <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-[#8F848A]">
                    <span className="font-mono-tabular whitespace-nowrap opacity-75 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      {formatClockTime(msg.createdAt)}
                    </span>

                    <div className="flex items-center gap-3 shrink-0 opacity-85 sm:opacity-75 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.id, msg.content)}
                        className="inline-flex items-center gap-1 py-0.5 hover:text-[#6E162B] transition-colors cursor-pointer whitespace-nowrap"
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
                        className="inline-flex items-center gap-1 py-0.5 hover:text-[#6E162B] transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}

          {isStreaming && (
            <div className="flex items-start gap-2.5 sm:gap-3" aria-live="polite">
              <div
                aria-hidden="true"
                className="hidden sm:flex w-8 h-8 rounded-lg bg-white border border-[#E3DFE4] items-center justify-center shrink-0 mt-0.5"
              >
                <Loader2 className="w-4 h-4 animate-spin text-[#A8203E]" />
              </div>

              <div className="flex-1 min-w-0 rounded-xl bg-white border border-[#E3DFE4] px-3.5 sm:px-5 py-3 sm:py-4 shadow-[0_1px_2px_rgba(110,22,43,0.03)]">
                <ThinkingCard
                  thoughtText={liveThoughtText}
                  isStreaming={!liveText && liveSteps.length === 0}
                />

                <InlineToolTiles steps={liveSteps} isTurnActive={true} />

                {liveText ? (
                  <div className="text-sm sm:text-[15px] leading-[1.65] text-[#1F171B] break-words space-y-2.5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveText}</ReactMarkdown>
                  </div>
                ) : (
                  !liveThoughtText &&
                  liveSteps.length === 0 && (
                    <div className="text-xs text-[#63565C]">Working on it…</div>
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
          className="absolute right-3.5 sm:right-6 bottom-22 sm:bottom-28 z-20 w-9 h-9 rounded-full bg-white border border-[#E3DFE4] shadow-[0_4px_14px_rgba(110,22,43,0.12)] flex items-center justify-center text-[#6E162B] hover:text-[#A8203E] hover:border-[#A8203E] transition-colors cursor-pointer"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* Composer */}
      <div className="bg-[#F8F7F8] px-3 sm:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shrink-0">
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto relative">
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
            <div className="mb-2 max-w-full inline-flex items-center gap-2 rounded-lg border border-[#EBCBD2] bg-white px-3 py-1.5 text-xs text-[#1F171B] shadow-xs">
              <PdfDocIcon className="w-5 h-5 shrink-0" />
              <span className="font-medium truncate max-w-[180px] sm:max-w-xs">
                {pendingFileAttachment.filename}
              </span>
              <span className="text-[#63565C] font-mono-tabular shrink-0">
                {formatBytes(pendingFileAttachment.sizeBytes)}
              </span>
              <button
                type="button"
                onClick={onClearPendingFile}
                aria-label={`Remove ${pendingFileAttachment.filename}`}
                className="ml-0.5 text-[#63565C] hover:text-[#6E162B] cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="rounded-xl border border-[#CFC8D0] bg-white shadow-[0_2px_10px_rgba(110,22,43,0.04)] focus-within:border-[#A8203E] focus-within:ring-2 focus-within:ring-[#A8203E]/15 transition-all flex items-end gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2">
            <button
              type="button"
              data-attachment-trigger="true"
              aria-label="Attachments"
              aria-expanded={isAttachmentMenuOpen}
              disabled={isStreaming}
              onClick={() => setIsAttachmentMenuOpen((v) => !v)}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${
                isAttachmentMenuOpen
                  ? 'bg-[#FBF1F3] text-[#A8203E]'
                  : 'text-[#63565C] hover:text-[#A8203E] hover:bg-[#FBF1F3]/75'
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
              placeholder="Ask or upload a PDF..."
              className="flex-1 min-w-0 resize-none bg-transparent py-2 text-sm text-[#1F171B] placeholder:text-[#7D6E75] focus:outline-none max-h-36"
            />

            <button
              type="submit"
              aria-label="Send message"
              disabled={!input.trim() || isStreaming}
              className="w-9 h-9 rounded-lg bg-[#6E162B] hover:bg-[#851D35] disabled:bg-[#E8E3E7] disabled:text-[#8F848A] text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
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
