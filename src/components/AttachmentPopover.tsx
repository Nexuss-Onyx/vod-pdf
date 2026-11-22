import { Eye, Loader2, Upload, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { PdfAttachment } from '../types/vod';
import { categorizeFilesByTime, formatBytes, formatClockTime, formatPageCount } from '../utils/format';
import { PdfDocIcon } from './VodBrandMarks';

interface AttachmentPopoverProps {
  isOpen: boolean;
  files: PdfAttachment[];
  isUploading: boolean;
  uploadError: string | null;
  onClose: () => void;
  onTriggerUpload: () => void;
  onSelectFileToAttach: (file: PdfAttachment) => void;
  onPreviewFile: (file: PdfAttachment) => void;
}

export function AttachmentPopover({
  isOpen,
  files,
  isUploading,
  uploadError,
  onClose,
  onTriggerUpload,
  onSelectFileToAttach,
  onPreviewFile,
}: AttachmentPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-attachment-trigger="true"]')) {
        return;
      }
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const groups = categorizeFilesByTime(files);

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Recent attachments and upload"
      className="absolute bottom-full left-0 mb-2 w-80 sm:w-96 rounded-xl border border-[#D9E1EF] bg-white shadow-[0_12px_32px_rgba(46,34,82,0.14)] z-30 overflow-hidden"
    >
      {/* Upload Action Header */}
      <div className="px-3.5 py-2.5 border-b border-[#D9E1EF] flex items-center justify-between gap-2 bg-[#F4F6FB]">
        <button
          type="button"
          disabled={isUploading}
          onClick={onTriggerUpload}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#2E2252] hover:bg-[#3E2E6E] text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#2E2252]"
        >
          {isUploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          <span>{isUploading ? 'Uploading...' : 'Upload .pdf'}</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close attachments menu"
          className="p-1.5 rounded-lg text-[#585470] hover:text-[#2E2252] hover:bg-[#D9E1EF]/60 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {uploadError && (
        <div className="px-3.5 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
          {uploadError}
        </div>
      )}

      {/* Categorized Recent Files List */}
      <div className="max-h-72 overflow-y-auto p-2.5 space-y-3">
        {groups.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#585470]">
            No PDFs yet. Upload a .pdf file to begin.
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="px-2 pb-1 text-[11px] font-semibold text-[#585470]">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#F2EEF9]/60 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectFileToAttach(file);
                        onClose();
                      }}
                      className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer"
                    >
                      <PdfDocIcon className="w-8 h-8 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#1E1935] truncate">
                          {file.filename}
                        </div>
                        <div className="text-[11px] text-[#585470] font-mono-tabular truncate">
                          {formatPageCount(file.pageCount)} · {formatBytes(file.sizeBytes)} · {formatClockTime(file.updatedAt)}
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onPreviewFile(file);
                        onClose();
                      }}
                      aria-label={`Preview ${file.filename}`}
                      className="p-1.5 rounded-lg text-[#585470] hover:text-[#4A3680] hover:bg-white cursor-pointer shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
