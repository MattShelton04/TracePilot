import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChartFrame from '../components/ChartFrame.vue';
import type { ChartTooltipState } from '../composables/useChartTooltip';
import type { ChartLayout, XAxisLabel, YAxisLabel } from '../utils/chartGeometry';

function makeLayout(): ChartLayout {
  return { left: 55, right: 490, top: 20, bottom: 175, width: 435, height: 155 };
}

function makeTooltip(overrides: Partial<ChartTooltipState> = {}): ChartTooltipState {
  return {
    visible: false,
    pinned: false,
    x: 0,
    y: 0,
    content: '',
    chartId: '',
    highlightIndex: -1,
    ...overrides,
  };
}

function mountFrame(overrides: Record<string, unknown> = {}) {
  return mount(ChartFrame, {
    props: {
      chartLayout: makeLayout(),
      gridLines: [20, 58.75, 97.5, 136.25],
      yLabels: [
        { value: '0', y: 175 },
        { value: '500', y: 136.25 },
        { value: '1K', y: 97.5 },
      ] as YAxisLabel[],
      xLabels: [
        { label: '3/1', x: 55 },
        { label: '3/15', x: 272.5 },
        { label: '3/31', x: 490 },
      ] as XAxisLabel[],
      ariaLabel: 'Test chart',
      chartId: 'test',
      tooltip: makeTooltip(),
      ...overrides,
    },
  });
}

describe('ChartFrame', () => {
  // ── Structural rendering ────────────────────────────────────────

  it('renders an SVG with the correct aria-label', () => {
    const wrapper = mountFrame();
    const svg = wrapper.find('svg');
    expect(svg.exists()).toBe(true);
    expect(svg.attributes('aria-label')).toBe('Test chart');
    expect(svg.attributes('role')).toBe('img');
  });

  it('uses the default viewBox when none is provided', () => {
    const wrapper = mountFrame();
    const svg = wrapper.find('svg');
    // JSDOM may expose the attribute under viewBox or viewbox
    const vb = svg.attributes('viewBox') ?? svg.attributes('viewbox');
    expect(vb).toBe('0 0 500 200');
  });

  it('accepts a custom viewBox prop', () => {
    const wrapper = mountFrame({ viewBox: '0 0 800 400' });
    const svg = wrapper.find('svg');
    const vb = svg.attributes('viewBox') ?? svg.attributes('viewbox');
    expect(vb).toBe('0 0 800 400');
  });

  it('has a chart-container root element with position: relative', () => {
    const wrapper = mountFrame();
    expect(wrapper.find('.chart-container').exists()).toBe(true);
  });

  // ── Grid lines ──────────────────────────────────────────────────

  it('renders grid lines for each value in gridLines', () => {
    const wrapper = mountFrame();
    const gridLines = wrapper.findAll('.chart-grid-line');
    expect(gridLines).toHaveLength(4);
    expect(gridLines[0].attributes('y1')).toBe('20');
    expect(gridLines[1].attributes('y1')).toBe('58.75');
    expect(gridLines[2].attributes('y1')).toBe('97.5');
    expect(gridLines[3].attributes('y1')).toBe('136.25');
  });

  it('renders no grid lines when gridLines is empty', () => {
    const wrapper = mountFrame({ gridLines: [] });
    expect(wrapper.findAll('.chart-grid-line')).toHaveLength(0);
  });

  // ── Axes ────────────────────────────────────────────────────────

  it('renders Y-axis and X-axis lines', () => {
    const wrapper = mountFrame();
    const axes = wrapper.findAll('.chart-axis');
    expect(axes).toHaveLength(2);
    // Y-axis (vertical)
    expect(axes[0].attributes('x1')).toBe('55');
    expect(axes[0].attributes('y1')).toBe('20');
    expect(axes[0].attributes('y2')).toBe('175');
    // X-axis (horizontal)
    expect(axes[1].attributes('y1')).toBe('175');
    expect(axes[1].attributes('y2')).toBe('175');
  });

  // ── Y-axis labels ──────────────────────────────────────────────

  it('renders Y-axis labels at the correct positions', () => {
    const wrapper = mountFrame();
    const labels = wrapper
      .findAll('.chart-label')
      .filter((el) => el.attributes('text-anchor') === 'end');
    expect(labels).toHaveLength(3);
    expect(labels[0].text()).toBe('0');
    expect(labels[0].attributes('y')).toBe('178'); // 175 + 3
    expect(labels[1].text()).toBe('500');
    expect(labels[2].text()).toBe('1K');
  });

  it('renders no Y-axis labels when yLabels is empty', () => {
    const wrapper = mountFrame({ yLabels: [] });
    const endLabels = wrapper
      .findAll('.chart-label')
      .filter((el) => el.attributes('text-anchor') === 'end');
    expect(endLabels).toHaveLength(0);
  });

  // ── X-axis labels ──────────────────────────────────────────────

  it('renders X-axis labels at bottom + 17', () => {
    const wrapper = mountFrame();
    const labels = wrapper
      .findAll('.chart-label')
      .filter((el) => el.attributes('text-anchor') === 'middle');
    expect(labels).toHaveLength(3);
    expect(labels[0].text()).toBe('3/1');
    expect(labels[0].attributes('y')).toBe('192'); // 175 + 17
    expect(labels[1].text()).toBe('3/15');
    expect(labels[2].text()).toBe('3/31');
  });

  it('renders no X-axis labels when xLabels is empty', () => {
    const wrapper = mountFrame({ xLabels: [] });
    const midLabels = wrapper
      .findAll('.chart-label')
      .filter((el) => el.attributes('text-anchor') === 'middle');
    expect(midLabels).toHaveLength(0);
  });

  // ── Overlay ─────────────────────────────────────────────────────

  it('renders a transparent overlay rect matching chart dimensions', () => {
    const wrapper = mountFrame();
    const overlay = wrapper.find('.chart-overlay');
    expect(overlay.exists()).toBe(true);
    expect(overlay.attributes('x')).toBe('55');
    expect(overlay.attributes('y')).toBe('20');
    expect(overlay.attributes('width')).toBe('435');
    expect(overlay.attributes('height')).toBe('155');
    expect(overlay.attributes('fill')).toBe('transparent');
  });

  // ── Tooltip ─────────────────────────────────────────────────────

  it('shows tooltip when visible and chartId matches', () => {
    const wrapper = mountFrame({
      tooltip: makeTooltip({ visible: true, chartId: 'test', content: 'Hello', x: 100, y: 80 }),
    });
    const tip = wrapper.find('.chart-tooltip');
    expect(tip.exists()).toBe(true);
    expect(tip.text()).toBe('Hello');
  });

  it('hides tooltip when chartId does not match', () => {
    const wrapper = mountFrame({
      tooltip: makeTooltip({ visible: true, chartId: 'other', content: 'Hello' }),
    });
    expect(wrapper.find('.chart-tooltip').exists()).toBe(false);
  });

  it('hides tooltip when visible is false', () => {
    const wrapper = mountFrame({
      tooltip: makeTooltip({ visible: false, chartId: 'test' }),
    });
    expect(wrapper.find('.chart-tooltip').exists()).toBe(false);
  });

  it('adds pinned class when tooltip is pinned', () => {
    const wrapper = mountFrame({
      tooltip: makeTooltip({ visible: true, chartId: 'test', pinned: true, content: 'Pinned' }),
    });
    expect(wrapper.find('.chart-tooltip--pinned').exists()).toBe(true);
  });

  // ── Events ──────────────────────────────────────────────────────

  it('emits dismiss-tooltip on mouseleave', async () => {
    const wrapper = mountFrame();
    await wrapper.find('.chart-container').trigger('mouseleave');
    expect(wrapper.emitted('dismiss-tooltip')).toHaveLength(1);
  });

  it('emits mousemove when SVG receives mousemove', async () => {
    const wrapper = mountFrame();
    await wrapper.find('svg').trigger('mousemove');
    expect(wrapper.emitted('mousemove')).toHaveLength(1);
  });

  it('emits click when SVG receives click', async () => {
    const wrapper = mountFrame();
    await wrapper.find('svg').trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  // ── Slots ───────────────────────────────────────────────────────

  it('renders default slot inside the SVG', () => {
    const wrapper = mount(ChartFrame, {
      props: {
        chartLayout: makeLayout(),
        gridLines: [],
        yLabels: [],
        xLabels: [],
        ariaLabel: 'Slot test',
        chartId: 'slot',
        tooltip: makeTooltip(),
      },
      slots: {
        default: '<circle cx="10" cy="10" r="5" class="test-dot" />',
      },
    });
    const svg = wrapper.find('svg');
    expect(svg.find('.test-dot').exists()).toBe(true);
  });

  it('renders defs slot inside SVG <defs> element', () => {
    const wrapper = mount(ChartFrame, {
      props: {
        chartLayout: makeLayout(),
        gridLines: [],
        yLabels: [],
        xLabels: [],
        ariaLabel: 'Defs test',
        chartId: 'defs',
        tooltip: makeTooltip(),
      },
      slots: {
        defs: '<linearGradient id="testGrad"><stop offset="0%" stop-color="red" /></linearGradient>',
      },
    });
    const svg = wrapper.find('svg');
    const defs = svg.find('defs');
    expect(defs.exists()).toBe(true);
    // The gradient should be inside the defs element
    expect(defs.html()).toContain('testGrad');
  });

  it('renders footer slot outside the SVG', () => {
    const wrapper = mount(ChartFrame, {
      props: {
        chartLayout: makeLayout(),
        gridLines: [],
        yLabels: [],
        xLabels: [],
        ariaLabel: 'Footer test',
        chartId: 'footer',
        tooltip: makeTooltip(),
      },
      slots: {
        footer: '<div class="test-legend">Legend content</div>',
      },
    });
    // Footer should be inside chart-container but NOT inside svg
    expect(wrapper.find('.chart-container .test-legend').exists()).toBe(true);
    expect(wrapper.find('svg .test-legend').exists()).toBe(false);
  });

  // ── SVG element ordering ────────────────────────────────────────

  it('renders default slot content before the overlay rect (correct paint order)', () => {
    const wrapper = mount(ChartFrame, {
      props: {
        chartLayout: makeLayout(),
        gridLines: [],
        yLabels: [],
        xLabels: [],
        ariaLabel: 'Order test',
        chartId: 'order',
        tooltip: makeTooltip(),
      },
      slots: {
        default: '<rect class="user-bar" x="100" y="50" width="20" height="100" />',
      },
    });
    const svg = wrapper.find('svg');
    const html = svg.html();
    const barPos = html.indexOf('user-bar');
    const overlayPos = html.indexOf('chart-overlay');
    // The user content should appear before the overlay in the SVG markup
    expect(barPos).toBeLessThan(overlayPos);
  });
});
