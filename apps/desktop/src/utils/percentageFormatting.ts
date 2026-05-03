/**
 * Format a number as a percentage string (e.g. 0.123 -> "12.3%").
 *
 * @param value The numeric value (either a ratio 0..1 or a percentage 0..100)
 * @param options Formatting options
 * @returns Formatted string
 */
export function formatPercent(
  value: number,
  options: {
    /** If true, multiplies value by 100 (default: false) */
    isRatio?: boolean;
    /** Number of decimal places (default: 1) */
    decimals?: number;
  } = {},
): string {
  const { isRatio = false, decimals = 1 } = options;
  const pct = isRatio ? value * 100 : value;
  return `${pct.toFixed(decimals)}%`;
}
