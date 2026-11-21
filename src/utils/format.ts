import type { DocxAttachment } from '../types/vod';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function formatShortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatClockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface FileTimeGroup {
  label: 'Today' | 'Yesterday' | 'Earlier';
  files: DocxAttachment[];
}

export function categorizeFilesByTime(
  files: DocxAttachment[],
  nowMs = Date.now(),
): FileTimeGroup[] {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  const today: DocxAttachment[] = [];
  const yesterday: DocxAttachment[] = [];
  const earlier: DocxAttachment[] = [];

  const sorted = [...files].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const file of sorted) {
    const ts = new Date(file.updatedAt || file.createdAt).getTime();
    if (Number.isNaN(ts) || ts >= startOfToday) {
      today.push(file);
    } else if (ts >= startOfYesterday) {
      yesterday.push(file);
    } else {
      earlier.push(file);
    }
  }

  const groups: FileTimeGroup[] = [];
  if (today.length > 0) groups.push({ label: 'Today', files: today });
  if (yesterday.length > 0) groups.push({ label: 'Yesterday', files: yesterday });
  if (earlier.length > 0) groups.push({ label: 'Earlier', files: earlier });
  return groups;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result);
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}
