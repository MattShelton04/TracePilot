import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Badge from '../components/Badge.vue';

describe('Badge', () => {
  it('renders slot content', () => {
    const wrapper = mount(Badge, {
      slots: { default: 'Hello Badge' },
    });
    expect(wrapper.text()).toBe('Hello Badge');
  });

  it('applies accent variant styling', () => {
    const wrapper = mount(Badge, {
      props: { variant: 'accent' },
      slots: { default: 'Accent' },
    });
    expect(wrapper.classes()).toContain('badge');
    expect(wrapper.classes()).toContain('badge-accent');
  });

  it('applies success variant styling', () => {
    const wrapper = mount(Badge, {
      props: { variant: 'success' },
      slots: { default: 'Success' },
    });
    expect(wrapper.classes()).toContain('badge-success');
  });

  it('applies warning variant styling', () => {
    const wrapper = mount(Badge, {
      props: { variant: 'warning' },
      slots: { default: 'Warning' },
    });
    expect(wrapper.classes()).toContain('badge-warning');
  });

  it('applies danger variant styling', () => {
    const wrapper = mount(Badge, {
      props: { variant: 'danger' },
      slots: { default: 'Danger' },
    });
    expect(wrapper.classes()).toContain('badge-danger');
  });

  it('applies done variant styling', () => {
    const wrapper = mount(Badge, {
      props: { variant: 'done' },
      slots: { default: 'Done' },
    });
    expect(wrapper.classes()).toContain('badge-done');
  });

  it('applies neutral variant styling', () => {
    const wrapper = mount(Badge, {
      props: { variant: 'neutral' },
      slots: { default: 'Neutral' },
    });
    expect(wrapper.classes()).toContain('badge-neutral');
  });

  it('uses default/neutral variant when no prop passed', () => {
    const wrapper = mount(Badge, {
      slots: { default: 'Default' },
    });
    expect(wrapper.classes()).toContain('badge-neutral');
    expect(wrapper.classes()).not.toContain('badge-accent');
  });
});
