import { Download, Eye, FileText, X } from 'lucide-react';
import type { DocxAttachment } from '../types/vod';
import { categorizeFilesByTime, formatBytes, formatClockTime } from '../utils/format';

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
      className="fixed inset-0 z-50 bg-neutral-950/35 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-[#E2DFD7] rounded-2xl shadow-xl w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E7E4DC] flex items-center justify-between gap-4 bg-[#FAF9F6]">
          <div>
            <h2 className="font-display text-base font-bold text-neutral-900">{title}</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              {files.length} Word document{files.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close files dialog"
            className="p-2 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-black/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {groups.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              No .docx files in this task yet.
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <div className="px-2 pb-1.5 text-xs font-semibold text-neutral-500">
                  {group.label}
                </div>
                <div className="divide-y divide-[#EFECE6] border border-[#E7E4DC] rounded-xl overflow-hidden">
                  {group.files.map((file) => (
                    <div
                      key={file.id}
                      className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-[#FAF9F6] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-[#1A73E8] text-white flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-neutral-900 truncate">
                            {file.filename}
                          </div>
                          <div className="text-xs text-neutral-500 font-mono-tabular mt-0.5">
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
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 bg-white border border-[#E2DFD7] hover:bg-[#F5F3EE] inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Open</span>
                        </button>
                        <a
                          href={`/api/files/${encodeURIComponent(file.id)}/download`}
                          download={file.filename}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-[#191919] hover:bg-[#333333] inline-flex items-center gap-1.5"
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
