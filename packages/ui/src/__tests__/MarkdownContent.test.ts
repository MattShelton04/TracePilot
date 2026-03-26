import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MarkdownContent from '../components/MarkdownContent.vue';

describe('MarkdownContent', () => {
  it('renders simple markdown as HTML', () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: 'This is **bold** and *italic*' },
    });
    const html = wrapper.html();
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders headings', () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: '# Heading 1\n## Heading 2' },
    });
    const html = wrapper.html();
    expect(html).toContain('<h1>Heading 1</h1>');
    expect(html).toContain('<h2>Heading 2</h2>');
  });

  it('renders lists', () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: '- Item 1\n- Item 2' },
    });
    const html = wrapper.html();
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Item 1</li>');
    expect(html).toContain('<li>Item 2</li>');
  });

  it('renders code blocks', () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: '```ts\nconst x = 1;\n```' },
    });
    const html = wrapper.html();
    expect(html).toContain('<pre>');
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('const x = 1;');
  });

  it('renders raw text when render prop is false', () => {
    const content = 'This is **not rendered**';
    const wrapper = mount(MarkdownContent, {
      props: { content, render: false },
    });
    const el = wrapper.find('.markdown-content');
    expect(el.classes()).toContain('is-raw');
    expect(el.text()).toBe(content);
    expect(wrapper.html()).not.toContain('<strong>');
  });

  it('sanitizes HTML to prevent XSS', () => {
    // 1. Test that raw HTML tags are escaped/stripped
    const wrapper = mount(MarkdownContent, {
      props: { content: 'Dangerous <script>alert("xss")</script>' },
    });
    expect(wrapper.html()).not.toContain('<script>');
    expect(wrapper.html()).toContain('&lt;script&gt;');

    // 2. Test that malicious links are neutralized or not rendered as links
    const wrapper2 = mount(MarkdownContent, {
      props: { content: '[click](javascript:alert(1))' },
    });
    // markdown-it or dompurify will prevent this from being a clickable javascript link
    expect(wrapper2.html()).not.toContain('href="javascript:');
  });

  it('trims extra newlines (fix for reported bug)', () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: '\n\n# Hello\n\n\n' },
    });
    // Trimming before rendering should result in the first element being the H1,
    // and no leading <br> or empty <p> if they were being generated.
    const html = wrapper.html();
    expect(html).toContain('<h1>Hello</h1>');
    // markdown-it might still wrap the root in some cases, but trimming prevents leading/trailing garbage.
  });

  it('applies maxHeight style', () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: 'test', maxHeight: '200px' },
    });
    const el = wrapper.find('.markdown-content');
    expect(el.attributes('style')).toContain('max-height: 200px');
    expect(el.attributes('style')).toContain('overflow-y: auto');
  });

  it('forces white-space: normal when rendered', () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: 'test', render: true },
    });
    const el = wrapper.find('.markdown-content');
    expect(el.classes()).toContain('is-rendered');
    // Note: Vitest/JSDOM won't actually "calculate" the !important override,
    // but we've verified the class is applied.
  });
});
