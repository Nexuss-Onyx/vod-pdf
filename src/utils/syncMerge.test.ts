import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, ChatSession, DocxAttachment, WorkspaceSnapshot } from '../types/vod';
import {
  enqueueSyncOp,
  mergeSessionMessages,
  mergeWorkspaceSnapshots,
  type PendingSyncOp,
} from './syncMerge';

function makeSession(id: string, updatedAt: string, messageCount = 0): ChatSession {
  return {
    id,
    title: `Title ${id}`,
    createdAt: updatedAt,
    updatedAt,
    messageCount,
    fileCount: 0,
  };
}

function makeFile(id: string, sessionId: string, updatedAt: string): DocxAttachment {
  return {
    id,
    sessionId,
    filename: `${id}.docx`,
    title: id,
    sizeBytes: 512,
    createdAt: updatedAt,
    updatedAt,
    version: 1,
    summary: '',
    pageCountEstimate: 1,
    wordCount: 25,
    source: 'generated',
  };
}

function makeMessage(id: string, sessionId: string, createdAt: string, content: string): ChatMessage {
  return {
    id,
    sessionId,
    role: 'user',
    content,
    createdAt,
  };
}

test('enqueueSyncOp cancels create_session when deleted before syncing', () => {
  const createOp: PendingSyncOp = {
    type: 'create_session',
    sessionId: 'session_local_1',
    title: 'New Chat',
    createdAt: '2026-11-21T10:00:00.000Z',
  };
  const ops = enqueueSyncOp([], createOp);
  assert.equal(ops.length, 1);

  const afterDelete = enqueueSyncOp(ops, {
    type: 'delete_session',
    sessionId: 'session_local_1',
    createdAt: '2026-11-21T10:01:00.000Z',
  });
  assert.equal(afterDelete.length, 0);
});

test('mergeWorkspaceSnapshots preserves unsynced local sessions and suppresses pending deletes', () => {
  const localSnap: WorkspaceSnapshot = {
    sessions: [
      makeSession('session_local_new', '2026-11-21T12:00:00.000Z'),
      makeSession('session_shared', '2026-11-21T11:00:00.000Z', 1),
    ],
    files: [makeFile('file_1', 'session_deleted', '2026-11-21T10:00:00.000Z')],
  };
  const serverSnap: WorkspaceSnapshot = {
    sessions: [
      makeSession('session_shared', '2026-11-21T11:30:00.000Z', 2),
      makeSession('session_deleted', '2026-11-21T10:00:00.000Z', 1),
    ],
    files: [
      makeFile('file_1', 'session_deleted', '2026-11-21T10:00:00.000Z'),
      makeFile('file_2', 'session_shared', '2026-11-21T11:30:00.000Z'),
    ],
  };
  const pendingOps: PendingSyncOp[] = [
    {
      type: 'create_session',
      sessionId: 'session_local_new',
      title: 'Title session_local_new',
      createdAt: '2026-11-21T12:00:00.000Z',
    },
    {
      type: 'delete_session',
      sessionId: 'session_deleted',
      createdAt: '2026-11-21T12:01:00.000Z',
    },
  ];

  const merged = mergeWorkspaceSnapshots(localSnap, serverSnap, pendingOps);
  assert.deepEqual(
    merged.sessions.map((s) => s.id),
    ['session_local_new', 'session_shared'],
  );
  assert.equal(merged.sessions[1].messageCount, 2);
  assert.deepEqual(
    merged.files.map((f) => f.id),
    ['file_2'],
  );
});

test('mergeSessionMessages deduplicates by id and sorts chronologically', () => {
  const local = [
    makeMessage('m1', 's1', '2026-11-21T10:00:00.000Z', 'first'),
    makeMessage('m3', 's1', '2026-11-21T10:02:00.000Z', 'third'),
  ];
  const server = [
    makeMessage('m1', 's1', '2026-11-21T10:00:00.000Z', 'first confirmed'),
    makeMessage('m2', 's1', '2026-11-21T10:01:00.000Z', 'second'),
  ];

  const merged = mergeSessionMessages(local, server);
  assert.deepEqual(
    merged.map((m) => [m.id, m.content]),
    [
      ['m1', 'first confirmed'],
      ['m2', 'second'],
      ['m3', 'third'],
    ],
  );
});
