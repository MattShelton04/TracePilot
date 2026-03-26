import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import HealthRing from '../components/HealthRing.vue';

describe('HealthRing', () => {
  it('renders score as percentage', () => {
    const wrapper = mount(HealthRing, { props: { score: 0.75 } });
    expect(wrapper.text()).toBe('75');
  });

  it('renders 0 score as 0', () => {
    const wrapper = mount(HealthRing, { props: { score: 0 } });
    expect(wrapper.text()).toBe('0');
  });

  it('renders 1.0 score as 100', () => {
    const wrapper = mount(HealthRing, { props: { score: 1 } });
    expect(wrapper.text()).toBe('100');
  });

  it('uses success color for score >= 0.8', () => {
    const wrapper = mount(HealthRing, { props: { score: 0.85 } });
    const style = wrapper.attributes('style') || '';
    expect(style).toContain('--ring-color: var(--success-fg)');
  });

  it('uses warning color for score >= 0.5 and < 0.8', () => {
    const wrapper = mount(HealthRing, { props: { score: 0.6 } });
    const style = wrapper.attributes('style') || '';
    expect(style).toContain('--ring-color: var(--warning-fg)');
  });

  it('uses danger color for score < 0.5', () => {
    const wrapper = mount(HealthRing, { props: { score: 0.3 } });
    const style = wrapper.attributes('style') || '';
    expect(style).toContain('--ring-color: var(--danger-fg)');
  });

  it('defaults to sm size (44px)', () => {
    const wrapper = mount(HealthRing, { props: { score: 0.5 } });
    const style = wrapper.attributes('style') || '';
    expect(style).toContain('width: 44px');
    expect(style).toContain('height: 44px');
  });

  it('supports lg size (120px)', () => {
    const wrapper = mount(HealthRing, { props: { score: 0.5, size: 'lg' } });
    const style = wrapper.attributes('style') || '';
    expect(style).toContain('width: 120px');
    expect(style).toContain('height: 120px');
  });

  it('has correct aria attributes', () => {
    const wrapper = mount(HealthRing, { props: { score: 0.9 } });
    expect(wrapper.attributes('role')).toBe('meter');
    expect(wrapper.attributes('aria-valuenow')).toBe('90');
    expect(wrapper.attributes('aria-valuemin')).toBe('0');
    expect(wrapper.attributes('aria-valuemax')).toBe('100');
    expect(wrapper.attributes('aria-label')).toBe('Health score: 90%');
  });
});
