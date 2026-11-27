import { FolderOpen } from 'lucide-react';
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
    <div className="mt-3.5 flex flex-wrap items-center gap-3">
      {attachments.map((file) => {
        const isActive = activeFileId === file.id;
        return (
          <button
            key={file.id}
            type="button"
            onClick={() => onOpenFile(file)}
            aria-label={`Open ${file.filename} in the PDF viewer`}
            className={`max-w-full group rounded-xl border px-3 sm:px-3.5 py-2.5 flex items-center gap-2.5 sm:gap-3 text-left transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6E162B] ${
              isActive
                ? 'border-[#A8203E] bg-[#FBF1F3] shadow-[0_1px_3px_rgba(110,22,43,0.10)]'
                : 'border-[#E3DFE4] bg-[#F8F7F8] hover:bg-[#FBF1F3]/65 hover:border-[#D98294]'
            }`}
          >
            <PdfDocIcon className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" />
            <div className="min-w-0 pr-1">
              <div className="text-[13px] sm:text-[13.5px] font-semibold text-[#1F171B] leading-tight truncate max-w-[175px] sm:max-w-[230px]">
                {file.filename}
              </div>
              <div className="text-[11px] sm:text-[11.5px] text-[#63565C] font-mono-tabular mt-0.5 whitespace-nowrap">
                {formatPageCount(file.pageCount)} · {formatBytes(file.sizeBytes)}
              </div>
            </div>
          </button>
        );
      })}

      <button
        type="button"
        onClick={onViewAllFiles}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#63565C] hover:text-[#6E162B] hover:bg-[#FBF1F3]/65 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#6E162B]"
      >
        <FolderOpen className="w-3.5 h-3.5 text-[#A8203E] shrink-0" />
        <span>All task files</span>
      </button>
    </div>
  );
}
