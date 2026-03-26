import type { TurnToolCall } from '@tracepilot/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ToolArgsRenderer from '../components/renderers/ToolArgsRenderer.vue';

function makeTc(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: 'view',
    isComplete: true,
    arguments: { path: '/src/index.ts' },
    ...overrides,
  };
}

describe('ToolArgsRenderer', () => {
  it('renders JSON fallback when richEnabled is false', () => {
    const wrapper = mount(ToolArgsRenderer, {
      props: {
        tc: makeTc({
          toolName: 'edit',
          arguments: { path: 'test.ts', old_str: 'a', new_str: 'b' },
        }),
        richEnabled: false,
      },
    });
    expect(wrapper.find('.tool-args-json').exists()).toBe(true);
    const text = wrapper.find('.tool-args-json').text();
    expect(text).toContain('test.ts');
  });

  it('renders JSON fallback for unknown tool with args', () => {
    const wrapper = mount(ToolArgsRenderer, {
      props: {
        tc: makeTc({ toolName: 'unknown_tool', arguments: { foo: 'bar' } }),
        richEnabled: true,
      },
    });
    expect(wrapper.find('.tool-args-json').exists()).toBe(true);
  });

  it('does not render when arguments are empty', () => {
    const wrapper = mount(ToolArgsRenderer, {
      props: {
        tc: makeTc({ arguments: {} }),
        richEnabled: true,
      },
    });
    expect(wrapper.find('.tool-args-json').exists()).toBe(false);
  });

  it('does not render when arguments are null', () => {
    const wrapper = mount(ToolArgsRenderer, {
      props: {
        tc: makeTc({ arguments: undefined }),
        richEnabled: true,
      },
    });
    expect(wrapper.find('.tool-args-json').exists()).toBe(false);
  });
});
