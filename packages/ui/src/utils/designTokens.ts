/**
 * Design token utilities for reading CSS custom properties at runtime.
 *
 * This module provides a bridge between the design system (defined in
 * `@tracepilot/ui/tokens.css`) and JavaScript/TypeScript code that needs to
 * use colors programmatically (e.g., Chart.js, canvas animations, SVG
 * manipulation).
 *
 * These readers rely on the canonical CSS custom properties shipped in
 * `@tracepilot/ui/tokens.css`. Consumers MUST import that stylesheet before
 * any component that calls these functions renders; otherwise readers will
 * return an empty string. No hardcoded hex fallbacks are defined here — the
 * single source of truth for token values is `tokens.css`.
 *
 * ⚠️ **Theme Reactivity Limitation**: Color values are captured at the time
 * these functions are called. If users switch themes (dark/light), components
 * must manually re-read colors or use Vue computed properties to track theme
 * changes.
 *
 * Usage:
 * ```ts
 * import { getDesignToken, getChartColors } from "@tracepilot/ui";
 *
 * const accentColor = getDesignToken("--accent-fg");
 * const colors = getChartColors();
 * ```
 *
 * For theme-reactive colors in Vue components, use computed:
 * ```vue
 * <script setup>
 * import { computed } from "vue";
 * import { getChartColors } from "@tracepilot/ui";
 *
 * const chartColors = computed(() => {
 *   const _ = prefs.theme; // Track theme changes
 *   return getChartColors();
 * });
 * </script>
 * ```
 */

/**
 * Read a CSS custom property value from the document root.
 *
 * @param propertyName - CSS variable name including `--` prefix (e.g., '--accent-fg')
 * @param fallback - Optional fallback value if CSS variable is not defined. Callers
 *                   should normally omit this — the canonical values live in
 *                   `@tracepilot/ui/tokens.css`.
 * @returns The computed CSS variable value, trimmed of whitespace
 */
export function getDesignToken(propertyName: string, fallback = ""): string {
  // Require a mounted DOM to read computed styles
  if (typeof window === "undefined" || !document.documentElement) {
    return fallback;
  }

  const value = getComputedStyle(document.documentElement).getPropertyValue(propertyName).trim();

  return value || fallback;
}

/**
 * Chart color palette derived from design tokens.
 * Matches the structure of the legacy CHART_COLORS object.
 *
 * Call this function after component mount to ensure CSS is loaded.
 */
export function getChartColors() {
  return {
    success: getDesignToken("--chart-success"),
    successLight: getDesignToken("--chart-success-light"),
    danger: getDesignToken("--chart-danger"),
    dangerLight: getDesignToken("--chart-danger-light"),
    primary: getDesignToken("--chart-primary"),
    primaryLight: getDesignToken("--chart-primary-light"),
    secondary: getDesignToken("--chart-secondary"),
    warning: getDesignToken("--chart-warning"),
    warningLight: getDesignToken("--chart-warning-light"),
    info: getDesignToken("--chart-info"),
    cyan: getDesignToken("--chart-cyan"),
    orange: getDesignToken("--chart-orange"),
    lime: getDesignToken("--chart-lime"),
  } as const;
}

/**
 * Agent color palette derived from design tokens.
 * Used for agent tree visualization and subagent UI elements.
 */
export function getAgentColors() {
  return {
    main: getDesignToken("--agent-color-main"),
    explore: getDesignToken("--agent-color-explore"),
    generalPurpose: getDesignToken("--agent-color-general-purpose"),
    codeReview: getDesignToken("--agent-color-code-review"),
    rubberDuck: getDesignToken("--agent-color-rubber-duck"),
    task: getDesignToken("--agent-color-task"),
  } as const;
}

/**
 * Status colors for todo/task visualization.
 * Maps semantic status names to CSS variable values.
 */
export function getStatusColors() {
  return {
    done: getDesignToken("--success-fg"),
    inProgress: getDesignToken("--accent-fg"),
    pending: getDesignToken("--neutral-fg"),
    blocked: getDesignToken("--danger-fg"),
  } as const;
}

/**
 * Semantic color tokens for general UI use.
 */
export function getSemanticColors() {
  return {
    accentFg: getDesignToken("--accent-fg"),
    accentEmphasis: getDesignToken("--accent-emphasis"),
    successFg: getDesignToken("--success-fg"),
    warningFg: getDesignToken("--warning-fg"),
    dangerFg: getDesignToken("--danger-fg"),
    doneFg: getDesignToken("--done-fg"),
    neutralFg: getDesignToken("--neutral-fg"),
    textPrimary: getDesignToken("--text-primary"),
    textSecondary: getDesignToken("--text-secondary"),
    textTertiary: getDesignToken("--text-tertiary"),
  } as const;
}
