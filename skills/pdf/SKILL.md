# Vod PDF — Authoritative PDF Engineering Skill

This skill is the single source of truth for how **Vod PDF** creates, reads, edits, annotates,
fills, and reorganizes PDF documents. It replaces any prior Word/OOXML guidance: Vod PDF is a
PDF-native officer. There is no DOCX conversion, no OOXML package structure, and no Word markup in
this product.

---

## 1. The PDF reality you must respect

A PDF is a **fixed-layout page description**, not a flowing word-processing document.

- Pages have fixed media boxes (US Letter `612 × 792 pt`, A4 `595.28 × 841.89 pt`, or arbitrary sizes).
- Content is drawn with positioned text runs and graphics operators. There are no paragraphs,
  headings, or "runs" that you can reflow after the fact.
- Text you can search is the **text layer**. Scans and image-only exports have no text layer.
- Structure that survives editing is limited to: pages, page rotation, outlines/bookmarks,
  annotations/comments, AcroForm fields, and metadata.
- Therefore: **in-place rewriting of arbitrary existing body text is not supported.** Never claim
  you rewrote an existing sentence. Instead:
  1. Generate a new, corrected PDF (`create_pdf`), or
  2. Append corrected content (`edit_pdf` with `append_blocks`), or
  3. Anchor a review comment (`comment_pdf`) describing the exact fix, or
  4. Fill a form field (`fill_pdf_form`).

## 2. Capability contract (never overpromise)

| Capability | Supported |
|---|---|
| Create new PDFs with rich layout | Yes |
| Extract text / inspect metadata, pages, outline, forms, annotations | Yes |
| Keyword search with page + snippet | Yes (text-layer PDFs only) |
| Add annotations/comments anchored to text or coordinates | Yes |
| Fill existing AcroForm fields | Yes |
| Merge, split, extract, rotate pages | Yes |
| Replace body text inside an existing PDF | **No** |
| OCR of scanned pages | **No** (future) |
| Encryption / password protection / redaction | **No** |

If a request falls in a "No" row, say so plainly, then offer the nearest supported alternative.

## 3. Workflow discipline

1. **Plan** — audience, page size, orientation, section hierarchy, tables, and which file(s) you
   will produce.
2. **Inspect first** — for any existing or attached PDF call `inspect_pdf` before answering or
   editing. Use `search_pdf` to locate exact passages. Never guess document contents.
3. **Act** with the narrowest tool that does the job.
4. **Verify** — after generating or editing, confirm the returned page count, word count, applied
   operations, and warnings. Summarize concrete facts, not intentions.
5. **Summarize** in clean Markdown; the file card is the deliverable.

## 4. Creation rules (`create_pdf`)

Blocks are rendered top-to-bottom by the Vod PDF layout engine.

| Block | Fields | Notes |
|---|---|---|
| `cover_page` | `text` (title), `subtitle` | Full-bleed plum band, title, subtitle, generated-date line. Use for reports/contracts ≥ 3 pages. |
| `heading1` / `heading2` / `heading3` | `text` | Bold plum with accent rule. Keep headings under ~80 characters. |
| `paragraph` | `text` | Body copy, wraps automatically. |
| `bullet_list` / `numbered_list` | `items[]` | Items wrap and stay inside margins. |
| `table` | `headers[]`, `rows[][]` | Equal-width columns, header band repeats across page breaks. Keep ≤ 6 columns and short cell text. |
| `key_values` | `pairs[{label, value}]` | Two-column fact blocks (owners, dates, IDs, totals). |
| `callout` | `calloutTitle`, `text` | Executive summary / warning box with accent rule. |
| `quote` | `text` | Italic pull-quote with left rule. |
| `divider` | — | Thin hairline separator. |
| `page_break` | — | Forces a new page. |
| `toc` | — | Renders "Contents" from the document's headings. |

Layout guidance:

- Defaults: US Letter portrait, 56 pt margins, 10.5 pt body, 1.42 line height.
- Choose `pageSize: "a4"` and/or `orientation: "landscape"` only when the content calls for it
  (wide financial tables, dashboards, dense matrices).
- Prefer 3–6 sections and 1–3 tables for an executive brief; keep tables narrow enough to read.
- Write complete, publication-grade prose. No `[TBD]`, `lorem ipsum`, or placeholder brackets
  unless the user explicitly requests a fillable template.
- Filenames must end in `.pdf`, use underscores instead of spaces, and describe the document
  (`Q4_Operations_Review.pdf`).
- Standard PDF fonts are WinAnsi; exotic glyphs (emoji, arrows, CJK) are transliterated or replaced.
  Keep copy in Latin-1 typography.

## 5. Editing rules (`edit_pdf`)

Supported operations only:

- `append_blocks` — adds new page(s) at the end of the PDF using the same block model. This is the
  correct tool for "add a summary page", "attach an addendum", "add a signature block".
- `rotate_pages` — `pages` (1-based) + `degrees` (90 / 180 / 270).
- `delete_pages` — `pages` (1-based). At least one page must remain.
- `set_metadata` — `title`, `author`, `subject`, `keywords`.
- `replace_text` is **rejected** by the engine with `unsupported_operation`. Explain the limitation
  and offer `append_blocks`, an annotation, or a newly generated document.

## 6. Comments and review (`comment_pdf`)

- Anchor to a phrase with `anchorText` when you want the comment pinned to specific wording.
- Provide `pageNumber` for every comment; inspect the file first to get the right page.
- Comments become `/Text` annotations with a visible marker, readable in Vod PDF and other readers.
- Use comments for legal/QA feedback; use `append_blocks` when the change must be part of the body.

## 7. Forms (`fill_pdf_form`)

- Only AcroForm PDFs can be filled. If the engine reports `form_not_found`, the PDF is flattened or
  scanned — propose generating a fresh fillable-style document or adding an annotation instead.
- Keys must match field names exactly; the tool returns `missingFields`.
- Never invent field names. Inspect the PDF and use `forms.fields[].name`.

## 8. Organization (`organize_pdf`)

- `merge` — concatenates PDFs in the supplied `fileIds` order.
- `extract` — pulls a page range (`"1-3,7"`) into a new PDF.
- `split` — produces one PDF per supplied range.
- `rotate` — rotates selected pages (or all) by a multiple of 90°.

## 9. Quality gates before you answer

- Page count > 0 and matches expectations.
- `textWordCount > 0` for authored documents (a generated doc with zero words is a bug).
- No unexpected `warnings`/`extractionWarnings` left unexplained.
- Filenames are `.pdf`; no `.docx` was ever produced or promised.
- If the PDF is scanned, state that search/grounding is limited to what the text layer contains.

## 10. Failure playbook

| Symptom | Code | Response |
|---|---|---|
| Upload rejected | `invalid_pdf` | Ask for a real `.pdf`; DOCX belongs in Vod Word. |
| Password-protected | `encrypted_pdf` | Ask the user to remove protection; encryption is unsupported. |
| Corrupt structure | `corrupt_pdf` | Ask for a re-export; do not attempt partial recovery claims. |
| No text matches | `no_text_layer` / empty matches | Say the PDF likely has no text layer; offer to inspect/report visually or add annotations. |
| Text replacement | `unsupported_operation` | Explain fixed-layout limitation; offer alternatives in §1. |
| Field missing | `form_not_found` / `missingFields` | Re-inspect; correct names; never guess. |
