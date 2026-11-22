import { FileSearch } from 'lucide-react';
import type { PdfAttachment } from '../types/vod';
import { formatBytes, formatPageCount } from '../utils/format';
import { PdfDocIcon } from './VodBrandMarks';

interface PdfAttachmentRowProps {
  attachments: PdfAttachment[];
  activeFileId: string | null;
  onOpenFile: (file: PdfAttachment) => void;
  onViewAllFiles: () => void;
}

export function PdfAttachmentRow({
  attachments,
  activeFileId,
  onOpenFile,
  onViewAllFiles,
}: PdfAttachmentRowProps) {
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
            aria-label={`Open ${file.filename} in the PDF viewer`}
            className={`group rounded-xl border px-3.5 py-2.5 flex items-center gap-3 text-left transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E2252] ${
              isActive
                ? 'border-[#4A3680] bg-[#F2EEF9] shadow-[0_1px_3px_rgba(46,34,82,0.12)]'
                : 'border-[#D9E1EF] bg-[#F4F6FB] hover:bg-[#F2EEF9]/60 hover:border-[#B9A9DC]'
            }`}
          >
            <PdfDocIcon className="w-10 h-10 shrink-0" />
            <div className="min-w-0 pr-1">
              <div className="text-[13.5px] font-semibold text-[#1E1935] leading-tight truncate max-w-[230px]">
                {file.filename}
              </div>
              <div className="text-[12px] text-[#585470] font-mono-tabular mt-0.5 whitespace-nowrap">
                PDF · {formatPageCount(file.pageCount)} · {formatBytes(file.sizeBytes)}
              </div>
            </div>
          </button>
        );
      })}

      <button
        type="button"
        onClick={onViewAllFiles}
        className="rounded-xl border border-[#D9E1EF] bg-white hover:bg-[#F4F6FB] hover:border-[#B9A9DC] px-4 py-3 flex items-center gap-2 text-[13px] font-medium text-[#2E2252] hover:text-[#1E1935] transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E2252]"
      >
        <FileSearch className="w-4 h-4 text-[#4A3680] shrink-0" />
        <span>View all files in this task</span>
      </button>
    </div>
  );
}
