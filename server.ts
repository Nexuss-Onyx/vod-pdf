import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createVodPdfApp } from './server/app.ts';
import { workspaceStore } from './server/store.ts';

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  await workspaceStore.init();

  const app = createVodPdfApp(workspaceStore);

  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event === 'start';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vod PDF server running on http://0.0.0.0:${PORT}`);
  });

  const handleShutdown = async () => {
    await workspaceStore.flush();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => void handleShutdown());
  process.on('SIGINT', () => void handleShutdown());
}

startServer().catch((err) => {
  console.error('Failed to start Vod PDF server:', err);
  process.exit(1);
});
