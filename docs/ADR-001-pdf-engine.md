# ADR 001 — Vod PDF document engine and viewer stack

- **Status:** Accepted
- **Date:** 2026-11-22
- **Supersedes:** the inherited Vod Word DOCX engine (`docx`, `docx-preview`, `mammoth`, JSZip OOXML surgery)

## Context

Vod PDF must be a PDF-native officer: create/read/inspect/search/edit/annotate/organize `.pdf`
documents, and render them in the third pane through an in-app engine rather than the browser's
native PDF plugin. The previous implementation was a rebranded Word clone operating on DOCX ZIP
packages and OOXML XML.

## Decision

1. **Server document engine: `pdf-lib` (generation/edit) + `pdfjs-dist` legacy build (parse,
   inspect, text extraction).**
   - `pdf-lib` owns page creation, the Vod layout composer, annotations, AcroForm filling,
     metadata, merge/split/extract/rotate and serialization.
   - `pdfjs-dist`'s Node (legacy) build provides the authoritative reader: page count/geometry,
     text layer extraction, outline resolution, form/annotation discovery and metadata.
   - Both are pure JavaScript with no system binaries, no shell-outs, and no OCR dependency.
   - Unsupported in-place body-text rewriting is a deliberate capability gap: `replace_text`
     returns `unsupported_operation` with alternatives (append, annotate, fill, regenerate).

2. **Client viewer: bundled `pdfjs-dist` renderer driven by our own `PdfViewerPane`.**
   - PDF bytes are fetched as an `ArrayBuffer` (local-first cache when available) and rendered to
     `<canvas>` per page with a selectable text layer.
   - The worker is an explicit build asset (`pdf.worker.min.mjs?url` →
     `GlobalWorkerOptions.workerSrc`), so production bundles ship it.
   - No `<iframe>`, `<embed>`, `<object>`, `window.open`, or browser PDF plugin is used for the
     third pane. Download/open-in-new-tab remain normal browser file downloads.
   - Our component owns zoom, fit-width, page navigation, virtualization via
     `IntersectionObserver`, loading/error states, and the Outline/Text modes.

3. **Capability gating is part of the public contract.**
   `PDF_CAPABILITIES` is returned with every inspection and surfaced in the viewer and to the
   agent, so unsupported requests (text replacement, encryption, redaction, OCR) are answered
   honestly instead of being over-promised.

## Consequences

- DOCX input is rejected at the API boundary with a pointer to Vod Word; no conversion path exists.
- Legacy data directories containing DOCX artifacts are read defensively: non-`.pdf` records are
  dropped with a warning instead of being served or silently converted.
- Scanned PDFs are detected (`textWordCount` below the page-count threshold) and flagged; they can
  be rendered and annotated, but not searched.
- Large PDFs render progressively (visible pages first) to keep the UI thread responsive.
