import { FileSearch, FileText } from 'lucide-react';
import type { DocxAttachment } from '../types/vod';
import { formatBytes } from '../utils/format';

interface DocxAttachmentRowProps {
  attachments: DocxAttachment[];
  activeFileId: string | null;
  onOpenFile: (file: DocxAttachment) => void;
  onViewAllFiles: () => void;
}

export function DocxAttachmentRow({
  attachments,
  activeFileId,
  onOpenFile,
  onViewAllFiles,
}: DocxAttachmentRowProps) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {attachments.map((file) => {
        const isActive = activeFileId === file.id;
        return (
          <button
            key={file.id}
            type="button"
            onClick={() => onOpenFile(file)}
            aria-label={`Open ${file.filename} in DOCX viewer`}
            className={`group rounded-xl border px-3.5 py-2.5 flex items-center gap-3 text-left transition-all cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A73E8] ${
              isActive
                ? 'border-[#1A73E8] bg-blue-50/40'
                : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
            }`}
          >
            <div className="w-10 h-10 rounded-lg bg-[#1A73E8] text-white flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0 pr-1">
              <div className="text-[13.5px] font-semibold text-slate-900 leading-tight truncate max-w-[220px]">
                {file.filename}
              </div>
              <div className="text-[12px] text-slate-500 font-mono-tabular mt-0.5 whitespace-nowrap">
                DOCX · {formatBytes(file.sizeBytes)}
              </div>
            </div>
          </button>
        );
      })}

      <button
        type="button"
        onClick={onViewAllFiles}
        className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 px-5 py-3.5 flex items-center gap-2.5 text-[13.5px] font-medium text-slate-700 transition-all cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A73E8]"
      >
        <FileSearch className="w-4 h-4 text-slate-500 shrink-0" />
        <span>View all files in this task</span>
      </button>
    </div>
  );
}
