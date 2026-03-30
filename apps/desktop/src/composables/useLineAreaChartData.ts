import type { ChartCoord, ChartLayout, XAxisLabel, YAxisLabel } from "@tracepilot/ui";
import {
  formatDateShort,
  generateXLabels,
  generateYLabels,
  mapToLineCoords,
  toAreaPoints,
  toPolylinePoints,
} from "@tracepilot/ui";
import type { ComputedRef, Ref } from "vue";
import { computed } from "vue";

// ── Types ────────────────────────────────────────────────────────────

/** Options for the line/area chart composable. */
export interface UseLineAreaChartDataOptions<T> {
  /** Reactive data source (may be null while loading). */
  data: Ref<T[] | null | undefined> | ComputedRef<T[] | null | undefined>;
  /** Chart layout dimensions. */
  layout: ChartLayout;
  /** Extract the numeric Y value from each data point. */
  accessor: (item: T) => number;
  /** Minimum number of data points required to render a chart (default: 2). */
  minPoints?: number;
  /** Number of Y-axis tick marks to generate (default: 5). */
  yTicks?: number;
  /** Formatter for Y-axis label values. */
  yFormatter?: (value: number) => string;
  /** Floor value for the Y-axis maximum to prevent flat charts (default: 1). */
  maxFloor?: number;
}

/** Computed chart data for rendering a line/area chart. */
export interface LineAreaChartResult<T> {
  coords: (T & ChartCoord)[];
  linePoints: string;
  areaPoints: string;
  yLabels: YAxisLabel[];
  xLabels: XAxisLabel[];
}

// ── Composable ───────────────────────────────────────────────────────

/**
 * Generic composable for line/area chart coordinate computation.
 *
 * Maps an array of date-keyed data points to SVG coordinates suitable for
 * rendering line charts, area fills, axis labels, and highlight dots.
 *
 * @returns An object containing:
 *   - `chartData` — Computed chart coordinates, polyline/area strings, and axis labels (null when data is insufficient).
 *   - `gridLines` — Computed Y positions derived from the Y-axis labels, suitable for horizontal grid-line rendering.
 *
 * @example
 * ```ts
 * const { chartData, gridLines } = useLineAreaChartData({
 *   data: computed(() => analytics.value?.tokenUsageByDay ?? null),
 *   layout: chartLayout,
 *   accessor: (p) => p.tokens,
 *   yFormatter: formatNumber,
 * });
 * ```
 */
export function useLineAreaChartData<T extends { date: string }>(
  options: UseLineAreaChartDataOptions<T>,
) {
  const {
    data,
    layout,
    accessor,
    minPoints = 2,
    yTicks = 5,
    yFormatter = (v: number) => String(v),
    maxFloor = 1,
  } = options;

  const chartData = computed((): LineAreaChartResult<T> | null => {
    const pts = data.value;
    if (!pts || pts.length < minPoints) return null;

    const max = Math.max(...pts.map(accessor), maxFloor);
    const coords = mapToLineCoords(pts, layout, accessor, max);
    const linePoints = toPolylinePoints(coords);
    const areaPoints = toAreaPoints(coords, layout);
    const yLabels = generateYLabels(max, layout, yTicks, yFormatter);
    const xLabels = generateXLabels(
      coords,
      (c) => c.x,
      (c) => formatDateShort(c.date),
    );

    return { coords, linePoints, areaPoints, yLabels, xLabels };
  });

  const gridLines = computed(() => chartData.value?.yLabels.map((yl) => yl.y) ?? []);

  return { chartData, gridLines };
}
