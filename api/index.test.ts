import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { Request, Response } from 'express';
import handler from './index.ts';

function runWithServer(
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    void handler(req as unknown as Request, res as unknown as Response);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      try {
        await fn(`http://127.0.0.1:${port}`);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

test('Vercel api/index handler initializes workspace and serves /api/health and /api/workspace', async () => {
  await runWithServer(async (baseUrl) => {
    const [healthRes, workspaceRes] = await Promise.all([
      fetch(`${baseUrl}/api/health`),
      fetch(`${baseUrl}/api/workspace`),
    ]);

    assert.equal(healthRes.status, 200);
    assert.deepEqual(await healthRes.json(), { ok: true, service: 'vod-pdf' });

    assert.equal(workspaceRes.status, 200);
    const snap = (await workspaceRes.json()) as {
      sessions: Array<{ id: string }>;
      files: Array<{ id: string; filename: string }>;
    };
    assert.ok(snap.sessions.length >= 1);
    assert.ok(snap.files.some((f) => f.filename.endsWith('.pdf')));
  });
});

test('Vercel /api/events responds immediately in serverless mode without hanging', async () => {
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    await runWithServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/events`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
      const body = await res.text();
      assert.match(body, /"mode":"serverless"/);
    });
  } finally {
    if (previousVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = previousVercel;
    }
  }
});
