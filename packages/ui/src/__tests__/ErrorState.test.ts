import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ErrorState from '../components/ErrorState.vue';

describe('ErrorState', () => {
  it('renders default heading', () => {
    const wrapper = mount(ErrorState);
    expect(wrapper.find('.error-state__heading').text()).toBe('Something went wrong');
  });

  it('renders custom heading prop', () => {
    const wrapper = mount(ErrorState, {
      props: { heading: 'Oops!' },
    });
    expect(wrapper.find('.error-state__heading').text()).toBe('Oops!');
  });

  it('renders message when provided', () => {
    const wrapper = mount(ErrorState, {
      props: { message: 'Network error' },
    });
    const msg = wrapper.find('.error-state__message');
    expect(msg.exists()).toBe(true);
    expect(msg.text()).toBe('Network error');
  });

  it('does not render message paragraph when no message', () => {
    const wrapper = mount(ErrorState);
    expect(wrapper.find('.error-state__message').exists()).toBe(false);
  });

  it('shows retry button by default and emits retry on click', async () => {
    const wrapper = mount(ErrorState);
    const btn = wrapper.find('.error-state__retry');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toBe('Retry');

    await btn.trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('hides retry button when retryable is false', () => {
    const wrapper = mount(ErrorState, {
      props: { retryable: false },
    });
    expect(wrapper.find('.error-state__retry').exists()).toBe(false);
  });

  it('heading slot overrides heading text', () => {
    const wrapper = mount(ErrorState, {
      slots: { heading: 'Custom heading' },
    });
    expect(wrapper.find('.error-state__heading').text()).toBe('Custom heading');
  });

  it('default slot renders custom content', () => {
    const wrapper = mount(ErrorState, {
      slots: { default: '<p class="custom">Extra info</p>' },
    });
    expect(wrapper.find('.custom').exists()).toBe(true);
    expect(wrapper.find('.custom').text()).toBe('Extra info');
  });
});
