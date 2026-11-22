import { Download, Eye, X } from 'lucide-react';
import type { DocxAttachment } from '../types/vod';
import { categorizeFilesByTime, formatBytes, formatClockTime } from '../utils/format';
import { WordDocIcon } from './VodBrandMarks';

interface AllFilesModalProps {
  isOpen: boolean;
  title: string;
  files: DocxAttachment[];
  onClose: () => void;
  onOpenFile: (file: DocxAttachment) => void;
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
      className="fixed inset-0 z-50 bg-[#2E2252]/40 backdrop-blur-[1px] flex items-center justify-center p-4"
    >
      <div className="bg-white border border-[#D9E1EF] rounded-xl shadow-[0_20px_50px_rgba(46,34,82,0.2)] w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#D9E1EF] flex items-center justify-between gap-4 bg-[#F4F6FB]">
          <div>
            <h2 className="font-display text-base font-bold text-[#1E1935]">{title}</h2>
            <p className="text-xs text-[#585470] font-mono-tabular mt-0.5">
              {files.length} Word document{files.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close files dialog"
            className="p-2 rounded-lg text-[#585470] hover:text-[#2E2252] hover:bg-[#D9E1EF]/60 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {groups.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#585470]">
              No .docx files in this task yet.
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <div className="px-1 pb-1.5 text-xs font-semibold text-[#585470]">
                  {group.label}
                </div>
                <div className="divide-y divide-[#ECEFF7] border border-[#D9E1EF] rounded-xl overflow-hidden">
                  {group.files.map((file) => (
                    <div
                      key={file.id}
                      className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-[#F4F6FB] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <WordDocIcon className="w-9 h-9 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#1E1935] truncate">
                            {file.filename}
                          </div>
                          <div className="text-xs text-[#585470] font-mono-tabular mt-0.5">
                            DOCX · {formatBytes(file.sizeBytes)} · {formatClockTime(file.updatedAt)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onOpenFile(file);
                            onClose();
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#2E2252] bg-white border border-[#D9E1EF] hover:border-[#185ABD] hover:text-[#185ABD] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Open</span>
                        </button>
                        <a
                          href={`/api/files/${encodeURIComponent(file.id)}/download`}
                          download={file.filename}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-[#185ABD] hover:bg-[#103F91] inline-flex items-center gap-1.5 whitespace-nowrap"
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
