/**
 * Centralized chart color palette for TracePilot.
 * All chart colors should reference these constants rather than hardcoding hex values.
 * CSS custom properties (--chart-*) are defined in design-tokens.css for use in <style> blocks.
 *
 * This module now reads colors from CSS variables at runtime, ensuring consistency
 * between static (CSS) and dynamic (JS-driven charts) visuals, and enabling theme support.
 */

import { getChartColors } from "./designTokens";

/**
 * Chart color constants derived from design tokens.
 * These values are read from CSS custom properties and will reflect the active theme.
 *
 * Note: Values are computed at module load time. If you need theme-reactive colors,
 * call getChartColors() directly after theme changes.
 */
export const CHART_COLORS = getChartColors();

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
