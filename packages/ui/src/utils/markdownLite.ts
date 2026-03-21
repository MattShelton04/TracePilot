/**
 * markdownLite — lightweight, safe markdown-to-HTML converter.
 *
 * Designed for rendering assistant messages in TracePilot. HTML-escapes
 * input first (XSS prevention), then applies markdown formatting.
 *
 * Supports: headings, bold, italic, inline code, code blocks, links,
 * unordered/ordered lists, blockquotes. Does NOT handle tables, images,
 * or footnotes (not needed for assistant message rendering).
 */

import { highlightLine } from './syntaxHighlight';

/** Escape HTML entities to prevent XSS. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Highlight a code block (multi-line) using per-line highlighter. */
function highlightCode(code: string, language: string): string {
  return code
    .split('\n')
    .map((line) => highlightLine(line, language))
    .join('\n');
}

/** Allowed URL protocols for rendered links. */
const SAFE_URL_RE = /^(https?:\/\/|mailto:|#|\/)/i;

/** Sanitize a URL — returns '#' for dangerous protocols. */
function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '#';
  if (SAFE_URL_RE.test(trimmed)) return trimmed;
  // Block javascript:, data:, vbscript:, etc.
  return '#';
}

/**
 * Render a markdown string to safe HTML.
 *
 * Processing order:
 * 1. Extract code blocks from RAW text (before escaping)
 * 2. Escape HTML entities on the remaining text
 * 3. Apply inline formatting (bold, italic, code, links)
 * 4. Apply block formatting (headings, lists, blockquotes)
 * 5. Wrap paragraphs
 * 6. Restore code blocks
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';

  // Step 1: Extract fenced code blocks from raw text BEFORE escaping
  // so that code content is only escaped once (by highlightLine).
  const codeBlocks: string[] = [];
  let raw = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const detectedLang = lang || 'text';
    const highlighted = highlightCode(code.replace(/\n$/, ''), detectedLang);
    const placeholder = `%%CODEBLOCK_${codeBlocks.length}%%`;
    codeBlocks.push(
      `<div class="md-code-block"><div class="md-code-lang">${escapeHtml(detectedLang)}</div><pre><code>${highlighted}</code></pre></div>`,
    );
    return placeholder;
  });

  // Step 2: Escape HTML on everything except code block placeholders
  let html = escapeHtml(raw);

  // Step 3: Inline code (backticks) — before other inline formatting
  html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>');

  // Step 4: Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Step 5: Links — with URL sanitization
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, linkText: string, url: string) => {
      const safeUrl = sanitizeUrl(url);
      return `<a href="${safeUrl}" class="md-link" target="_blank" rel="noopener">${linkText}</a>`;
    },
  );

  // Step 6: Process lines for block elements
  const lines = html.split('\n');
  const processed: string[] = [];
  let inList = false;
  let listType = '';
  let inBlockquote = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for code block placeholders — pass through as-is
    if (line.match(/%%CODEBLOCK_\d+%%/)) {
      if (inList) { processed.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      if (inBlockquote) { processed.push('</blockquote>'); inBlockquote = false; }
      processed.push(line);
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { processed.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      if (inBlockquote) { processed.push('</blockquote>'); inBlockquote = false; }
      const level = headingMatch[1].length;
      processed.push(`<h${level} class="md-heading md-h${level}">${headingMatch[2]}</h${level}>`);
      continue;
    }

    // Blockquotes
    if (line.startsWith('&gt; ') || line === '&gt;') {
      if (inList) { processed.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      if (!inBlockquote) { processed.push('<blockquote class="md-blockquote">'); inBlockquote = true; }
      processed.push(`${line.replace(/^&gt;\s?/, '')}<br>`);
      continue;
    } else if (inBlockquote) {
      processed.push('</blockquote>');
      inBlockquote = false;
    }

    // Unordered lists
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) processed.push(listType === 'ul' ? '</ul>' : '</ol>');
        processed.push('<ul class="md-list">');
        inList = true;
        listType = 'ul';
      }
      processed.push(`<li>${ulMatch[2]}</li>`);
      continue;
    }

    // Ordered lists
    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) processed.push(listType === 'ul' ? '</ul>' : '</ol>');
        processed.push('<ol class="md-list">');
        inList = true;
        listType = 'ol';
      }
      processed.push(`<li>${olMatch[2]}</li>`);
      continue;
    }

    // Close list if we hit a non-list line
    if (inList) {
      processed.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
    }

    // Horizontal rules
    if (line.match(/^[-*_]{3,}$/)) {
      processed.push('<hr class="md-hr">');
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      processed.push('');
      continue;
    }

    // Regular paragraph text
    processed.push(line);
  }

  // Close any open tags
  if (inList) processed.push(listType === 'ul' ? '</ul>' : '</ol>');
  if (inBlockquote) processed.push('</blockquote>');

  html = processed.join('\n');

  // Wrap consecutive non-block lines in <p> tags
  html = html.replace(
    /(?:^|\n)(?!<[huo]|<blockquote|<hr|<div|%%CODEBLOCK)(.+?)(?=\n<[huo]|\n<blockquote|\n<hr|\n<div|\n%%CODEBLOCK|\n\n|$)/gs,
    (match) => {
      const trimmed = match.trim();
      if (!trimmed) return match;
      // Don't wrap if already wrapped or is a block element
      if (trimmed.startsWith('<')) return match;
      return `\n<p class="md-paragraph">${trimmed}</p>`;
    },
  );

  // Restore code blocks (placeholders were escaped so unescape them)
  for (let i = 0; i < codeBlocks.length; i++) {
    html = html.replace(`%%CODEBLOCK_${i}%%`, codeBlocks[i]);
  }

  return html.trim();
}
