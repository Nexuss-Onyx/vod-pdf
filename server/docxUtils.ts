import path from 'node:path';

export interface ParsedDocxComment {
  id: string;
  author: string;
  date: string;
  text: string;
}

export interface ParsedTrackedChange {
  id: string;
  type: 'insertion' | 'deletion';
  author: string;
  date: string;
  text: string;
}

export function sanitizeDocxFilename(input: string, fallback = 'Document.docx'): string {
  const base = path.basename(input || '').replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_').trim();
  if (!base || /^\.+$/.test(base)) {
    return fallback;
  }
  const normalized = base.replace(/\s+/g, '_');
  if (normalized.toLowerCase().endsWith('.docx')) {
    return normalized;
  }
  return `${normalized}.docx`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function unescapeXml(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

export function isValidEntityId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{2,80}$/.test(id);
}

/**
 * Strips noisy Word revision metadata (rsid*, proofErr, bookmark clutter optional)
 * and coalesces adjacent <w:r> elements that share identical <w:rPr> formatting
 * inside each <w:p>, mirroring skills/docx/scripts/merge_runs.py.
 */
export function mergeAdjacentRunsInXml(documentXml: string): string {
  let cleaned = documentXml
    .replace(/\s+w:rsidR="[^"]*"/g, '')
    .replace(/\s+w:rsidRPr="[^"]*"/g, '')
    .replace(/\s+w:rsidP="[^"]*"/g, '')
    .replace(/\s+w:rsidSect="[^"]*"/g, '')
    .replace(/\s+w:rsidDel="[^"]*"/g, '')
    .replace(/<w:proofErr\b[^>]*\/>/g, '');

  // Merge adjacent plain text runs inside paragraphs when their <w:rPr> matches exactly.
  cleaned = cleaned.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    // Repeatedly coalesce adjacent simple <w:r> elements with identical <w:rPr> and single <w:t>
    const runPairRegex =
      /(<w:r\b[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t><\/w:r>)(<w:r\b[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t><\/w:r>)/g;

    let current = paragraphXml;
    let changed = true;
    let guard = 0;
    while (changed && guard < 25) {
      changed = false;
      guard++;
      current = current.replace(
        runPairRegex,
        (full, _r1, rPr1 = '', t1, _r2, rPr2 = '', t2) => {
          if (rPr1 !== rPr2) {
            return full;
          }
          changed = true;
          const combined = `${t1}${t2}`;
          const needsPreserve = /^\s|\s$/.test(combined);
          const tAttrs = needsPreserve ? ' xml:space="preserve"' : '';
          return `<w:r>${rPr1}<w:t${tAttrs}>${combined}</w:t></w:r>`;
        },
      );
    }
    return current;
  });

  return cleaned;
}

/**
 * Replaces target text inside <w:t> elements within document.xml.
 * When trackedChange is true, emits OOXML <w:del> + <w:ins> elements compliant with
 * ISO/IEC 29500 and skills/docx/SKILL.md.
 */
export function applyTextEditInXml(
  documentXml: string,
  findText: string,
  replaceText: string,
  options: {
    trackedChange?: boolean;
    author?: string;
    dateIso?: string;
    startId?: number;
  } = {},
): { xml: string; replacements: number } {
  if (!findText) {
    return { xml: documentXml, replacements: 0 };
  }

  const merged = mergeAdjacentRunsInXml(documentXml);
  const tracked = Boolean(options.trackedChange);
  const author = escapeXml(options.author || 'Vod Word');
  const dateIso = escapeXml(options.dateIso || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  let revId = options.startId ?? 100;
  let replacements = 0;

  const escapedFind = escapeXml(findText);
  const escapedReplace = escapeXml(replaceText);

  const runRegex = /<w:r\b[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t><\/w:r>/g;

  const updated = merged.replace(runRegex, (fullRun, rPr = '', runText: string) => {
    if (!runText.includes(escapedFind)) {
      return fullRun;
    }

    const parts = runText.split(escapedFind);
    const occurrences = parts.length - 1;
    replacements += occurrences;

    if (!tracked) {
      const nextText = parts.join(escapedReplace);
      const spaceAttr = /^\s|\s$/.test(nextText) ? ' xml:space="preserve"' : '';
      return `<w:r>${rPr}<w:t${spaceAttr}>${nextText}</w:t></w:r>`;
    }

    // Tracked changes mode: emit prefix run, <w:del>, <w:ins>, suffix run
    const chunks: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) {
        const sp = /^\s|\s$/.test(parts[i]) ? ' xml:space="preserve"' : '';
        chunks.push(`<w:r>${rPr}<w:t${sp}>${parts[i]}</w:t></w:r>`);
      }
      if (i < parts.length - 1) {
        const delId = revId++;
        const insId = revId++;
        const delSp = /^\s|\s$/.test(escapedFind) ? ' xml:space="preserve"' : '';
        chunks.push(
          `<w:del w:id="${delId}" w:author="${author}" w:date="${dateIso}"><w:r>${rPr}<w:delText${delSp}>${escapedFind}</w:delText></w:r></w:del>`,
        );
        if (escapedReplace) {
          const insSp = /^\s|\s$/.test(escapedReplace) ? ' xml:space="preserve"' : '';
          chunks.push(
            `<w:ins w:id="${insId}" w:author="${author}" w:date="${dateIso}"><w:r>${rPr}<w:t${insSp}>${escapedReplace}</w:t></w:r></w:ins>`,
          );
        }
      }
    }
    return chunks.join('');
  });

  return { xml: updated, replacements };
}

export function acceptTrackedChangesInXml(documentXml: string): {
  xml: string;
  acceptedInsertions: number;
  acceptedDeletions: number;
} {
  let acceptedInsertions = 0;
  let acceptedDeletions = 0;

  let next = documentXml.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, () => {
    acceptedDeletions++;
    return '';
  });

  // Remove deleted paragraph markers inside <w:pPr><w:rPr><w:del .../></w:rPr></w:pPr>
  next = next.replace(/<w:del\b[^>]*\/>/g, () => {
    acceptedDeletions++;
    return '';
  });

  // Unwrap <w:ins ...>...</w:ins> keeping inner content
  next = next.replace(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g, (_m, inner: string) => {
    acceptedInsertions++;
    return inner;
  });

  return { xml: next, acceptedInsertions, acceptedDeletions };
}

export function extractCommentsFromXml(commentsXml: string): ParsedDocxComment[] {
  if (!commentsXml) return [];
  const results: ParsedDocxComment[] = [];
  const commentRegex = /<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g;
  let match: RegExpExecArray | null;
  while ((match = commentRegex.exec(commentsXml)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const idMatch = attrs.match(/w:id="([^"]*)"/);
    const authorMatch = attrs.match(/w:author="([^"]*)"/);
    const dateMatch = attrs.match(/w:date="([^"]*)"/);

    const texts: string[] = [];
    const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(body)) !== null) {
      texts.push(unescapeXml(tMatch[1]));
    }

    results.push({
      id: idMatch?.[1] ?? String(results.length),
      author: unescapeXml(authorMatch?.[1] ?? 'Reviewer'),
      date: dateMatch?.[1] ?? '',
      text: texts.join(' ').trim(),
    });
  }
  return results;
}

export function extractTrackedChangesFromXml(documentXml: string): ParsedTrackedChange[] {
  if (!documentXml) return [];
  const changes: ParsedTrackedChange[] = [];

  const insRegex = /<w:ins\b([^>]*)>([\s\S]*?)<\/w:ins>/g;
  let m: RegExpExecArray | null;
  while ((m = insRegex.exec(documentXml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const id = attrs.match(/w:id="([^"]*)"/)?.[1] ?? String(changes.length);
    const author = unescapeXml(attrs.match(/w:author="([^"]*)"/)?.[1] ?? 'Editor');
    const date = attrs.match(/w:date="([^"]*)"/)?.[1] ?? '';
    const text = Array.from(inner.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
      .map((x) => unescapeXml(x[1]))
      .join('');
    if (text) {
      changes.push({ id, type: 'insertion', author, date, text });
    }
  }

  const delRegex = /<w:del\b([^>]*)>([\s\S]*?)<\/w:del>/g;
  while ((m = delRegex.exec(documentXml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const id = attrs.match(/w:id="([^"]*)"/)?.[1] ?? String(changes.length);
    const author = unescapeXml(attrs.match(/w:author="([^"]*)"/)?.[1] ?? 'Editor');
    const date = attrs.match(/w:date="([^"]*)"/)?.[1] ?? '';
    const text = Array.from(inner.matchAll(/<w:delText\b[^>]*>([\s\S]*?)<\/w:delText>/g))
      .map((x) => unescapeXml(x[1]))
      .join('');
    if (text) {
      changes.push({ id, type: 'deletion', author, date, text });
    }
  }

  return changes;
}

export function validateOoxmlPackageEntries(
  entries: Record<string, string | Uint8Array>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const names = Object.keys(entries);

  for (const name of names) {
    if (name.endsWith('/')) {
      errors.push(`ZIP archive contains directory entry "${name}" which violates cloud Word compatibility.`);
    }
  }

  const requiredParts = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'];
  for (const req of requiredParts) {
    if (!(req in entries)) {
      errors.push(`Missing required OOXML part: ${req}`);
    }
  }

  const docXml = entries['word/document.xml'];
  if (typeof docXml === 'string') {
    if (!docXml.includes('<w:document') || !docXml.includes('<w:body')) {
      errors.push('word/document.xml is missing <w:document> or <w:body> root elements.');
    }
    const openBodies = (docXml.match(/<w:body\b/g) ?? []).length;
    const closeBodies = (docXml.match(/<\/w:body>/g) ?? []).length;
    if (openBodies !== closeBodies) {
      errors.push('Unbalanced <w:body> tags in word/document.xml.');
    }
    const openPs = (docXml.match(/<w:p(?:\s|>)/g) ?? []).length;
    const closePs = (docXml.match(/<\/w:p>/g) ?? []).length;
    if (openPs !== closePs) {
      errors.push(`Unbalanced <w:p> paragraph tags (${openPs} open vs ${closePs} close).`);
    }
  }

  return { valid: errors.length === 0, errors };
}
