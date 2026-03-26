import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import BreadcrumbNav from '../../../components/layout/BreadcrumbNav.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { template: '<div />' } }],
});

describe('BreadcrumbNav', () => {
  it('renders single item without link', () => {
    const wrapper = mount(BreadcrumbNav, {
      props: { items: [{ label: 'Sessions' }] },
      global: { plugins: [router] },
    });
    expect(wrapper.text()).toContain('Sessions');
    expect(wrapper.find('a').exists()).toBe(false);
  });

  it('renders multiple items with links', () => {
    const wrapper = mount(BreadcrumbNav, {
      props: {
        items: [{ label: 'Sessions', to: '/' }, { label: 'Detail' }],
      },
      global: { plugins: [router] },
    });
    expect(wrapper.findAll('a').length).toBe(1);
    expect(wrapper.text()).toContain('Sessions');
    expect(wrapper.text()).toContain('Detail');
  });

  it('has aria-label for accessibility', () => {
    const wrapper = mount(BreadcrumbNav, {
      props: { items: [{ label: 'Home' }] },
      global: { plugins: [router] },
    });
    expect(wrapper.find('nav').attributes('aria-label')).toBe('Breadcrumb');
  });
});
