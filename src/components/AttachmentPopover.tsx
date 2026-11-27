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
      className="absolute bottom-full left-0 mb-2 w-[min(calc(100vw-1.5rem),24rem)] rounded-xl border border-[#E3DFE4] bg-white shadow-[0_12px_32px_rgba(110,22,43,0.14)] z-30 overflow-hidden"
    >
      {/* Upload Action Header */}
      <div className="px-3.5 py-2.5 border-b border-[#E3DFE4] flex items-center justify-between gap-2 bg-[#F8F7F8]">
        <button
          type="button"
          disabled={isUploading}
          onClick={onTriggerUpload}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#6E162B] hover:bg-[#851D35] text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#6E162B]"
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
          className="p-1.5 rounded-lg text-[#63565C] hover:text-[#6E162B] hover:bg-[#E3DFE4]/60 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {uploadError && (
        <div className="px-3.5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
          {uploadError}
        </div>
      )}

      {/* Categorized Recent Files List */}
      <div className="max-h-72 overflow-y-auto p-2.5 space-y-3">
        {groups.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#63565C]">
            No PDFs yet. Upload a .pdf file to begin.
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="px-2 pb-1 text-[11px] font-semibold text-[#63565C]">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#FBF1F3]/75 transition-colors"
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
                        <div className="text-xs font-semibold text-[#1F171B] truncate">
                          {file.filename}
                        </div>
                        <div className="text-[11px] text-[#63565C] font-mono-tabular truncate">
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
                      className="p-1.5 rounded-lg text-[#63565C] hover:text-[#A8203E] hover:bg-white cursor-pointer shrink-0"
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
