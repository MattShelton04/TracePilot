import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CreateFileRenderer from '../components/renderers/CreateFileRenderer.vue';

describe('CreateFileRenderer', () => {
  it('renders file_text from args instead of result content', () => {
    const fileText = 'export const hello = "world";\n';
    const wrapper = mount(CreateFileRenderer, {
      props: {
        content: 'File created successfully',
        args: { path: '/src/hello.ts', file_text: fileText },
      },
    });

    // Should show the actual file content, not the confirmation message
    expect(wrapper.text()).toContain('hello');
    expect(wrapper.text()).not.toContain('File created successfully');
  });

  it('falls back to content when file_text is not in args', () => {
    const wrapper = mount(CreateFileRenderer, {
      props: {
        content: 'Some result content',
        args: { path: '/src/file.ts' },
      },
    });

    expect(wrapper.text()).toContain('Some result content');
  });

  it('shows new file badge and correct line count', () => {
    const fileText = 'line1\nline2\nline3\n';
    const wrapper = mount(CreateFileRenderer, {
      props: {
        content: 'OK',
        args: { path: '/src/file.ts', file_text: fileText },
      },
    });

    expect(wrapper.text()).toContain('New File');
    expect(wrapper.text()).toContain('3 lines');
  });

  it('shows file path in header', () => {
    const wrapper = mount(CreateFileRenderer, {
      props: {
        content: 'OK',
        args: { path: '/src/components/MyComponent.vue', file_text: '<template></template>' },
      },
    });

    expect(wrapper.text()).toContain('/src/components/MyComponent.vue');
  });
});
