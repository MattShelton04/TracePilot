/**
 * Shared chart geometry utilities for SVG chart rendering.
 *
 * Extracts common coordinate mapping, axis label generation, and layout
 * calculations used across multiple analytics views.
 */

// ── Types ────────────────────────────────────────────────────────────

/** Chart boundary dimensions derived from edge coordinates. */
export interface ChartLayout {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** A point with SVG x/y coordinates. */
export interface ChartCoord {
  x: number;
  y: number;
}

/** Y-axis label with display value and Y coordinate. */
export interface YAxisLabel {
  value: string;
  y: number;
}

/** X-axis label with display text and X coordinate. */
export interface XAxisLabel {
  label: string;
  x: number;
}

// ── Layout ───────────────────────────────────────────────────────────

/** Create a ChartLayout from edge coordinates. */
export function createChartLayout(
  left: number,
  right: number,
  top: number,
  bottom: number,
): ChartLayout {
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

// ── Grid & Axes ──────────────────────────────────────────────────────

/**
 * Compute horizontal grid-line Y positions.
 *
 * @param layout - Chart layout dimensions
 * @param count - Number of grid lines to generate
 * @param divisions - Number of equal divisions across the chart height.
 *   Defaults to `count` when omitted. Pass a different value when the
 *   number of lines differs from the number of divisions (e.g. 5 lines
 *   across 4 divisions to include both the top and bottom edges).
 */
export function computeGridLines(layout: ChartLayout, count: number, divisions?: number): number[] {
  const div = divisions ?? count;
  return Array.from({ length: count }, (_, i) => layout.top + (i * layout.height) / div);
}

/** Compute stride so we show at most `maxLabels` labels. */
export function labelStride(count: number, maxLabels = 10): number {
  return Math.max(1, Math.ceil(count / maxLabels));
}

/**
 * Generate evenly-spaced Y-axis labels.
 *
 * @param max - Maximum data value
 * @param layout - Chart layout dimensions
 * @param ticks - Number of tick marks to generate (including the baseline at 0)
 * @param formatter - Formats a numeric value into display text
 */
export function generateYLabels(
  max: number,
  layout: ChartLayout,
  ticks: number,
  formatter: (value: number) => string,
): YAxisLabel[] {
  if (ticks < 2) return [{ value: formatter(0), y: layout.bottom }];
  const divisions = ticks - 1;
  return Array.from({ length: ticks }, (_, i) => ({
    value: formatter((max / divisions) * i),
    y: layout.bottom - (i * layout.height) / divisions,
  }));
}

/**
 * Generate stride-filtered X-axis labels.
 *
 * @param data - Data items to derive labels from
 * @param xFn - Extracts the X coordinate for each item
 * @param labelFn - Extracts the display label for each item
 * @param maxLabels - Maximum number of labels to show (default 10)
 */
export function generateXLabels<T>(
  data: T[],
  xFn: (item: T, index: number) => number,
  labelFn: (item: T, index: number) => string,
  maxLabels = 10,
): XAxisLabel[] {
  const stride = labelStride(data.length, maxLabels);
  return data
    .map((item, i) => ({ label: labelFn(item, i), x: xFn(item, i) }))
    .filter((_, i) => i % stride === 0);
}

// ── Line & Area Charts ───────────────────────────────────────────────

/**
 * Map data points to SVG coordinates for a line/area chart.
 * Points are spaced evenly across layout.width.
 *
 * **Note:** If `T` already contains properties named `x` or `y`, they
 * will be overwritten by the computed chart coordinates.
 *
 * @param data - Array of data items
 * @param layout - Chart layout dimensions
 * @param accessor - Extracts the numeric value from each item
 * @param max - Optional explicit maximum value for scaling. When omitted
 *   the maximum is derived from the data with a floor of 1.
 */
export function mapToLineCoords<T>(
  data: T[],
  layout: ChartLayout,
  accessor: (item: T) => number,
  max?: number,
): (T & ChartCoord)[] {
  if (data.length === 0) return [];
  const effectiveMax = max ?? Math.max(...data.map(accessor), 1);
  const step = data.length > 1 ? layout.width / (data.length - 1) : layout.width;
  return data.map((item, i) => ({
    ...item,
    x: layout.left + i * step,
    y: layout.bottom - (accessor(item) / effectiveMax) * layout.height,
  }));
}

/** Convert coordinates to a SVG polyline points string. */
export function toPolylinePoints(coords: ChartCoord[]): string {
  return coords.map((c) => `${c.x},${c.y}`).join(' ');
}

/**
 * Convert coordinates to a closed area polygon points string.
 * Closes the shape by extending to the bottom-right and bottom-left corners.
 */
export function toAreaPoints(coords: ChartCoord[], layout: ChartLayout): string {
  if (coords.length === 0) return '';
  const line = toPolylinePoints(coords);
  return `${line} ${layout.right},${layout.bottom} ${layout.left},${layout.bottom}`;
}

// ── Bar Charts ───────────────────────────────────────────────────────

/**
 * Compute a bar width clamped to a min/max range.
 *
 * @param chartWidth - Total width available for bars
 * @param count - Number of bars
 * @param min - Minimum bar width (default 4)
 * @param max - Maximum bar width (default 20)
 * @param gap - Gap between bars (default 2)
 */
export function computeBarWidth(
  chartWidth: number,
  count: number,
  min = 4,
  max = 20,
  gap = 2,
): number {
  if (count <= 0) return min;
  const spacing = chartWidth / count;
  return Math.max(min, Math.min(max, spacing - gap));
}
