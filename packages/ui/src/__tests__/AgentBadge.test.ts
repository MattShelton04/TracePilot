import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AgentBadge from '../components/AgentBadge.vue';

describe('AgentBadge', () => {
  it('renders with default props', () => {
    const wrapper = mount(AgentBadge);
    expect(wrapper.text()).toContain('Copilot');
    expect(wrapper.find('.agent-dot').exists()).toBe(true);
    expect(wrapper.find('.agent-name').text()).toBe('Copilot');
  });

  it('renders custom agent name', () => {
    const wrapper = mount(AgentBadge, {
      props: { agentName: 'Explore Agent', agentType: 'explore' },
    });
    expect(wrapper.find('.agent-name').text()).toBe('Explore Agent');
  });

  it('displays model when not compact', () => {
    const wrapper = mount(AgentBadge, {
      props: { model: 'claude-sonnet-4', compact: false },
    });
    const modelEl = wrapper.find('.agent-model');
    expect(modelEl.exists()).toBe(true);
    expect(modelEl.text()).toBe('claude-sonnet-4');
  });

  it('hides model when compact', () => {
    const wrapper = mount(AgentBadge, {
      props: { model: 'claude-sonnet-4', compact: true },
    });
    expect(wrapper.find('.agent-model').exists()).toBe(false);
  });

  it('applies compact class', () => {
    const wrapper = mount(AgentBadge, { props: { compact: true } });
    expect(wrapper.find('.agent-badge').classes()).toContain('compact');
  });

  it('renders status icon when status provided', () => {
    const wrapper = mount(AgentBadge, {
      props: { status: 'completed' },
    });
    expect(wrapper.find('.agent-status').exists()).toBe(true);
  });

  it('hides status icon when no status', () => {
    const wrapper = mount(AgentBadge);
    expect(wrapper.find('.agent-status').exists()).toBe(false);
  });

  it('shows Subagent as fallback name for non-main types', () => {
    const wrapper = mount(AgentBadge, {
      props: { agentType: 'explore' },
    });
    expect(wrapper.find('.agent-name').text()).toBe('Subagent');
  });

  it('sets title with name and model', () => {
    const wrapper = mount(AgentBadge, {
      props: { agentName: 'Code Review', model: 'gpt-4' },
    });
    expect(wrapper.find('.agent-badge').attributes('title')).toBe('Code Review (gpt-4)');
  });

  it('applies agent color to dot', () => {
    const wrapper = mount(AgentBadge, {
      props: { agentType: 'explore' },
    });
    const dot = wrapper.find('.agent-dot');
    expect(dot.attributes('style')).toContain('background-color');
  });
});
