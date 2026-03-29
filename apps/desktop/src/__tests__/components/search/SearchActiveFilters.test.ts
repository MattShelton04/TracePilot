import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SearchActiveFilters from '../../../components/search/SearchActiveFilters.vue';

const CONTENT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  message: { label: 'Message', color: '#3b82f6' },
  tool_call: { label: 'Tool Call', color: '#f59e0b' },
};

function mountFilters(props: Record<string, unknown> = {}) {
  return mount(SearchActiveFilters, {
    props: {
      activeContentTypeChips: [],
      repository: null,
      toolName: null,
      sessionId: null,
      sessionDisplayName: null,
      activeFilterCount: 0,
      contentTypeConfig: CONTENT_TYPE_CONFIG,
      ...props,
    },
  });
}

describe('SearchActiveFilters', () => {
  it('renders nothing when no filters are active', () => {
    const wrapper = mountFilters();
    expect(wrapper.find('.active-filters-bar').exists()).toBe(false);
  });

  it('renders content type include chips', () => {
    const wrapper = mountFilters({
      activeContentTypeChips: [{ type: 'message', mode: 'include' }],
    });
    expect(wrapper.find('.active-filters-bar').exists()).toBe(true);
    expect(wrapper.find('.filter-chip-include').text()).toContain('Message');
  });

  it('renders content type exclude chips with NOT prefix', () => {
    const wrapper = mountFilters({
      activeContentTypeChips: [{ type: 'tool_call', mode: 'exclude' }],
    });
    const chip = wrapper.find('.filter-chip-exclude');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain('NOT');
    expect(chip.text()).toContain('Tool Call');
  });

  it('renders repository filter chip', () => {
    const wrapper = mountFilters({ repository: 'org/repo' });
    expect(wrapper.find('.filter-chip-neutral').text()).toContain('Repo: org/repo');
  });

  it('renders tool name filter chip', () => {
    const wrapper = mountFilters({ toolName: 'read_file' });
    expect(wrapper.find('.filter-chip-neutral').text()).toContain('Tool: read_file');
  });

  it('renders session filter chip', () => {
    const wrapper = mountFilters({
      sessionId: 'abc-123',
      sessionDisplayName: 'My Session',
    });
    expect(wrapper.find('.filter-chip-include').text()).toContain('Session: My Session');
  });

  it('emits remove-content-type when chip remove button clicked', async () => {
    const wrapper = mountFilters({
      activeContentTypeChips: [{ type: 'message', mode: 'include' }],
    });
    await wrapper.find('.filter-chip-remove').trigger('click');
    expect(wrapper.emitted('remove-content-type')).toEqual([['message']]);
  });

  it('emits clear-repository when repo chip remove clicked', async () => {
    const wrapper = mountFilters({ repository: 'org/repo' });
    await wrapper.find('.filter-chip-remove').trigger('click');
    expect(wrapper.emitted('clear-repository')).toBeTruthy();
  });

  it('shows clear-all button when multiple filters active', () => {
    const wrapper = mountFilters({
      activeContentTypeChips: [{ type: 'message', mode: 'include' }],
      repository: 'org/repo',
      activeFilterCount: 2,
    });
    expect(wrapper.find('.filter-chip-clear-all').exists()).toBe(true);
  });

  it('emits clear-all when clear-all button clicked', async () => {
    const wrapper = mountFilters({
      activeContentTypeChips: [{ type: 'message', mode: 'include' }],
      repository: 'org/repo',
      activeFilterCount: 2,
    });
    await wrapper.find('.filter-chip-clear-all').trigger('click');
    expect(wrapper.emitted('clear-all')).toBeTruthy();
  });

  it('hides clear-all button when only one filter active', () => {
    const wrapper = mountFilters({
      repository: 'org/repo',
      activeFilterCount: 1,
    });
    expect(wrapper.find('.filter-chip-clear-all').exists()).toBe(false);
  });
});
