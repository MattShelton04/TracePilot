import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ToolCallsGroup from '../../components/ToolCallsGroup.vue';

const mockCalls = [
  { toolName: 'edit', success: true, durationMs: 450, args: 'file.ts' },
  { toolName: 'powershell', success: false, durationMs: 2100, args: 'npm test' },
];

describe('ToolCallsGroup', () => {
  it('renders tool call count', () => {
    const wrapper = mount(ToolCallsGroup, { props: { toolCalls: mockCalls } });
    expect(wrapper.text()).toContain('Tool Calls (2)');
  });

  it('shows pass/fail badges', () => {
    const wrapper = mount(ToolCallsGroup, { props: { toolCalls: mockCalls } });
    expect(wrapper.text()).toContain('✓ 1');
    expect(wrapper.text()).toContain('✕ 1');
  });

  it('toggles expansion on header click', async () => {
    const wrapper = mount(ToolCallsGroup, { props: { toolCalls: mockCalls } });
    const header = wrapper.find('.tool-call-header');
    const body = wrapper.find('.tool-calls-body');
    // Initially expanded — v-show renders with no display:none
    expect(body.attributes('style')).toBeUndefined();
    await header.trigger('click');
    // After click — v-show hides with display:none
    expect(body.attributes('style')).toContain('display: none');
  });

  it('formats duration correctly', () => {
    const wrapper = mount(ToolCallsGroup, { props: { toolCalls: mockCalls } });
    expect(wrapper.text()).toContain('450ms');
    expect(wrapper.text()).toContain('2.1s');
  });
});
