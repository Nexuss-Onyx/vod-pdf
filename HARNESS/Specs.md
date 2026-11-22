# Vod PDF — DOCX→PDF Engine Replacement Spec

**Status:** Draft specification (no implementation in this document)  
**Scope:** `Vod-Officer/Vod-PDF`  
**Date:** 2026-11-22  
**Authoring intent:** Replace the inherited Vod Word/DOCX engine with a first-class Vod PDF engine. No `.docx` runtime path remains. The third pane must render PDFs with our own PDF engine, not the browser’s built-in PDF viewer.

---

## 1. Goal

Convert `Vod-PDF` from a Vod Word clone into a true autonomous PDF officer:

- All document creation, reading, inspection, search, editing, annotation/commenting, and export flows operate on `.pdf`.
- The third pane is a purpose-built PDF viewer powered by our own rendering engine (in-app renderer), with no `iframe`/`embed`/`object` browser-PDF fallback.
- The agent, system prompt, skills, storage, API, types, and UI speak PDF end-to-end.
- No DOCX runtime dependency, no DOCX file handling, no DOCX-specific UI labels/icons/contracts in the Vod-PDF app.

## 2. Non-Goals (for this replacement)

- Implementing the PDF engine in this task (this is spec only).
- Changing `vod-word/` or the other Vod apps except by reference/learning.
- Replacing Gemini/provider plumbing except where names/contracts are DOCX-coupled.
- Building collaborative multi-user editing beyond existing single-workspace behavior.
- Pixel-perfect fidelity to arbitrary PDF producers beyond the defined render/inspection fidelity targets.

## 3. Current-State Audit (Vod-PDF as-is)

Vod-PDF is currently a rebranded copy of Vod Word. It still contains DOCX naming, types, engine, OOXML tooling, docx-preview rendering, and `.docx` upload/download/inspection paths.

### 3.1 DOCX-coupled surfaces

| Area | Current files | DOCX coupling |
|---|---|---|
| Package/deps | `package.json`, `bun.lock` | `docx`, `docx-preview`, `mammoth`, `jszip` used for DOCX; package name still `react-example` |
| Server entry/routes | `server.ts` | `/api/files/upload` accepts `.docx` ZIP magic `PK`; `/download` sends DOCX MIME; `/inspect` uses `inspectDocxBuffer`; service name `vod-word`; size/error text DOCX-specific |
| Doc engine | `server/docxEngine.ts` | Full DOCX creation/edit/inspect/comment/redline/accept/search implementation using `docx`, `mammoth`, `JSZip`, OOXML XML surgery |
| Doc utils | `server/docxUtils.ts` | DOCX filename sanitize, OOXML XML helpers, comment/tracked-change parsing, OOXML validation |
| Agent | `server/geminiAgent.ts` | Tool names/descriptions `*_docx`; builds DOCX context; calls docx engine; author/labels DOCX |
| Prompt | `server/systemPrompt.ts` | `Vod Word` identity; loads `skills/docx/SKILL.md`; DOCX workflow/rules |
| Store | `server/store.ts` | `.docx` on disk; `saveDocxFile`; seed docs generated via `createDocxFromSpec`; `resolveSafeFilePath` enforces `.docx`; data dir default `vod-word-data` |
| Shared types | `src/types/vod.ts` | `DocxAttachment`, `DocxInspection`, `DocxComment`, `DocxTrackedChange`, `DocxOutlineItem`, `DocxViewerMode`, `wordCount`, `documentXml` |
| App shell | `src/App.tsx` | Imports/uses Docx types and `DocxViewerPane` |
| Chat UI | `src/components/ChatPane.tsx` | `.docx` accept/upload validation, prompt text, starter prompts mention `.docx`, Word icon, attachment labels |
| Viewer | `src/components/DocxViewerPane.tsx` | Uses `docx-preview` `renderAsync`; modes Document/Structure & Redlines/OOXML Source; fetches binary+inspect; Word icon/labels |
| Attachment UI | `src/components/DocxAttachmentCard.tsx`, `AttachmentPopover.tsx`, `AllFilesModal.tsx` | Word icon, `DOCX · size`, `.docx` upload CTA, labels |
| Brand marks | `src/components/VodBrandMarks.tsx` | `WordDocIcon` (Word “W” badge) |
| Format/utils | `src/utils/format.ts`, `src/utils/localWorkspaceDb.ts`, `src/utils/syncMerge.ts` | `DocxAttachment` types, blob cache assumes DOCX inspection shape |
| CSS | `src/index.css` | `.docx-viewer-host` and docx-preview styling |
| Metadata | `metadata.json`, `index.html`, `app.yaml` | Word/DOCX descriptions still present in places |
| Tests | `server/*.test.ts`, `src/utils/*.test.ts` | DOCX fixtures, OOXML assertions, docx store behavior |
| Skills | `skills/docx/`, `skills/pdf/` | `skills/docx` present but should not drive Vod-PDF; `skills/pdf` present and should become authoritative |

### 3.2 Surfaces that can remain largely unchanged

| Area | Keep | Notes |
|---|---|---|
| Session/message workspace model | Keep conceptually | Sessions/messages/SSE/local-first sync are format-agnostic; only attachment/file shape changes |
| SSE event flow | Keep | `workspace_updated`, chat stream events, local-first merge flow remain |
| Local-first cache pattern | Keep pattern | IndexedDB blob/inspection cache stays, but record shape becomes PDF |
| General shell/layout | Keep | Top bar, sidebar, chat layout, brand plum tokens, spacing, motion rules |
| Tailwind/Vite/Express/TS setup | Keep | Update deps/scripts only as needed |
| Gemini streaming orchestration pattern | Keep pattern | Tool loop/streaming/thought/tool events remain; tool contracts change |
| Auth/hosting assumptions | Keep | No change |

## 4. Target Architecture

### 4.1 High-level design

The PDF replacement is split into four layers:

1. **PDF Engine (server-side canonical)** — owns PDF validation, parsing, metadata, text extraction, page rendering inputs, search, create, edit, annotate/comment, fill/sign-lite operations, and output packaging. It produces deterministic artifacts and inspection data.
2. **PDF Viewer Engine (client-side, our own)** — renders PDF pages in the third pane from binary data using an in-app renderer we control (not browser native PDF plugin). It owns viewport, zoom, pagination/continuous scroll, page canvas/text layer, selection hooks, and render telemetry.
3. **Agent + Tooling** — Gemini tools operate on PDF primitives; system prompt loads `skills/pdf/SKILL.md`; tool names and schemas are PDF-native.
4. **Workspace/storage/API** — files stored as `.pdf`, typed as PDF attachments/inspections, served with `application/pdf`, cached locally as PDF blobs.

### 4.2 Canonical format decision

- Canonical stored artifact: **PDF (`.pdf`)**.
- No DOCX upload, no DOCX conversion-to-canonical, no DOCX export, no DOCX preview path in Vod-PDF.
- If a user uploads DOCX, API rejects with a clear message directing them to Vod Word.
- Internal engine may create transient intermediate files in temp dirs for tool execution, but they must never be persisted as workspace artifacts or exposed via API.

### 4.3 “Our own PDF engine, not browser” (third pane)

This requirement applies to the **viewer**. The spec requires:

- The third pane renders pages through an in-app PDF rendering pipeline bundled/controlled by Vod-PDF.
- Allowed: a library renderer embedded in our app where we control canvas/text-layer rendering, viewport, and UI (e.g. PDF.js-based custom viewer implementation owned by us). It must be integrated as our viewer component, not delegated to browser native PDF rendering.
- Not allowed: `<iframe src="...pdf">`, `<embed>`, `<object>`, `window.open` for in-pane viewing, or relying on browser PDF plugin for the third pane.
- The viewer must work from fetched `ArrayBuffer`/Blob data and render into our DOM/canvas.
- Download/open-in-new-tab can still use normal browser file download behavior; that is not “the third pane viewer”.

## 5. File-by-File Change Spec

Legend: **Replace** = major rewrite/same responsibility different format; **Rename/Replace** = rename file and rewrite; **Modify** = targeted changes; **Remove** = delete; **New** = add; **Untouched** = no behavioral change expected.

### 5.1 Top-level / config

| File | Action | Spec |
|---|---:|---|
| `package.json` | Modify | Rename package to `vod-pdf` (or `@vod/pdf`). Remove `docx`, `docx-preview`, `mammoth` deps. Keep `jszip` only if PDF engine needs it for packaged artifacts; otherwise remove. Add chosen PDF engine deps (see §6). Update description/scripts if needed. Ensure no docx-related script remains. |
| `bun.lock` | Regenerate | Regenerated after dependency changes. |
| `metadata.json` | Modify | Description becomes PDF-specific: autonomous PDF officer, real-time office task workspace, integrated PDF reader/viewer. Remove Word/DOCX wording. |
| `index.html` | Modify | Title/description/og tags: “Vod PDF — Autonomous PDF Officer & PDF Workspace”. Remove DOCX/Word workspace copy. |
| `app.yaml` | Modify/Verify | Keep `name: vod-pdf`; add/confirm any env needed by PDF engine. |
| `.env.example` | Modify | Keep `GEMINI_API_KEY`; add PDF engine vars only if required (temp dir, render limits). No docx vars. |
| `tsconfig.json` | Untouched/Modify | Only if new lib types/paths needed. |
| `vite.config.ts` | Untouched/Modify | Only if PDF worker/assets need special handling; if renderer uses worker, ensure build copies/serves worker asset per chosen lib. |
| `.gitignore` | Modify | Ignore PDF temp/render caches if introduced; keep existing. |

### 5.2 Server — remove DOCX engine, add PDF engine

| File | Action | Spec |
|---|---:|---|
| `server/docxEngine.ts` | Remove | Delete after PDF engine parity is in place. No docx engine file remains. |
| `server/docxUtils.ts` | Remove or Rename/Replace | If generic helpers remain, rename to `server/pdfUtils.ts`. Remove all OOXML/comment/tracked-change XML helpers. Keep/replace only generic safe filename/id/byte formatting as PDF equivalents. |
| `server/docxEngine.test.ts` | Remove | Replace with PDF engine tests. |
| `server/docxUtils.test.ts` | Remove/Rename | Replace with `server/pdfUtils.test.ts`. |
| `server/systemPrompt.ts` | Replace | Rename exports/identity to Vod PDF. Load `skills/pdf/SKILL.md` from `skills/pdf`. Prompt defines PDF autonomy, inspect-first, tool workflow, citation/grounding from extracted PDF content, no DOCX/OOXML instructions. Remove `<docx_skill_specification>` and docx references. |
| `server/geminiAgent.ts` | Replace | Rename agent to `runAutonomousPdfAgent` (or equivalent). Replace DOCX tool declarations with PDF tools (§7). Update labels/summaries/context attachment text from `[DOCX...]` to `[PDF...]`. Remove docx engine imports. |
| `server/store.ts` | Replace/Modify heavily | Rename DOCX-specific methods/types to PDF equivalents (`savePdfFile`, `resolveSafeFilePath` -> `.pdf`). Data dir default changes from `vod-word-data` to `vod-pdf-data` (with optional migration read from old env only; do not silently corrupt). Seed workspace creates PDF files via PDF engine. File binaries stored as `.pdf`. Validation rejects path traversal and non-id. Session/message APIs remain. |
| `server/store.test.ts` | Replace | Update fixtures, extensions, MIME assumptions, seed expectations, path safety for `.pdf`. |
| `server.ts` | Modify | Service name `vod-pdf`. Upload endpoint accepts only `.pdf` (magic `%PDF-`), validates size/type, inspects via PDF engine, stores as PDF. Download serves `application/pdf`. Inspect returns PDF inspection. Chat endpoint wires PDF agent. Error messages PDF-specific. Remove all `docx` strings/contracts. |

### 5.3 Shared types / client utils

| File | Action | Spec |
|---|---:|---|
| `src/types/vod.ts` | Replace | Rename `DocxAttachment` -> `PdfAttachment` (or `DocumentAttachment` with `kind:'pdf'`; prefer explicit PDF during migration). Replace DOCX inspection fields with PDF inspection schema (§8). `wordCount` becomes `textWordCount` or `wordCount` with PDF semantics documented; include `pageCount` (actual, not estimate where possible), `title`, `author`, `producer`, `createdAtMeta`, `modifiedAtMeta`, `outline`, `forms`, `annotations/comments`, `textPreview`, `extractionWarnings`, `validation`. Remove `documentXml`, OOXML validation shape, tracked changes OOXML-specific fields unless mapped to PDF annotations/revisions. |
| `src/utils/format.ts` | Modify | Type imports switch to PDF attachment. `categorizeFilesByTime` generic over attachment timestamp fields. Add PDF size/page helpers if needed. |
| `src/utils/format.test.ts` | Modify | Update fixtures to PDF attachment shape. |
| `src/utils/localWorkspaceDb.ts` | Modify | DB name becomes `vod_pdf_local_v1` (already) but record types/inspection shape become PDF. Blob cache stores PDF `ArrayBuffer` + `PdfInspection`. Prefetch endpoints unchanged but payloads PDF. Consider DB version bump/migration strategy for old cached DOCX records: on open, clear incompatible blob/inspection records or ignore them safely. |
| `src/utils/syncMerge.ts` | Modify | Type imports become PDF attachments. Merge semantics unchanged. |
| `src/utils/syncMerge.test.ts` | Modify | Update fixtures. |

### 5.4 Frontend components

| File | Action | Spec |
|---|---:|---|
| `src/App.tsx` | Modify | Replace `DocxViewerPane` with `PdfViewerPane`. Types become PDF. No docx naming in state/handlers. |
| `src/components/DocxViewerPane.tsx` | Rename/Replace -> `PdfViewerPane.tsx` | New third-pane viewer using our own PDF renderer (§9). No `docx-preview`. No OOXML/source XML mode. Modes become PDF-relevant (e.g. Document, Outline/Metadata, Annotations/Forms or equivalent). |
| `src/components/DocxAttachmentCard.tsx` | Rename/Replace -> `PdfAttachmentCard.tsx` | PDF icon, `PDF · size · N pages` label, aria labels PDF. |
| `src/components/AttachmentPopover.tsx` | Modify | Accept `.pdf`; upload CTA “Upload .pdf”; preview/open labels PDF; reject DOCX client-side with clear message. |
| `src/components/AllFilesModal.tsx` | Modify | “PDF document(s)”, PDF icon, metadata display pages/size/date. |
| `src/components/ChatPane.tsx` | Modify | Starter prompts become PDF tasks. Empty state copy PDF. Upload accepts `.pdf`. Error text PDF. Attachment chip/icon PDF. Any “Word/DOCX” strings removed. Input placeholder “Message Vod PDF…” remains. |
| `src/components/VodBrandMarks.tsx` | Modify | Replace `WordDocIcon` with `PdfDocIcon` (PDF-appropriate badge, same visual quality). Keep `VodLogo`. |
| `src/components/TopBar.tsx` | Modify | Comment/copy cleanup: remove “Word Cobalt” hardcoded comment if misleading; lockup already `Vod / PDF`. Hairline gradient should use PDF accent vars, not hardcoded Word blue. |
| `src/components/SessionSidebar.tsx` | Untouched/Modify | Only if it shows DOCX labels; currently session-generic. |
| `src/components/InlineToolTiles.tsx` | Modify | Tool label/icon mapping for PDF tool names (`inspect_pdf`, `create_pdf`, etc.). |
| `src/components/ThinkingCard.tsx` | Untouched | Content-agnostic. |
| `src/index.css` | Modify | Remove `.docx-viewer-host .docx-wrapper...` rules. Add `.pdf-viewer-host` styles for our page canvas stack, text layer, selection, annotation overlays, loading skeletons, and fit-width layout. Keep brand tokens. |

### 5.5 Skills

| File | Action | Spec |
|---|---:|---|
| `skills/pdf/SKILL.md` (+ scripts/references present) | Keep/Make authoritative | This becomes the only skill loaded by `systemPrompt.ts`. Agent instructions must align with it. |
| `skills/docx/` | Remove from Vod-PDF | Delete `skills/docx` directory entirely from Vod-PDF. No docx skill shipped in PDF app. |

### 5.6 Tests

| File | Action | Spec |
|---|---:|---|
| `server/docxEngine.test.ts` | Remove | Replaced by `server/pdfEngine.test.ts`. |
| `server/docxUtils.test.ts` | Remove/Rename | Replaced by `server/pdfUtils.test.ts`. |
| `server/store.test.ts` | Replace | PDF fixtures, `.pdf` paths, seed expectations, migration safety. |
| `src/utils/format.test.ts` | Modify | PDF attachment fixtures. |
| `src/utils/syncMerge.test.ts` | Modify | PDF attachment fixtures. |
| New `server/pdfEngine.test.ts` | New | Core engine contract tests (§11). |
| New `src/components/PdfViewerPane.test.tsx` (or integration test) | New | Viewer renders pages from ArrayBuffer, no browser embed, zoom/fit/page controls. |
| New API/route tests | New | Upload/download/inspect/chat tool wiring for PDF. |

## 6. PDF Engine Spec

### 6.1 Engine responsibilities

The server PDF engine is the canonical document authority. It must provide:

- **Validate/load:** accept `Buffer/ArrayBuffer`, verify `%PDF-` header, parse safely, reject encrypted/unsupported/corrupt files with actionable errors.
- **Inspect:** metadata, page count, page sizes/orientation, outline/bookmarks, form fields, annotations/comments, attachments/embedded files presence, text extraction summary, fonts/images count (best-effort), security/encryption flags, validation warnings.
- **Extract text:** per-page plain text and normalized full text for search/agent grounding. Preserve page boundaries in output.
- **Search:** query across extracted text with page number and snippet context.
- **Create:** generate PDFs from structured spec (cover, headings, paragraphs, lists, tables, key-values, callouts/notes, page breaks, header/footer/page numbers). Output must be valid PDF.
- **Edit:** PDF-native edits supported by chosen engine. At minimum: append pages/blocks, fill form fields, add annotations/comments, merge/split/extract pages, rotate pages, redact where supported. Text replacement in arbitrary existing PDFs must be capability-gated: engine reports supported/unsupported per operation; agent must not claim unsupported edits succeeded.
- **Render support:** provide per-page rasterization or render instructions for the client viewer engine; alternatively client renders directly from bytes using the same PDF library family. Decision must satisfy “our own viewer”.
- **Export/save:** deterministic bytes, stable filename sanitization, versioning in workspace store.

### 6.2 Engine interface contract (spec-level)

The implementation should expose a narrow interface, names illustrative:

- `inspectPdf(buffer, meta) -> PdfInspection`
- `searchPdf(buffer, query, options) -> PdfSearchResult`
- `createPdf(spec) -> { buffer, filename, pageCount, textWordCount, title }`
- `editPdf(buffer, operations) -> { buffer, pageCount, textWordCount, appliedOperations, warnings }`
- `addPdfComment(buffer, input) -> { buffer, commentId, pageNumber, anchored }` (if annotation supported)
- `fillPdfForm(buffer, fields) -> { buffer, filledCount, warnings }` (if AcroForm present)
- `extractPdfPages(buffer, range) -> { buffer, pageCount }`
- `mergePdfs(buffers) -> { buffer, pageCount }`

All methods must be pure with respect to input buffer (no mutation), return new buffers, and include structured errors with machine-readable `code`.

### 6.3 Library/implementation decision

The spec requires an explicit implementation choice during coding, recorded in ADR/comments/tests:

- **Client viewer:** use an in-app PDF renderer (PDF.js or equivalent) with custom UI controls, canvas rendering, and text layer. Bundle worker/assets through Vite; no browser native PDF frame.
- **Server engine:** use a Node-compatible PDF library pair if needed: one for parsing/inspection/extraction (e.g. PDF.js Node build or pdf-lib+extractor), one for generation/edit (e.g. pdf-lib or equivalent). The chosen stack must support the required operations; unsupported operations must be clearly capability-gated.
- **Do not** shell out to unvetted system binaries unless explicitly added to environment; if shelling out (qpdf/pdftk/ghostscript), spec requires documenting availability, sandboxing, timeouts, and tests.

### 6.4 Capability gating

The engine must expose capability metadata:

- `canCreate`, `canExtractText`, `canSearch`, `canRenderPages`, `canFillForms`, `canAddAnnotations`, `canEditExistingText`, `canMerge`, `canSplit`, `canRotate`, `canEncrypt`, `canRedact`.

Agent tools and UI must only offer operations the engine reports as supported. Unsupported requests get a clear explanation and safe alternative (e.g. “I can add an annotation or generate a new PDF, but direct in-place text replacement in this scanned PDF is not supported”).

## 7. Agent / Tooling / Prompt Spec

### 7.1 System prompt

Replace `buildVodWordSystemPrompt()` with `buildVodPdfSystemPrompt()` (or rename consistently). Prompt requirements:

- Identity: **Vod PDF**, autonomous PDF specialist.
- Scope: create/read/inspect/search/edit/fill/annotate/merge/split/extract/organize PDFs as supported by engine.
- Inspect-first rule for existing/attached PDFs.
- No mention of DOCX/OOXML/Word internals.
- Loads `skills/pdf/SKILL.md` as authoritative `<pdf_skill_specification>` (or equivalent tag).
- Tool-use discipline: plan, inspect, act, verify by re-inspecting or summarizing concrete output.

### 7.2 Tool contract replacement

Remove all `*_docx` tools. Add PDF tools. Minimum set:

| Tool | Purpose | Key args | Result |
|---|---|---|---|
| `list_files` | List session/workspace PDF files | `includeAllSessions?` | fileId, filename, title, size, pageCount, textWordCount, summary, version |
| `inspect_pdf` | Parse and summarize PDF | `fileId` | metadata, pageCount, outline, forms, annotations, textPreview, validation, capability notes |
| `search_pdf` | Search text in PDF | `fileId`, `query`, `page?` | matches with page, snippet, score/index |
| `create_pdf` | Create new PDF | `filename`, `title`, spec/blocks | file metadata + attachment |
| `edit_pdf` | Apply supported edits | `fileId`, operations, `newFilename?` | applied ops, warnings, new file |
| `comment_pdf` or `annotate_pdf` | Add annotation/comment | `fileId`, page, anchor/text/rect, comment | comment/annotation id, anchored |
| `fill_pdf_form` | Fill AcroForm fields | `fileId`, fields map | filled count, missing fields |
| `organize_pdf` | Merge/split/extract/rotate | `fileIds`/`fileId`, operation | output file(s) |

Exact schema can be refined, but names must be PDF-native and no docx alias remains.

### 7.3 Agent behavior

- Attachment context in history uses `[PDF: ...]`.
- Created/edited files saved through `savePdfFile`.
- Tool summaries show pages/size, not OOXML redline counts unless PDF revision annotations are implemented.
- Errors surface as actionable PDF errors (encrypted, scanned/no text layer, unsupported edit).

## 8. Data Model Spec

### 8.1 Attachment

Replace `DocxAttachment` with `PdfAttachment`:

- `id: string`
- `sessionId: string`
- `filename: string` (must end `.pdf`)
- `title: string`
- `mimeType: 'application/pdf'` (optional but recommended)
- `sizeBytes: number`
- `createdAt: string`
- `updatedAt: string`
- `version: number`
- `summary: string`
- `pageCount: number` (actual)
- `textWordCount: number` (extracted; 0 if none)
- `source: 'generated' | 'uploaded' | 'edited'`
- `metadataFlags?: { encrypted?: boolean; scannedLikely?: boolean; hasForms?: boolean; hasAnnotations?: boolean }`

### 8.2 Inspection

Replace `DocxInspection` with `PdfInspection`:

- `file: PdfAttachment`
- `pageCount: number`
- `pages: Array<{ pageNumber, width, height, rotation, textWordCount }>`
- `outline: Array<{ title, pageNumber?, level }>`
- `metadata: { title?, author?, subject?, keywords?, creator?, producer?, creationDate?, modificationDate? }`
- `forms: { hasAcroForm, fieldCount, fields: [...] }` (best-effort)
- `annotations: Array<{ id, pageNumber, type, author?, date?, content?, rect? }>`
- `textPreview: string`
- `plainTextByPage?: Array<{ pageNumber, text }>` or omitted from client payload if large; include bounded preview
- `validation: { valid, errors, warnings }`
- `capabilities: { ... }` as §6.4

Remove `documentXml`, `paragraphCount`, `tableCount`, `trackedChanges` OOXML model. If PDF comments/annotations are supported, map them to `annotations`.

### 8.3 Store

- Disk layout: `data/files/<id>.pdf`, `data/index.json`, `data/sessions/<id>.json`.
- `resolveSafeFilePath` enforces `.pdf` suffix.
- `savePdfFile` sanitizes `.pdf` filename.
- Seed files are generated PDFs, not DOCX.
- Old DOCX records/binaries in a reused data dir: do not auto-corrupt; either ignore unknown non-pdf binaries or provide explicit migration path. Spec recommends clean PDF-only store for Vod-PDF; if legacy data is detected, log warning and exclude incompatible files from snapshot.

## 9. Third-Pane PDF Viewer Spec (Our Own Engine)

### 9.1 Requirement

The third pane must be a custom in-app PDF viewer. It must not use browser-native PDF rendering.

### 9.2 Viewer component

`PdfViewerPane.tsx` responsibilities:

- Header: PDF icon, filename, version, size, page count, actions (Edit in Chat, Download, expand/fullscreen, close).
- Mode switcher (PDF-native):
  - **Document** — rendered pages.
  - **Outline & Details** — metadata, outline/bookmarks, page info, forms/annotations summary, validation/warnings.
  - **Text/Extraction** or **Structure** — extracted text preview by page for grounding/debug; optional if covered in Outline. Do not include OOXML.
- Zoom controls: fit width, zoom in/out, preset percentages; keyboard accessible.
- Page navigation: page number indicator, next/prev, jump-to-page, optional thumbnail rail later (not required).
- Rendering: virtualized/efficient page rendering for large PDFs; render visible pages first.

### 9.3 Rendering pipeline

- Fetch PDF binary as `ArrayBuffer` from `/api/files/:id/download?inline=1`.
- Pass bytes to client PDF renderer engine.
- Render each page to canvas (and optional text layer overlay for selection/accessibility/search highlight if supported).
- No `<iframe src="/api/files/...pdf">`.
- No `<object type="application/pdf">`, no `<embed>`.
- Worker configuration must be explicit and bundled for production build.

### 9.4 States

- Loading: skeleton/spinner with “Rendering PDF pages…”.
- Error: actionable message (corrupt, encrypted, unsupported, render failure).
- Empty/no text: still render pages if graphical; extraction panel shows “No extractable text layer”.
- Large file: progressive render; do not block UI thread excessively.

### 9.5 Accessibility

- Viewer region has `aria-label="PDF Reader and Viewer"`.
- Page controls keyboard operable.
- Zoom/read mode buttons have labels and pressed/selected state.
- Text layer, when present, should be selectable/copyable without breaking layout.

## 10. API Spec

All routes remain under `/api`, but contracts become PDF-native.

| Route | Method | Spec change |
|---|---:|---|
| `/api/health` | GET | `{ ok: true, service: 'vod-pdf' }` |
| `/api/workspace` | GET | Snapshot returns `PdfAttachment[]` |
| `/api/events` | GET | Unchanged SSE semantics |
| `/api/sessions` | POST | Unchanged |
| `/api/sessions/:sessionId` | GET | Returns session/messages/files as PDF attachments |
| `/api/sessions/:sessionId` | DELETE | Unchanged |
| `/api/files/upload` | POST | Accept only PDF. Validate `%PDF-` magic. Default filename `Uploaded.pdf`. Error on DOCX/other formats. Returns `{ file: PdfAttachment, inspection: PdfInspection }`. |
| `/api/files/:fileId/download` | GET | Content-Type `application/pdf`; `Content-Disposition` filename `.pdf`; supports inline/attachment. |
| `/api/files/:fileId/inspect` | GET | Returns `PdfInspection`. |
| `/api/chat/stream` | POST | Unchanged transport; agent is PDF agent; produced attachments are PDFs. |

Error contract: `{ error: string, code?: string }`. Do not leak internal stack traces.

## 11. Verification Plan (Programmatic)

No local manual verification is required in this task, but the spec defines what the implementation must pass.

### 11.1 Automated checks

- **Typecheck/lint:** `npm run lint` / `tsc --noEmit` passes with no docx types remaining.
- **Unit tests:** `npm test` or project test runner passes. Replace DOCX tests with PDF tests.
- **Build:** `npm run build` passes; Vite bundles PDF worker/assets correctly.
- **Dependency audit (static):** `package.json` contains no `docx`, `docx-preview`, `mammoth` dependencies.

### 11.2 Required test cases

| ID | Area | Programmatic assertion |
|---|---|---|
| T1 | Upload validation | POST `/api/files/upload` with valid `%PDF-` buffer returns 201 + `PdfAttachment`; with `.docx` or PK ZIP returns 400 with PDF-only error; with random bytes returns 400. |
| T2 | Download | GET download returns `application/pdf`, correct filename, bytes equal stored file. |
| T3 | Inspect | Inspect returns pageCount > 0, validation object, bounded textPreview; no `documentXml` field. |
| T4 | Store paths | Store writes `.pdf` only; path traversal id rejected; no `.docx` filenames accepted/saved. |
| T5 | Agent tools | Tool declarations include PDF tools and exclude all `*_docx`; agent can create a PDF and return attachment metadata. |
| T6 | Viewer | `PdfViewerPane` renders from ArrayBuffer using app renderer; DOM has no `iframe/embed/object` for PDF; page count/zoom controls present; loading/error states work. |
| T7 | UI strings/contracts | No user-facing “DOCX/Word document/docx-preview/OOXML” strings in Vod-PDF UI except historical migration notes if any; upload accepts `.pdf`. |
| T8 | Search | `search_pdf` returns page/snippet matches for text PDFs; scanned/no-text PDF returns empty matches + warning. |
| T9 | Capability gating | Unsupported edit operation returns structured unsupported error; agent surfaces it clearly. |
| T10 | Local cache | IndexedDB blob cache stores/loads PDF inspection; old incompatible cached records do not crash app. |

### 11.3 Grep/contract checks

Programmatic grep checks over `Vod-PDF` (excluding generated dirs) should return no matches for:

- `docx-preview`
- `mammoth`
- `from 'docx'` / `"docx"`
- `DocxAttachment` / `DocxInspection` / `DocxViewerPane`
- `word/document.xml`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `accept=".docx"`

Allowed exceptions: this spec file if stored in-repo, and historical git commit messages. The runtime codebase should be clean.

## 12. Migration / Rollout Notes

- **Data dir:** default new dir `vod-pdf-data` (or `vod-pdf`-specific env). If reusing old volume, detect and ignore legacy `.docx` artifacts; do not attempt lossy auto-conversion silently.
- **Client cache:** bump IndexedDB DB name or version; clear/migrate incompatible stores.
- **Seed content:** regenerate seeded sample documents as PDFs on first init when store is empty.
- **Backwards compatibility:** not required for DOCX files inside Vod-PDF. Compatibility is preserved at session/message UX level where possible.

## 13. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Arbitrary PDF text editing is hard | Agent may overpromise | Capability-gate edits; support annotation/fill/create/reorganize reliably; report unsupported in-place text edits clearly. |
| Scanned PDFs have no text layer | Search/inspect limited | Detect likely scanned; return warning; OCR is future capability behind flag, not required now. |
| Large PDF render performance | UI jank | Virtualize pages, render visible pages, use worker, cache page bitmaps cautiously. |
| Browser-native PDF leak | Violates requirement | CI grep/test for iframe/embed/object/pdf plugin patterns in viewer; render via canvas. |
| Encrypted/password PDFs | Upload/inspect failure | Detect and return explicit unsupported error; do not crash. |

## 14. Acceptance Criteria

This replacement is complete when:

1. A user can upload/create/open/download/search/inspect a PDF in Vod-PDF end-to-end.
2. The third pane renders PDFs via our own in-app renderer, with no browser PDF embed.
3. No DOCX engine, DOCX dependency, DOCX API contract, or DOCX UI path remains in Vod-PDF runtime code.
4. Agent tools are PDF-native and grounded by `skills/pdf`.
5. Programmatic checks in §11 pass.
