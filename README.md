# Vod PDF

Autonomous PDF officer, real-time office task workspace, and integrated in-app PDF reader and viewer.

## Local Development

```bash
npm install
npm run dev
```

Set `GEMINI_API_KEY` in `.env` (see `.env.example`).

## Deploying to Vercel

This repository is preconfigured for Vercel (`vercel.json` + `api/index.ts`):

- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Serverless API**: `api/index.ts` handles all `/api/*` routes via Node.js 22.x and bundles `skills/pdf/**` plus `pdfjs-dist` standard fonts.

### Required Environment Variables on Vercel

In **Project Settings → Environment Variables**, add:

- `GEMINI_API_KEY` — Your Google Gemini API key (required for `/api/chat/stream` AI operations).

### Deploy with Vercel CLI

```bash
npm i -g vercel
vercel
vercel --prod
```

### Serverless Notes

- **Local-first persistence**: Browser sessions, messages, and PDF binaries are cached locally in IndexedDB, while the serverless API stores workspace state in `/tmp/vod-pdf-data` (ephemeral across cold starts).
- **Upload size**: Vercel Serverless Functions enforce a 4.5 MB HTTP request payload limit on `/api/files/upload`.
