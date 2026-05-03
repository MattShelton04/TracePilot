/**
 * Format a number into a compact string representation (e.g. 1,200 -> 1.2k).
 * Strips trailing .0 for a cleaner look.
 *
 * @param value The numeric value to format
 * @param decimals Number of decimal places for the compact form (default: 1)
 * @returns Formatted string
 */
export function formatCompactNumber(value: number, decimals = 1): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(decimals).replace(/\.0+$/, "")}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(decimals).replace(/\.0+$/, "")}k`;
  }
  return value.toString();
}
