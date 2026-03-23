import { describe, it, expect, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { useChartTooltip } from '../composables/useChartTooltip';

function createWrapper() {
  return mount(
    defineComponent({
      setup() {
        const ct = useChartTooltip();
        return { ...ct };
      },
      template: '<div />',
    }),
  );
}

describe('useChartTooltip', () => {
  it('has correct initial state', () => {
    const w = createWrapper();
    expect(w.vm.tooltip.visible).toBe(false);
    expect(w.vm.tooltip.pinned).toBe(false);
    expect(w.vm.tooltip.x).toBe(0);
    expect(w.vm.tooltip.y).toBe(0);
    expect(w.vm.tooltip.content).toBe('');
    expect(w.vm.tooltip.chartId).toBe('');
    expect(w.vm.tooltip.highlightIndex).toBe(-1);
  });

  it('dismissTooltip resets all state', async () => {
    const w = createWrapper();
    // Manually set some state
    w.vm.tooltip.visible = true;
    w.vm.tooltip.pinned = true;
    w.vm.tooltip.chartId = 'test';
    w.vm.tooltip.highlightIndex = 3;
    w.vm.tooltip.content = 'Hello';

    w.vm.dismissTooltip();

    expect(w.vm.tooltip.visible).toBe(false);
    expect(w.vm.tooltip.pinned).toBe(false);
    expect(w.vm.tooltip.chartId).toBe('');
    expect(w.vm.tooltip.highlightIndex).toBe(-1);
  });

  describe('findNearestIndex', () => {
    it('returns -1 for empty array', () => {
      const w = createWrapper();
      expect(w.vm.findNearestIndex([], 5)).toBe(-1);
    });

    it('returns 0 for single element', () => {
      const w = createWrapper();
      expect(w.vm.findNearestIndex([10], 5)).toBe(0);
    });

    it('finds exact match', () => {
      const w = createWrapper();
      expect(w.vm.findNearestIndex([10, 20, 30], 20)).toBe(1);
    });

    it('finds nearest lower value', () => {
      const w = createWrapper();
      expect(w.vm.findNearestIndex([10, 20, 30], 18)).toBe(1);
    });

    it('finds nearest higher value', () => {
      const w = createWrapper();
      expect(w.vm.findNearestIndex([10, 20, 30], 22)).toBe(1);
    });

    it('returns first element for equal distance', () => {
      const w = createWrapper();
      // 15 is equidistant from 10 and 20 — should return 0 (first match)
      expect(w.vm.findNearestIndex([10, 20, 30], 15)).toBe(0);
    });

    it('handles negative values', () => {
      const w = createWrapper();
      expect(w.vm.findNearestIndex([-30, -20, -10], -22)).toBe(1);
    });
  });

  describe('positionTooltip', () => {
    it('clamps tooltip x to minimum 40', () => {
      const w = createWrapper();

      const container = document.createElement('div');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({ left: 100, top: 200, width: 500, height: 300 }),
      });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        paddingLeft: '10',
        paddingTop: '10',
      } as unknown as CSSStyleDeclaration);

      const event = { clientX: 110, clientY: 250 } as MouseEvent;
      w.vm.positionTooltip(event, container);

      // rawX = 110 - 100 - 10 = 0 → clamped to 40
      expect(w.vm.tooltip.x).toBe(40);
      // rawY = 250 - 200 - 10 = 40 → max(20, 40) = 40
      expect(w.vm.tooltip.y).toBe(40);
    });

    it('clamps tooltip x to maximum (width - 2*padLeft - 40)', () => {
      const w = createWrapper();

      const container = document.createElement('div');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 200, height: 300 }),
      });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        paddingLeft: '10',
        paddingTop: '10',
      } as unknown as CSSStyleDeclaration);

      const event = { clientX: 190, clientY: 50 } as MouseEvent;
      w.vm.positionTooltip(event, container);

      // rawX = 190 - 0 - 10 = 180
      // max bound = 200 - 20 - 40 = 140
      // clamped to min(180, 140) = 140, max(40, 140) = 140
      expect(w.vm.tooltip.x).toBe(140);
    });

    it('clamps tooltip y to minimum 20', () => {
      const w = createWrapper();

      const container = document.createElement('div');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 100, width: 500, height: 300 }),
      });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        paddingLeft: '0',
        paddingTop: '0',
      } as unknown as CSSStyleDeclaration);

      const event = { clientX: 100, clientY: 105 } as MouseEvent;
      w.vm.positionTooltip(event, container);

      // rawY = 105 - 100 - 0 = 5 → max(20, 5) = 20
      expect(w.vm.tooltip.y).toBe(20);
    });
  });

  describe('onBarMouseEnter', () => {
    it('sets tooltip state when container is found', () => {
      const w = createWrapper();

      const container = document.createElement('div');
      container.classList.add('tooltip-area');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 500, height: 300 }),
      });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        paddingLeft: '0',
        paddingTop: '0',
      } as unknown as CSSStyleDeclaration);

      const target = document.createElement('span');
      container.appendChild(target);
      vi.spyOn(target, 'closest').mockReturnValue(container);

      const event = {
        target,
        clientX: 100,
        clientY: 50,
      } as unknown as MouseEvent;

      w.vm.onBarMouseEnter(event, 'Test tooltip', 'bar-chart');

      expect(w.vm.tooltip.visible).toBe(true);
      expect(w.vm.tooltip.content).toBe('Test tooltip');
      expect(w.vm.tooltip.chartId).toBe('bar-chart');
      expect(w.vm.tooltip.highlightIndex).toBe(-1);
    });

    it('does nothing when pinned', () => {
      const w = createWrapper();
      w.vm.tooltip.pinned = true;

      const container = document.createElement('div');
      container.classList.add('tooltip-area');
      const target = document.createElement('span');
      container.appendChild(target);
      vi.spyOn(target, 'closest').mockReturnValue(container);

      const event = {
        target,
        clientX: 100,
        clientY: 50,
      } as unknown as MouseEvent;

      w.vm.onBarMouseEnter(event, 'New content', 'bar-chart');

      expect(w.vm.tooltip.visible).toBe(false);
    });

    it('does nothing when container is not found', () => {
      const w = createWrapper();

      const target = document.createElement('span');
      vi.spyOn(target, 'closest').mockReturnValue(null);

      const event = {
        target,
        clientX: 100,
        clientY: 50,
      } as unknown as MouseEvent;

      w.vm.onBarMouseEnter(event, 'Test tooltip', 'bar-chart');

      expect(w.vm.tooltip.visible).toBe(false);
    });

    it('uses custom container selector when provided', () => {
      const w = createWrapper();

      const container = document.createElement('div');
      container.classList.add('custom-container');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 500, height: 300 }),
      });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        paddingLeft: '0',
        paddingTop: '0',
      } as unknown as CSSStyleDeclaration);

      const target = document.createElement('span');
      const closestSpy = vi.spyOn(target, 'closest');
      closestSpy.mockImplementation((selector: string) => {
        if (selector === '.custom-container') return container;
        return null;
      });

      const event = {
        target,
        clientX: 100,
        clientY: 50,
      } as unknown as MouseEvent;

      w.vm.onBarMouseEnter(event, 'Custom', 'bar-chart', '.custom-container');

      expect(closestSpy).toHaveBeenCalledWith('.custom-container');
      expect(w.vm.tooltip.visible).toBe(true);
    });
  });

  describe('onChartMouseMove', () => {
    function createSvgMocks(svgX: number) {
      const container = document.createElement('div');
      container.classList.add('tooltip-area');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 500, height: 300 }),
      });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        paddingLeft: '0',
        paddingTop: '0',
      } as unknown as CSSStyleDeclaration);

      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const mockPt = { x: 0, y: 0, matrixTransform: () => ({ x: svgX, y: 50 }) };
      Object.defineProperty(svgEl, 'createSVGPoint', {
        value: () => mockPt,
        configurable: true,
      });
      Object.defineProperty(svgEl, 'getScreenCTM', {
        value: () => ({ inverse: () => ({}) }),
        configurable: true,
      });

      container.appendChild(svgEl);

      const target = document.createElement('rect');
      svgEl.appendChild(target);
      vi.spyOn(target, 'closest').mockImplementation((sel: string) => {
        if (sel === 'svg') return svgEl;
        if (sel === '.tooltip-area') return container;
        return null;
      });

      return { target, container, svgEl };
    }

    it('shows tooltip at nearest coordinate', () => {
      const w = createWrapper();
      const { target } = createSvgMocks(28);

      const coords = [{ x: 10 }, { x: 20 }, { x: 30 }];
      const format = (i: number) => `Point ${i}`;
      const event = { target, clientX: 100, clientY: 50 } as unknown as MouseEvent;

      w.vm.onChartMouseMove(event, coords, format, 'test-chart');

      expect(w.vm.tooltip.visible).toBe(true);
      expect(w.vm.tooltip.content).toBe('Point 2');
      expect(w.vm.tooltip.chartId).toBe('test-chart');
      expect(w.vm.tooltip.highlightIndex).toBe(2);
    });

    it('does nothing when pinned', () => {
      const w = createWrapper();
      w.vm.tooltip.pinned = true;

      const { target } = createSvgMocks(25);
      const event = { target, clientX: 100, clientY: 50 } as unknown as MouseEvent;

      w.vm.onChartMouseMove(event, [{ x: 10 }], () => 'content', 'test');

      expect(w.vm.tooltip.visible).toBe(false);
    });

    it('does nothing with empty coords', () => {
      const w = createWrapper();
      const { target } = createSvgMocks(25);
      const event = { target, clientX: 100, clientY: 50 } as unknown as MouseEvent;

      w.vm.onChartMouseMove(event, [], () => 'content', 'test');

      expect(w.vm.tooltip.visible).toBe(false);
    });

    it('does nothing when getScreenCTM returns null', () => {
      const w = createWrapper();

      const container = document.createElement('div');
      container.classList.add('tooltip-area');

      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      Object.defineProperty(svgEl, 'getScreenCTM', {
        value: () => null,
        configurable: true,
      });
      container.appendChild(svgEl);

      const target = document.createElement('rect');
      svgEl.appendChild(target);
      vi.spyOn(target, 'closest').mockImplementation((sel: string) => {
        if (sel === 'svg') return svgEl;
        if (sel === '.tooltip-area') return container;
        return null;
      });

      const event = { target, clientX: 100, clientY: 50 } as unknown as MouseEvent;

      w.vm.onChartMouseMove(event, [{ x: 10 }], () => 'content', 'test');

      expect(w.vm.tooltip.visible).toBe(false);
    });
  });

  describe('onChartClick', () => {
    function createSvgMocks(svgX: number) {
      const container = document.createElement('div');
      container.classList.add('tooltip-area');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 500, height: 300 }),
      });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        paddingLeft: '0',
        paddingTop: '0',
      } as unknown as CSSStyleDeclaration);

      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const mockPt = { x: 0, y: 0, matrixTransform: () => ({ x: svgX, y: 50 }) };
      Object.defineProperty(svgEl, 'createSVGPoint', {
        value: () => mockPt,
        configurable: true,
      });
      Object.defineProperty(svgEl, 'getScreenCTM', {
        value: () => ({ inverse: () => ({}) }),
        configurable: true,
      });

      container.appendChild(svgEl);

      const target = document.createElement('rect');
      svgEl.appendChild(target);
      vi.spyOn(target, 'closest').mockImplementation((sel: string) => {
        if (sel === 'svg') return svgEl;
        if (sel === '.tooltip-area') return container;
        return null;
      });

      return { target, container, svgEl };
    }

    it('pins tooltip on click', () => {
      const w = createWrapper();
      const { target } = createSvgMocks(15);

      const coords = [{ x: 10 }, { x: 20 }];
      const format = (i: number) => `Point ${i}`;
      const event = { target, clientX: 100, clientY: 50 } as unknown as MouseEvent;

      w.vm.onChartClick(event, coords, format, 'test-chart');

      expect(w.vm.tooltip.visible).toBe(true);
      expect(w.vm.tooltip.pinned).toBe(true);
      expect(w.vm.tooltip.content).toBe('Point 0');
    });

    it('unpins when clicking same chart while pinned', () => {
      const w = createWrapper();
      w.vm.tooltip.pinned = true;
      w.vm.tooltip.chartId = 'test-chart';

      const { target } = createSvgMocks(15);
      const event = { target, clientX: 100, clientY: 50 } as unknown as MouseEvent;

      w.vm.onChartClick(event, [{ x: 10 }], () => 'content', 'test-chart');

      expect(w.vm.tooltip.pinned).toBe(false);
    });

    it('does not pin when onChartMouseMove fails to show tooltip', () => {
      const w = createWrapper();

      const container = document.createElement('div');
      container.classList.add('tooltip-area');

      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      Object.defineProperty(svgEl, 'getScreenCTM', {
        value: () => null,
        configurable: true,
      });
      container.appendChild(svgEl);

      const target = document.createElement('rect');
      svgEl.appendChild(target);
      vi.spyOn(target, 'closest').mockImplementation((sel: string) => {
        if (sel === 'svg') return svgEl;
        if (sel === '.tooltip-area') return container;
        return null;
      });

      const event = { target, clientX: 100, clientY: 50 } as unknown as MouseEvent;

      w.vm.onChartClick(event, [{ x: 10 }], () => 'content', 'test');

      // Bug fix: should NOT be pinned since tooltip wasn't shown
      expect(w.vm.tooltip.pinned).toBe(false);
      expect(w.vm.tooltip.visible).toBe(false);
    });
  });

  describe('instance isolation', () => {
    it('two instances have independent tooltip state', () => {
      const w1 = createWrapper();
      const w2 = createWrapper();

      w1.vm.tooltip.visible = true;
      w1.vm.tooltip.content = 'Instance 1';
      w1.vm.tooltip.chartId = 'chart-1';

      expect(w2.vm.tooltip.visible).toBe(false);
      expect(w2.vm.tooltip.content).toBe('');
      expect(w2.vm.tooltip.chartId).toBe('');
    });

    it('dismissing one instance does not affect the other', () => {
      const w1 = createWrapper();
      const w2 = createWrapper();

      w1.vm.tooltip.visible = true;
      w1.vm.tooltip.chartId = 'chart-1';
      w2.vm.tooltip.visible = true;
      w2.vm.tooltip.chartId = 'chart-2';

      w1.vm.dismissTooltip();

      expect(w1.vm.tooltip.visible).toBe(false);
      expect(w2.vm.tooltip.visible).toBe(true);
      expect(w2.vm.tooltip.chartId).toBe('chart-2');
    });
  });
});
