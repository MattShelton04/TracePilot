/**
 * analytics — pure helpers for analytics views.
 */

export interface HeatmapEntry {
  /** Day of week, 0=Sunday … 6=Saturday (matches backend convention). */
  day: number;
  /** Hour of day in UTC, 0–23. */
  hour: number;
  /** Activity count at this UTC slot. */
  count: number;
}

/**
 * Convert a list of UTC-keyed (day, hour, count) heatmap entries into a
 * 7×24 local-timezone grid (`grid[day][hour]`).
 *
 * The rotation handles day-of-week wrap-around when the offset pushes a
 * given hour across midnight in either direction.
 *
 * @param entries     Backend-provided UTC heatmap entries.
 * @param tzOffsetMin Local timezone offset in minutes east of UTC
 *                    (e.g. +330 for IST, -480 for PST, -240 for EDT).
 *                    Use `-new Date().getTimezoneOffset()` in the browser.
 */
export function localizeHeatmap(entries: HeatmapEntry[], tzOffsetMin: number): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

  for (const entry of entries) {
    if (entry.day < 0 || entry.day >= 7 || entry.hour < 0 || entry.hour >= 24) continue;

    const utcMinutes = entry.hour * 60;
    const localMinutes = utcMinutes + tzOffsetMin;
    // Floor-divide handles negative offsets that drop below zero.
    let localHour = Math.floor(localMinutes / 60);
    let localDay = entry.day;

    // Normalize hour into [0, 24) while shifting the day accordingly.
    while (localHour >= 24) {
      localHour -= 24;
      localDay = (localDay + 1) % 7;
    }
    while (localHour < 0) {
      localHour += 24;
      localDay = (localDay + 6) % 7;
    }

    grid[localDay][localHour] += entry.count;
  }

  return grid;
}
