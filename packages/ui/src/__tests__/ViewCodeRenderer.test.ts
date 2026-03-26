import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ViewCodeRenderer from '../components/renderers/ViewCodeRenderer.vue';

describe('ViewCodeRenderer', () => {
  const sampleCode = 'const x = 1;\nconst y = 2;\n';

  it('renders code with line numbers for a normal file', () => {
    const wrapper = mount(ViewCodeRenderer, {
      props: {
        content: sampleCode,
        args: { path: '/src/app.ts' },
      },
    });

    expect(wrapper.find('.code-block').exists()).toBe(true);
    expect(wrapper.text()).toContain('app.ts');
  });

  it('treats extensionless known files as code, not directory listings', () => {
    const wrapper = mount(ViewCodeRenderer, {
      props: {
        content: 'FROM node:18\nRUN npm install\n',
        args: { path: '/project/Dockerfile' },
      },
    });

    // Should render with CodeBlock (not as directory listing)
    expect(wrapper.find('.code-block').exists()).toBe(true);
  });

  it('treats Makefile as code, not directory listing', () => {
    const wrapper = mount(ViewCodeRenderer, {
      props: {
        content: 'all:\n\techo hello\n',
        args: { path: '/project/Makefile' },
      },
    });

    expect(wrapper.find('.code-block').exists()).toBe(true);
  });

  it('detects directory listing for actual directories', () => {
    const wrapper = mount(ViewCodeRenderer, {
      props: {
        content: 'file1.ts\nfile2.ts\nsrc/\n',
        args: { path: '/project/src' },
      },
    });

    // "src" has no extension and detectLanguage returns "text", so this is a directory
    expect(wrapper.find('.view-code-dir').exists()).toBe(true);
  });

  it('shows line count in header', () => {
    const wrapper = mount(ViewCodeRenderer, {
      props: {
        content: 'line1\nline2\nline3\n',
        args: { path: '/file.txt' },
      },
    });

    expect(wrapper.text()).toContain('3 line');
  });

  it('handles truncated content', () => {
    const wrapper = mount(ViewCodeRenderer, {
      props: {
        content: sampleCode,
        args: { path: '/file.ts' },
        isTruncated: true,
      },
    });

    expect(wrapper.text()).toContain('Output was truncated');
  });
});
