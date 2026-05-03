import { formatPercent as sharedFormatPercent, formatRate } from "@tracepilot/types";

/**
 * Format a number as a percentage string (e.g. 0.123 -> "12.3%").
 * Strips trailing .0 for a cleaner look.
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
  } = {},
): string {
  const { isRatio = false } = options;
  return isRatio ? formatRate(value) : sharedFormatPercent(value);
}
