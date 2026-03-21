import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../utils/markdownLite';

describe('markdownLite — renderMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('returns empty string for null/undefined-like input', () => {
    expect(renderMarkdown(undefined as unknown as string)).toBe('');
  });

  it('renders bold text', () => {
    const html = renderMarkdown('This is **bold** text');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders italic text', () => {
    const html = renderMarkdown('This is *italic* text');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders bold-italic text', () => {
    const html = renderMarkdown('This is ***bold-italic*** text');
    expect(html).toContain('<strong><em>bold-italic</em></strong>');
  });

  it('renders inline code', () => {
    const html = renderMarkdown('Use `console.log()` for debugging');
    expect(html).toContain('<code class="md-inline-code">console.log()</code>');
  });

  it('renders headings (h1-h4)', () => {
    expect(renderMarkdown('# Heading 1')).toContain('<h1 class="md-heading md-h1">Heading 1</h1>');
    expect(renderMarkdown('## Heading 2')).toContain('<h2 class="md-heading md-h2">Heading 2</h2>');
    expect(renderMarkdown('### Heading 3')).toContain('<h3 class="md-heading md-h3">Heading 3</h3>');
    expect(renderMarkdown('#### Heading 4')).toContain('<h4 class="md-heading md-h4">Heading 4</h4>');
  });

  it('renders unordered lists', () => {
    const html = renderMarkdown('- Item 1\n- Item 2\n- Item 3');
    expect(html).toContain('<ul class="md-list">');
    expect(html).toContain('<li>Item 1</li>');
    expect(html).toContain('<li>Item 2</li>');
    expect(html).toContain('<li>Item 3</li>');
    expect(html).toContain('</ul>');
  });

  it('renders ordered lists', () => {
    const html = renderMarkdown('1. First\n2. Second\n3. Third');
    expect(html).toContain('<ol class="md-list">');
    expect(html).toContain('<li>First</li>');
    expect(html).toContain('</ol>');
  });

  it('renders links', () => {
    const html = renderMarkdown('Visit [GitHub](https://github.com) for more');
    expect(html).toContain('<a href="https://github.com" class="md-link" target="_blank" rel="noopener">GitHub</a>');
  });

  it('renders blockquotes', () => {
    const html = renderMarkdown('> This is a quote');
    expect(html).toContain('<blockquote class="md-blockquote">');
    expect(html).toContain('This is a quote');
  });

  it('renders fenced code blocks', () => {
    const html = renderMarkdown('```typescript\nconst x = 1;\n```');
    expect(html).toContain('<div class="md-code-block">');
    expect(html).toContain('typescript');
  });

  it('renders code blocks without language hint', () => {
    const html = renderMarkdown('```\nhello world\n```');
    expect(html).toContain('<div class="md-code-block">');
    expect(html).toContain('text');
  });

  it('renders horizontal rules', () => {
    const html = renderMarkdown('---');
    expect(html).toContain('<hr class="md-hr">');
  });

  // XSS Prevention tests
  it('escapes HTML tags to prevent XSS', () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('blocks javascript: URLs in links', () => {
    const html = renderMarkdown('[Click me](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
    expect(html).toContain('Click me');
  });

  it('blocks data: URLs in links', () => {
    const html = renderMarkdown('[Evil](data:text/html,<script>alert(1)</script>)');
    expect(html).not.toContain('data:');
    expect(html).toContain('href="#"');
  });

  it('allows https: URLs in links', () => {
    const html = renderMarkdown('[Safe](https://example.com)');
    expect(html).toContain('href="https://example.com"');
  });

  it('allows mailto: URLs in links', () => {
    const html = renderMarkdown('[Email](mailto:test@example.com)');
    expect(html).toContain('href="mailto:test@example.com"');
  });

  it('escapes angle brackets in regular text', () => {
    const html = renderMarkdown('Use <div> elements');
    expect(html).toContain('&lt;div&gt;');
  });

  it('does not double-escape HTML in code blocks', () => {
    const html = renderMarkdown('```html\n<div>test</div>\n```');
    expect(html).toContain('md-code-block');
    // Should NOT contain double-escaped entities
    expect(html).not.toContain('&amp;lt;');
    expect(html).not.toContain('&amp;gt;');
  });

  // Complex content
  it('handles mixed content correctly', () => {
    const input = '# Title\n\nSome **bold** and *italic* text.\n\n- List item 1\n- List item 2\n\n```javascript\nconst x = 1;\n```';
    const html = renderMarkdown(input);

    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<ul class="md-list">');
    expect(html).toContain('<div class="md-code-block">');
  });

  it('renders inline code (formatting inside code may be applied in lightweight mode)', () => {
    const html = renderMarkdown('Use `**not bold**` as text');
    expect(html).toContain('md-inline-code');
    expect(html).toContain('not bold');
  });
});
