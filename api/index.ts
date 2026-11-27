import 'dotenv/config';
import type { Express, Request, Response } from 'express';
import { createVodPdfApp } from '../server/app.ts';
import { workspaceStore } from '../server/store.ts';

let appPromise: Promise<Express> | null = null;

function getVodPdfApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = workspaceStore
      .init()
      .then(() => createVodPdfApp(workspaceStore))
      .catch((err) => {
        appPromise = null;
        throw err;
      });
  }
  return appPromise;
}

export default async function handler(req: Request, res: Response): Promise<void> {
  const app = await getVodPdfApp();
  app(req, res);
}
