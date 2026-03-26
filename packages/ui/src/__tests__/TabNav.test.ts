import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import TabNav from '../components/TabNav.vue';

const mockPush = vi.fn();

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'session-overview', params: { id: 'test-id' } }),
  useRouter: () => ({ push: mockPush }),
}));

const tabs = [
  { name: 'overview', routeName: 'session-overview', label: 'Overview' },
  { name: 'timeline', routeName: 'session-timeline', label: 'Timeline', count: 42 },
  { name: 'turns', routeName: 'session-turns', label: 'Turns' },
];

describe('TabNav', () => {
  it('renders tab labels', () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    expect(wrapper.text()).toContain('Overview');
    expect(wrapper.text()).toContain('Timeline');
    expect(wrapper.text()).toContain('Turns');
  });

  it('shows count badge when tab has count', () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    expect(wrapper.text()).toContain('42');
  });

  it('does not show count badge when tab has no count', () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    const buttons = wrapper.findAll('button');
    // Overview button should not have a count
    expect(buttons[0].text()).toBe('Overview');
  });

  it('highlights active tab based on route', () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    const buttons = wrapper.findAll('button');
    // session-overview is the active route — gets aria-current="page" and aria-selected="true"
    expect(buttons[0].attributes('aria-current')).toBe('page');
    expect(buttons[0].attributes('aria-selected')).toBe('true');
    expect(buttons[1].attributes('aria-current')).toBeUndefined();
    expect(buttons[1].attributes('aria-selected')).toBe('false');
  });

  it('has tablist role on nav element', () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    const nav = wrapper.find('nav');
    expect(nav.attributes('role')).toBe('tablist');
  });

  it('has tab role on each button', () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    const buttons = wrapper.findAll('button');
    buttons.forEach((btn) => {
      expect(btn.attributes('role')).toBe('tab');
    });
  });

  it('navigates on tab click', async () => {
    mockPush.mockClear();
    const wrapper = mount(TabNav, { props: { tabs } });
    const buttons = wrapper.findAll('button');
    await buttons[1].trigger('click');
    expect(mockPush).toHaveBeenCalledWith({
      name: 'session-timeline',
      params: { id: 'test-id' },
    });
  });
});
