import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC_ROOT = path.resolve(process.cwd(), 'src');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

test('PdfViewerPane renders PDFs with the in-app engine, never a browser PDF embed', () => {
  const source = readSource('components/PdfViewerPane.tsx');

  // Uses our bundled pdf.js renderer + explicit worker.
  assert.match(source, /from 'pdfjs-dist'/);
  assert.match(source, /pdf\.worker\.min\.mjs\?url/);
  assert.match(source, /GlobalWorkerOptions\.workerSrc/);
  assert.match(source, /page\.render\(/);
  assert.match(source, /TextLayer/);
  assert.match(source, /ArrayBuffer|arrayBuffer/);

  // No browser-native PDF fallbacks.
  const forbidden = [/<iframe/i, /<embed/i, /<object[\s>]/i, /window\.open\(/i, /type="application\/pdf"/i];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(source), false, `viewer must not use ${pattern}`);
  }
});

test('PdfViewerPane exposes PDF-native modes, zoom, and page navigation', () => {
  const source = readSource('components/PdfViewerPane.tsx');
  assert.match(source, /aria-label="PDF Reader and Viewer"/);
  assert.match(source, /Outline &amp; Details/);
  assert.match(source, /aria-label="Zoom in PDF"/);
  assert.match(source, /aria-label="Zoom out PDF"/);
  assert.match(source, /aria-label="Previous page"/);
  assert.match(source, /aria-label="Next page"/);
  assert.match(source, /Jump to page/);
  assert.match(source, /Rendering PDF pages/);
  assert.match(source, /could not be rendered/);
});

test('the app shell mounts the PDF viewer and PDF types', () => {
  const app = readSource('App.tsx');
  assert.match(app, /import \{ PdfViewerPane \}/);
  assert.match(app, /<PdfViewerPane/);
  assert.equal(/DocxViewerPane|DocxAttachment/.test(app), false);
  assert.match(app, /data-vod-app="pdf"/);
});

test('no DOCX runtime contracts remain in client source', () => {
  const forbidden = [
    /docx-preview/,
    /\bmammoth\b/,
    /from 'docx'/,
    /DocxAttachment/,
    /DocxInspection/,
    /DocxViewerPane/,
    /word\/document\.xml/,
    /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/,
    /accept="\.docx"/,
  ];

  const walk = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(ts|tsx|css)$/.test(entry.name) ? [full] : [];
    });
  };

  const selfPath = path.resolve(process.cwd(), 'src/components/pdfViewerContract.test.ts');
  for (const file of walk(SRC_ROOT)) {
    if (path.resolve(file) === selfPath) continue; // this test names the forbidden patterns
    const relative = path.relative(process.cwd(), file);
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(content), false, `${relative} still references ${pattern}`);
    }
  }
});

test('index.css defines the PDF page and text-layer presentation', () => {
  const css = readSource('index.css');
  assert.match(css, /\.pdf-viewer-host/);
  assert.match(css, /\.pdf-page\b/);
  assert.match(css, /\.pdf-text-layer/);
  assert.equal(/docx-viewer-host/.test(css), false);
});
