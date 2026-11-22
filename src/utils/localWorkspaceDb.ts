import type {
  ChatMessage,
  ChatSession,
  DocxAttachment,
  DocxInspection,
  WorkspaceSnapshot,
} from '../types/vod';
import { enqueueSyncOp, type PendingSyncOp } from './syncMerge';

const DB_NAME = 'vod_word_local_v1';
const DB_VERSION = 1;

const STORE_META = 'meta';
const STORE_SESSIONS = 'sessions';
const STORE_BLOBS = 'blobs';

const META_SNAPSHOT_KEY = 'workspace_snapshot';
const META_SYNC_OPS_KEY = 'pending_sync_ops';

export interface LocalWorkspaceMeta extends WorkspaceSnapshot {
  activeSessionId?: string;
  updatedAt: string;
}

export interface LocalFileBlobRecord {
  fileId: string;
  buffer: ArrayBuffer;
  inspection?: DocxInspection;
  updatedAt: string;
}

const memoryMeta = new Map<string, unknown>();
const memorySessions = new Map<string, ChatMessage[]>();
const memoryBlobs = new Map<string, LocalFileBlobRecord>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionId' });
        }
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          db.createObjectStore(STORE_BLOBS, { keyPath: 'fileId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function idbPut<T>(storeName: string, value: T, key?: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      if (key !== undefined) {
        store.put(value, key);
      } else {
        store.put(value);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadLocalMeta(): Promise<LocalWorkspaceMeta | null> {
  const mem = memoryMeta.get(META_SNAPSHOT_KEY) as LocalWorkspaceMeta | undefined;
  const fromDb = await idbGet<LocalWorkspaceMeta>(STORE_META, META_SNAPSHOT_KEY);
  return fromDb || mem || null;
}

export async function saveLocalMeta(meta: {
  sessions: ChatSession[];
  files: DocxAttachment[];
  activeSessionId?: string;
}): Promise<void> {
  const record: LocalWorkspaceMeta = {
    sessions: meta.sessions,
    files: meta.files,
    activeSessionId: meta.activeSessionId,
    updatedAt: new Date().toISOString(),
  };
  memoryMeta.set(META_SNAPSHOT_KEY, record);
  await idbPut(STORE_META, record, META_SNAPSHOT_KEY);
}

export async function loadLocalSessionMessages(sessionId: string): Promise<ChatMessage[] | null> {
  if (!sessionId) return null;
  const fromDb = await idbGet<{ sessionId: string; messages: ChatMessage[] }>(
    STORE_SESSIONS,
    sessionId,
  );
  if (fromDb?.messages) return fromDb.messages;
  return memorySessions.get(sessionId) || null;
}

export async function saveLocalSessionMessages(
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  if (!sessionId) return;
  memorySessions.set(sessionId, messages);
  await idbPut(STORE_SESSIONS, {
    sessionId,
    messages,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteLocalSessionData(
  sessionId: string,
  removedFileIds: string[] = [],
): Promise<void> {
  memorySessions.delete(sessionId);
  await idbDelete(STORE_SESSIONS, sessionId);
  for (const fid of removedFileIds) {
    memoryBlobs.delete(fid);
    await idbDelete(STORE_BLOBS, fid);
  }
}

export async function loadLocalFileBlob(fileId: string): Promise<LocalFileBlobRecord | null> {
  if (!fileId) return null;
  const fromDb = await idbGet<LocalFileBlobRecord>(STORE_BLOBS, fileId);
  if (fromDb) return fromDb;
  return memoryBlobs.get(fileId) || null;
}

export async function saveLocalFileBlob(
  fileId: string,
  buffer: ArrayBuffer,
  inspection?: DocxInspection,
): Promise<void> {
  if (!fileId) return;
  const existing = await loadLocalFileBlob(fileId);
  const record: LocalFileBlobRecord = {
    fileId,
    buffer,
    inspection: inspection ?? existing?.inspection,
    updatedAt: new Date().toISOString(),
  };
  memoryBlobs.set(fileId, record);
  await idbPut(STORE_BLOBS, record);
}

export async function prefetchFileToLocalCache(fileId: string): Promise<void> {
  if (!fileId) return;
  const existing = await loadLocalFileBlob(fileId);
  if (existing?.buffer && existing.inspection) return;
  try {
    const [binRes, inspectRes] = await Promise.all([
      fetch(`/api/files/${encodeURIComponent(fileId)}/download?inline=1`),
      fetch(`/api/files/${encodeURIComponent(fileId)}/inspect`),
    ]);
    if (!binRes.ok) return;
    const buffer = await binRes.arrayBuffer();
    const inspection = inspectRes.ok ? ((await inspectRes.json()) as DocxInspection) : undefined;
    await saveLocalFileBlob(fileId, buffer, inspection);
  } catch {
    // Background prefetch failures are non-fatal
  }
}

export async function loadPendingSyncOps(): Promise<PendingSyncOp[]> {
  const fromDb = await idbGet<PendingSyncOp[]>(STORE_META, META_SYNC_OPS_KEY);
  if (Array.isArray(fromDb)) return fromDb;
  const mem = memoryMeta.get(META_SYNC_OPS_KEY);
  return Array.isArray(mem) ? (mem as PendingSyncOp[]) : [];
}

export async function savePendingSyncOps(ops: PendingSyncOp[]): Promise<void> {
  memoryMeta.set(META_SYNC_OPS_KEY, ops);
  await idbPut(STORE_META, ops, META_SYNC_OPS_KEY);
}

export async function recordSyncOp(op: PendingSyncOp): Promise<PendingSyncOp[]> {
  const existing = await loadPendingSyncOps();
  const updated = enqueueSyncOp(existing, op);
  await savePendingSyncOps(updated);
  return updated;
}

export async function flushPendingSyncOps(): Promise<void> {
  const ops = await loadPendingSyncOps();
  if (ops.length === 0) return;

  const remaining: PendingSyncOp[] = [];
  for (const op of ops) {
    try {
      if (op.type === 'create_session') {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: op.sessionId, title: op.title }),
        });
        if (!res.ok && res.status >= 500) {
          remaining.push(op);
        }
      } else if (op.type === 'delete_session') {
        const res = await fetch(`/api/sessions/${encodeURIComponent(op.sessionId)}`, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 404 && res.status >= 500) {
          remaining.push(op);
        }
      }
    } catch {
      remaining.push(op);
    }
  }
  await savePendingSyncOps(remaining);
}

export function createClientSessionId(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `session_${hex}`;
}
