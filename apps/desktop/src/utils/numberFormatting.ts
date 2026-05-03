import { formatNumber } from "@tracepilot/types";

/**
 * Format a number into a compact string representation (e.g. 1,200 -> 1.2K).
 * Strips trailing .0 for a cleaner look.
 *
 * @param value The numeric value to format
 * @returns Formatted string
 */
export function formatCompactNumber(value: number): string {
  return formatNumber(value);
}
