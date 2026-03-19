/**
 * Centralized chart color palette for TracePilot.
 * All chart colors should reference these constants rather than hardcoding hex values.
 * CSS custom properties (--chart-*) are defined in styles.css for use in <style> blocks.
 */

export const CHART_COLORS = {
  success: '#34d399',
  successLight: '#6ee7b7',
  danger: '#fb7185',
  dangerLight: '#fca5a5',
  primary: '#6366f1',
  primaryLight: '#818cf8',
  secondary: '#a78bfa',
  warning: '#fbbf24',
  info: '#38bdf8',
  cyan: '#22d3ee',
  orange: '#f97316',
  lime: '#84cc16',
} as const;

/** Default palette for donut/pie charts. */
export const DONUT_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.danger,
  CHART_COLORS.info,
];

/** Color palette for model comparison charts. */
export const MODEL_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.danger,
  CHART_COLORS.secondary,
  CHART_COLORS.cyan,
  CHART_COLORS.orange,
  CHART_COLORS.lime,
];
