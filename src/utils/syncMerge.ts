import type {
  ChatMessage,
  ChatSession,
  DocxAttachment,
  WorkspaceSnapshot,
} from '../types/vod';

export type PendingSyncOp =
  | {
      type: 'create_session';
      sessionId: string;
      title: string;
      createdAt: string;
    }
  | {
      type: 'delete_session';
      sessionId: string;
      createdAt: string;
    };

export function enqueueSyncOp(ops: PendingSyncOp[], next: PendingSyncOp): PendingSyncOp[] {
  if (next.type === 'delete_session') {
    const hadPendingCreate = ops.some(
      (op) => op.type === 'create_session' && op.sessionId === next.sessionId,
    );
    const filtered = ops.filter((op) => op.sessionId !== next.sessionId);
    // If the session was created locally and never synced yet, cancelling both leaves no server op needed.
    return hadPendingCreate ? filtered : [...filtered, next];
  }

  // create_session: avoid duplicate create ops for the same sessionId
  const withoutSame = ops.filter((op) => op.sessionId !== next.sessionId);
  return [...withoutSame, next];
}

export function mergeWorkspaceSnapshots(
  localSnap: WorkspaceSnapshot,
  serverSnap: WorkspaceSnapshot,
  pendingOps: PendingSyncOp[],
): WorkspaceSnapshot {
  const pendingDeleteIds = new Set(
    pendingOps.filter((op) => op.type === 'delete_session').map((op) => op.sessionId),
  );
  const pendingCreateIds = new Set(
    pendingOps.filter((op) => op.type === 'create_session').map((op) => op.sessionId),
  );

  const sessionMap = new Map<string, ChatSession>();
  for (const s of serverSnap.sessions) {
    if (!pendingDeleteIds.has(s.id)) {
      sessionMap.set(s.id, s);
    }
  }
  for (const s of localSnap.sessions) {
    if (pendingDeleteIds.has(s.id)) continue;
    const existing = sessionMap.get(s.id);
    if (!existing) {
      if (pendingCreateIds.has(s.id)) {
        sessionMap.set(s.id, s);
      }
    } else if (s.updatedAt > existing.updatedAt && s.messageCount >= existing.messageCount) {
      sessionMap.set(s.id, s);
    }
  }

  const fileMap = new Map<string, DocxAttachment>();
  for (const f of serverSnap.files) {
    if (!pendingDeleteIds.has(f.sessionId)) {
      fileMap.set(f.id, f);
    }
  }
  for (const f of localSnap.files) {
    if (pendingDeleteIds.has(f.sessionId)) continue;
    if (!fileMap.has(f.id)) {
      fileMap.set(f.id, f);
    }
  }

  return {
    sessions: Array.from(sessionMap.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
    files: Array.from(fileMap.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

export function mergeSessionMessages(
  localMsgs: ChatMessage[],
  serverMsgs: ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of localMsgs) {
    byId.set(m.id, m);
  }
  for (const m of serverMsgs) {
    byId.set(m.id, m);
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
