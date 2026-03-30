/**
 * Design token utilities for reading CSS custom properties at runtime.
 *
 * This module provides a bridge between the design system (defined in design-tokens.css)
 * and JavaScript/TypeScript code that needs to use colors programmatically (e.g., Chart.js,
 * canvas animations, SVG manipulation).
 *
 * ⚠️ **Theme Reactivity Limitation**: Color values are captured at the time these functions
 * are called. If users switch themes (dark/light), components must manually re-read colors
 * or use Vue computed properties to track theme changes.
 *
 * Usage:
 * ```ts
 * import { getDesignToken, getChartColors } from '@/utils/designTokens'
 *
 * const accentColor = getDesignToken('--accent-fg')
 * const colors = getChartColors()
 * ```
 *
 * For theme-reactive colors in Vue components, use computed:
 * ```vue
 * <script setup>
 * import { computed } from 'vue'
 * import { usePreferencesStore } from '@/stores/preferences'
 * import { getChartColors } from '@/utils/designTokens'
 *
 * const prefs = usePreferencesStore()
 * const chartColors = computed(() => {
 *   const _ = prefs.theme  // Track theme changes
 *   return getChartColors()
 * })
 * </script>
 * ```
 */

/**
 * Read a CSS custom property value from the document root.
 *
 * @param propertyName - CSS variable name including `--` prefix (e.g., '--accent-fg')
 * @param fallback - Optional fallback value if CSS variable is not defined
 * @returns The computed CSS variable value, trimmed of whitespace
 *
 * @example
 * const accentColor = getDesignToken('--accent-fg', '#818cf8')
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
    success: getDesignToken("--chart-success", "#34d399"),
    successLight: getDesignToken("--chart-success-light", "#6ee7b7"),
    danger: getDesignToken("--chart-danger", "#fb7185"),
    dangerLight: getDesignToken("--chart-danger-light", "#fca5a5"),
    primary: getDesignToken("--chart-primary", "#6366f1"),
    primaryLight: getDesignToken("--chart-primary-light", "#818cf8"),
    secondary: getDesignToken("--chart-secondary", "#a78bfa"),
    warning: getDesignToken("--chart-warning", "#fbbf24"),
    warningLight: getDesignToken("--chart-warning-light", "#fde68a"),
    info: getDesignToken("--chart-info", "#38bdf8"),
    cyan: getDesignToken("--chart-cyan", "#22d3ee"),
    orange: getDesignToken("--chart-orange", "#f97316"),
    lime: getDesignToken("--chart-lime", "#84cc16"),
  } as const;
}

/**
 * Agent color palette derived from design tokens.
 * Used for agent tree visualization and subagent UI elements.
 */
export function getAgentColors() {
  return {
    main: getDesignToken("--agent-color-main", "#6366f1"),
    explore: getDesignToken("--agent-color-explore", "#22d3ee"),
    generalPurpose: getDesignToken("--agent-color-general-purpose", "#a78bfa"),
    codeReview: getDesignToken("--agent-color-code-review", "#f472b6"),
    task: getDesignToken("--agent-color-task", "#fbbf24"),
  } as const;
}

/**
 * Status colors for todo/task visualization.
 * Maps semantic status names to CSS variable values.
 */
export function getStatusColors() {
  return {
    done: getDesignToken("--success-fg", "#34d399"),
    inProgress: getDesignToken("--accent-fg", "#818cf8"),
    pending: getDesignToken("--neutral-fg", "#a1a1aa"),
    blocked: getDesignToken("--danger-fg", "#fb7185"),
  } as const;
}

/**
 * Semantic color tokens for general UI use.
 */
export function getSemanticColors() {
  return {
    accentFg: getDesignToken("--accent-fg", "#818cf8"),
    accentEmphasis: getDesignToken("--accent-emphasis", "#6366f1"),
    successFg: getDesignToken("--success-fg", "#34d399"),
    warningFg: getDesignToken("--warning-fg", "#fbbf24"),
    dangerFg: getDesignToken("--danger-fg", "#fb7185"),
    doneFg: getDesignToken("--done-fg", "#a78bfa"),
    neutralFg: getDesignToken("--neutral-fg", "#a1a1aa"),
    textPrimary: getDesignToken("--text-primary", "#fafafa"),
    textSecondary: getDesignToken("--text-secondary", "#a1a1aa"),
    textTertiary: getDesignToken("--text-tertiary", "#71717a"),
  } as const;
}
