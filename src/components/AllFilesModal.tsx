import { Download, Eye, X } from 'lucide-react';
import type { PdfAttachment } from '../types/vod';
import { downloadPdfAttachment } from '../utils/downloadPdf';
import { categorizeFilesByTime, formatBytes, formatClockTime, formatPageCount } from '../utils/format';
import { PdfDocIcon } from './VodBrandMarks';

interface AllFilesModalProps {
  isOpen: boolean;
  title: string;
  files: PdfAttachment[];
  onClose: () => void;
  onOpenFile: (file: PdfAttachment) => void;
}

export function AllFilesModal({
  isOpen,
  title,
  files,
  onClose,
  onOpenFile,
}: AllFilesModalProps) {
  if (!isOpen) return null;

  const groups = categorizeFilesByTime(files);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 bg-[#6E162B]/35 backdrop-blur-[1px] flex items-center justify-center p-4"
    >
      <div className="bg-white border border-[#E3DFE4] rounded-xl shadow-[0_20px_50px_rgba(110,22,43,0.18)] w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E3DFE4] flex items-center justify-between gap-4 bg-[#F8F7F8]">
          <div>
            <h2 className="font-display text-base font-bold text-[#1F171B]">{title}</h2>
            <p className="text-xs text-[#63565C] font-mono-tabular mt-0.5">
              {files.length} PDF document{files.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close files dialog"
            className="p-2 rounded-lg text-[#63565C] hover:text-[#6E162B] hover:bg-[#E3DFE4]/60 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {groups.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#63565C]">
              No .pdf files in this task yet.
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <div className="px-1 pb-1.5 text-xs font-semibold text-[#63565C]">
                  {group.label}
                </div>
                <div className="divide-y divide-[#F1EFF2] border border-[#E3DFE4] rounded-xl overflow-hidden">
                  {group.files.map((file) => (
                    <div
                      key={file.id}
                      className="px-3.5 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 hover:bg-[#F8F7F8] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <PdfDocIcon className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#1F171B] truncate">
                            {file.filename}
                          </div>
                          <div className="text-xs text-[#63565C] font-mono-tabular mt-0.5 truncate">
                            PDF · {formatPageCount(file.pageCount)} · {formatBytes(file.sizeBytes)} · {formatClockTime(file.updatedAt)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                        <button
                          type="button"
                          onClick={() => {
                            onOpenFile(file);
                            onClose();
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#6E162B] bg-white border border-[#E3DFE4] hover:border-[#A8203E] hover:text-[#A8203E] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Open</span>
                        </button>
                        <a
                          href={`/api/files/${encodeURIComponent(file.id)}/download`}
                          download={file.filename}
                          onClick={(event) => {
                            event.preventDefault();
                            void downloadPdfAttachment(file).catch(() => {});
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-[#6E162B] hover:bg-[#851D35] inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
