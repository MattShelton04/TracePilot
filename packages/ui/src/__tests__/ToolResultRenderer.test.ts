import type { TurnToolCall } from '@tracepilot/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ToolResultRenderer from '../components/renderers/ToolResultRenderer.vue';

function makeTc(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: 'view',
    isComplete: true,
    ...overrides,
  };
}

describe('ToolResultRenderer', () => {
  it('renders plain text fallback when richEnabled is false', () => {
    const wrapper = mount(ToolResultRenderer, {
      props: {
        tc: makeTc({ toolName: 'view' }),
        content: 'some file content',
        richEnabled: false,
      },
    });
    // Should fall back to RendererShell + PlainTextRenderer
    expect(wrapper.find('.renderer-shell').exists()).toBe(true);
    expect(wrapper.find('.plain-text-renderer').exists()).toBe(true);
  });

  it('renders plain text for unknown tools even when richEnabled', () => {
    const wrapper = mount(ToolResultRenderer, {
      props: {
        tc: makeTc({ toolName: 'some_unknown_tool' }),
        content: 'some result',
        richEnabled: true,
      },
    });
    expect(wrapper.find('.plain-text-renderer').exists()).toBe(true);
  });

  it('does not render anything when content is empty', () => {
    const wrapper = mount(ToolResultRenderer, {
      props: {
        tc: makeTc(),
        content: '',
        richEnabled: true,
      },
    });
    // No RendererShell should appear for empty content
    expect(wrapper.find('.renderer-shell').exists()).toBe(false);
  });
});
