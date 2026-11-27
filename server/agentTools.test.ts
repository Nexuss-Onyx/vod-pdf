import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DECLARATIONS } from './geminiAgent.ts';
import { buildVodPdfSystemPrompt } from './systemPrompt.ts';

test('agent tool declarations are PDF-native and contain no DOCX aliases', () => {
  const names = TOOL_DECLARATIONS.map((tool) => tool.name || '');

  for (const expected of [
    'list_files',
    'inspect_pdf',
    'search_pdf',
    'create_pdf',
    'edit_pdf',
    'comment_pdf',
    'fill_pdf_form',
    'organize_pdf',
  ]) {
    assert.ok(names.includes(expected), `missing PDF tool "${expected}"`);
  }

  assert.equal(names.some((name) => /_docx$/.test(name) || name.includes('docx')), false);

  const serialized = JSON.stringify(TOOL_DECLARATIONS);
  assert.equal(/docx/i.test(serialized), false);
  assert.match(serialized, /\.pdf/);
});

test('system prompt is Vod PDF, loads Anthropic PDF skill, and forbids DOCX guidance', () => {
  const prompt = buildVodPdfSystemPrompt();

  assert.match(prompt, /You are \*\*Vod PDF\*\*/);
  assert.match(prompt, /<pdf_skill_specification>/);
  assert.match(prompt, /PDF Processing Guide/);
  assert.match(prompt, /FORMS\.md/);
  assert.match(prompt, /REFERENCE\.md/);
  assert.match(prompt, /fixed-layout/i);
  assert.match(prompt, /create_pdf/);
  assert.match(prompt, /inspect_pdf/);
  assert.match(prompt, /add_watermark/);
  assert.match(prompt, /crop_pages/);

  assert.equal(/word\/document\.xml|docx_skill_specification|<w:p|<w:r\b|Vod Word/i.test(prompt), false);
  // DOCX is only ever mentioned as an explicitly rejected format, never as an instruction.
  assert.equal(/create_docx|edit_docx|inspect_docx|search_docx/.test(prompt), false);
});
