/**
 * Helpers for morphing a chart from one set of results to the next. Columns
 * are placed by their centre, in percent of the plot width, so an old shape
 * can be read at any new column's position even when the count changes.
 */

/** A column's centre, in percent of the plot width. */
export const columnCentre = (i: number, count: number) => ((i + 0.5) / count) * 100;

/** The value at `x` along points sorted by x: linear between, held at the ends. */
export function sampleAt(points: readonly (readonly [number, number])[], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  let hi = points.findIndex(([px]) => px >= x);
  if (hi <= 0) hi = 1;
  const [x0, y0] = points[hi - 1];
  const [x1, y1] = points[hi];
  return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** Read a series drawn over `values.length` columns at each of `count` columns. */
export function resample(values: readonly number[], count: number): number[] {
  if (values.length === count) return [...values];
  const points = values.map((v, i) => [columnCentre(i, values.length), v] as const);
  return Array.from({ length: count }, (_, i) => sampleAt(points, columnCentre(i, count)));
}

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
