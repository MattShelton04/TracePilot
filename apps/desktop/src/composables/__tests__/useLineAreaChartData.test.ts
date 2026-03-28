import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import { createChartLayout } from '@tracepilot/ui';
import { useLineAreaChartData } from '../useLineAreaChartData';

const layout = createChartLayout(55, 490, 20, 175);

function makePoints(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    date: `2025-01-${String(i + 1).padStart(2, '0')}`,
    tokens: (i + 1) * 100,
  }));
}

describe('useLineAreaChartData', () => {
  describe('chartData', () => {
    it('returns null when data is null', () => {
      const { chartData } = useLineAreaChartData({
        data: ref(null),
        layout,
        accessor: (p: { tokens: number }) => p.tokens,
      });
      expect(chartData.value).toBeNull();
    });

    it('returns null when data is undefined', () => {
      const { chartData } = useLineAreaChartData({
        data: ref(undefined),
        layout,
        accessor: (p: { tokens: number }) => p.tokens,
      });
      expect(chartData.value).toBeNull();
    });

    it('returns null when data has fewer points than minPoints', () => {
      const { chartData } = useLineAreaChartData({
        data: ref(makePoints(1)),
        layout,
        accessor: (p) => p.tokens,
      });
      expect(chartData.value).toBeNull();
    });

    it('returns null for empty array', () => {
      const { chartData } = useLineAreaChartData({
        data: ref([]),
        layout,
        accessor: (p: { date: string; tokens: number }) => p.tokens,
      });
      expect(chartData.value).toBeNull();
    });

    it('returns chart data for valid input', () => {
      const { chartData } = useLineAreaChartData({
        data: ref(makePoints(5)),
        layout,
        accessor: (p) => p.tokens,
      });
      const result = chartData.value;
      expect(result).not.toBeNull();
      expect(result!.coords).toHaveLength(5);
      expect(result!.linePoints).toContain(',');
      expect(result!.areaPoints).toContain(',');
      expect(result!.yLabels.length).toBeGreaterThan(0);
      expect(result!.xLabels.length).toBeGreaterThan(0);
    });

    it('preserves original data properties on coords', () => {
      const { chartData } = useLineAreaChartData({
        data: ref(makePoints(3)),
        layout,
        accessor: (p) => p.tokens,
      });
      const coords = chartData.value!.coords;
      expect(coords[0]).toHaveProperty('date', '2025-01-01');
      expect(coords[0]).toHaveProperty('tokens', 100);
      expect(coords[0]).toHaveProperty('x');
      expect(coords[0]).toHaveProperty('y');
    });

    it('uses custom yFormatter', () => {
      const { chartData } = useLineAreaChartData({
        data: ref(makePoints(3)),
        layout,
        accessor: (p) => p.tokens,
        yFormatter: (v) => `$${v.toFixed(2)}`,
      });
      const labels = chartData.value!.yLabels;
      expect(labels[0].value).toMatch(/^\$/);
    });

    it('uses custom minPoints threshold', () => {
      const { chartData } = useLineAreaChartData({
        data: ref(makePoints(1)),
        layout,
        accessor: (p) => p.tokens,
        minPoints: 1,
      });
      expect(chartData.value).not.toBeNull();
      expect(chartData.value!.coords).toHaveLength(1);
    });

    it('uses maxFloor to prevent flat charts', () => {
      const zeroPts = [
        { date: '2025-01-01', tokens: 0 },
        { date: '2025-01-02', tokens: 0 },
      ];
      const { chartData } = useLineAreaChartData({
        data: ref(zeroPts),
        layout,
        accessor: (p) => p.tokens,
        maxFloor: 100,
      });
      // All points should be at the bottom of the chart
      expect(chartData.value).not.toBeNull();
      expect(chartData.value!.coords[0].y).toBe(layout.bottom);
    });

    it('generates correct number of yTicks', () => {
      const { chartData } = useLineAreaChartData({
        data: ref(makePoints(5)),
        layout,
        accessor: (p) => p.tokens,
        yTicks: 3,
      });
      expect(chartData.value!.yLabels).toHaveLength(3);
    });

    it('reacts to data changes', () => {
      const dataRef = ref(makePoints(3));
      const { chartData } = useLineAreaChartData({
        data: dataRef,
        layout,
        accessor: (p) => p.tokens,
      });
      expect(chartData.value!.coords).toHaveLength(3);

      dataRef.value = makePoints(5);
      expect(chartData.value!.coords).toHaveLength(5);
    });

    it('works with ComputedRef', () => {
      const raw = ref(makePoints(4));
      const data = computed(() => raw.value);
      const { chartData } = useLineAreaChartData({
        data,
        layout,
        accessor: (p) => p.tokens,
      });
      expect(chartData.value!.coords).toHaveLength(4);
    });
  });

  describe('gridLines', () => {
    it('returns empty array when chartData is null', () => {
      const { gridLines } = useLineAreaChartData({
        data: ref(null),
        layout,
        accessor: (p: { tokens: number }) => p.tokens,
      });
      expect(gridLines.value).toEqual([]);
    });

    it('returns Y positions from yLabels', () => {
      const { gridLines, chartData } = useLineAreaChartData({
        data: ref(makePoints(5)),
        layout,
        accessor: (p) => p.tokens,
      });
      expect(gridLines.value).toHaveLength(chartData.value!.yLabels.length);
      expect(gridLines.value).toEqual(chartData.value!.yLabels.map((l) => l.y));
    });
  });
});
