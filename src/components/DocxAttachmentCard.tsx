import { FileSearch } from 'lucide-react';
import type { DocxAttachment } from '../types/vod';
import { formatBytes } from '../utils/format';
import { WordDocIcon } from './VodBrandMarks';

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
            className={`group rounded-xl border px-3.5 py-2.5 flex items-center gap-3 text-left transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#185ABD] ${
              isActive
                ? 'border-[#185ABD] bg-[#E8F0FC]/75 shadow-[0_1px_3px_rgba(24,90,189,0.12)]'
                : 'border-[#D9E1EF] bg-[#F4F6FB] hover:bg-[#E8F0FC]/45 hover:border-[#93B4E8]'
            }`}
          >
            <WordDocIcon className="w-10 h-10 shrink-0" />
            <div className="min-w-0 pr-1">
              <div className="text-[13.5px] font-semibold text-[#1E1935] leading-tight truncate max-w-[230px]">
                {file.filename}
              </div>
              <div className="text-[12px] text-[#585470] font-mono-tabular mt-0.5 whitespace-nowrap">
                DOCX · {formatBytes(file.sizeBytes)}
              </div>
            </div>
          </button>
        );
      })}

      <button
        type="button"
        onClick={onViewAllFiles}
        className="rounded-xl border border-[#D9E1EF] bg-white hover:bg-[#F4F6FB] hover:border-[#93B4E8] px-4 py-3 flex items-center gap-2 text-[13px] font-medium text-[#2E2252] hover:text-[#103F91] transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#185ABD]"
      >
        <FileSearch className="w-4 h-4 text-[#185ABD] shrink-0" />
        <span>View all files in this task</span>
      </button>
    </div>
  );
}
