import type { ChartLayout, XAxisLabel } from "@tracepilot/ui";
import {
  computeBarWidth,
  formatDateMedium,
  formatDateShort,
  generateXLabels,
} from "@tracepilot/ui";
import type { ComputedRef, Ref } from "vue";
import { computed } from "vue";

// ── Types ────────────────────────────────────────────────────────────

/** A single day's incident data (matches AnalyticsData.incidentsByDay shape). */
export interface IncidentPoint {
  date: string;
  errors: number;
  rateLimits: number;
  compactions: number;
  truncations: number;
}

/** A single day's session activity count (matches AnalyticsData.activityPerDay shape). */
export interface ActivityPoint {
  date: string;
  count: number;
}

/** Stacked bar data for a single day in the incident chart. */
export interface IncidentBar {
  x: number;
  date: string;
  rateLimits: number;
  otherErrors: number;
  compactions: number;
  truncations: number;
  rawRateLimits: number;
  rawOtherErrors: number;
  rawCompactions: number;
  rawTruncations: number;
  total: number;
  truncRect: { y: number; h: number };
  compRect: { y: number; h: number };
  otherRect: { y: number; h: number };
  rlRect: { y: number; h: number };
}

/** Computed chart data for the incident stacked bar chart. */
export interface IncidentChartData {
  bars: IncidentBar[];
  yLabels: { value: string; y: number }[];
  xLabels: XAxisLabel[];
  barW: number;
  maxVal: number;
}

/** Options for the incident chart composable. */
export interface UseIncidentChartDataOptions {
  /** Reactive incident-per-day data. */
  incidents:
    | Ref<IncidentPoint[] | null | undefined>
    | ComputedRef<IncidentPoint[] | null | undefined>;
  /** Reactive session-activity-per-day data (used for normalization). */
  activity:
    | Ref<ActivityPoint[] | null | undefined>
    | ComputedRef<ActivityPoint[] | null | undefined>;
  /** Whether to normalize incident counts per session. */
  normalize: Ref<boolean>;
  /** Chart layout dimensions. */
  layout: ChartLayout;
}

// ── Composable ───────────────────────────────────────────────────────

/**
 * Composable for the incident stacked bar chart.
 *
 * Computes normalized or raw incident data with stacked rectangle
 * positions suitable for SVG rendering, plus axis labels and a tooltip
 * formatter.
 *
 * @example
 * ```ts
 * const { chartData, gridLines, formatTooltip } = useIncidentChartData({
 *   incidents: computed(() => data.value?.incidentsByDay ?? null),
 *   activity: computed(() => data.value?.activityPerDay ?? null),
 *   normalize: incidentNormalize,
 *   layout: chartLayout,
 * });
 * ```
 */
export function useIncidentChartData(options: UseIncidentChartDataOptions) {
  const { incidents, activity, normalize, layout } = options;
  const { left: CHART_LEFT, bottom: CHART_BOTTOM, width: CHART_W, height: CHART_H } = layout;

  const chartData = computed((): IncidentChartData | null => {
    const pts = incidents.value;
    if (!pts?.length) return null;
    const activityPerDay = activity.value ?? [];

    // Build session-count lookup for per-session normalization
    const sessionMap = new Map<string, number>();
    for (const s of activityPerDay) {
      sessionMap.set(s.date, s.count);
    }

    const barData = pts.map((p) => {
      const otherErrors = Math.max(0, p.errors - p.rateLimits);
      const sessions = sessionMap.get(p.date) || 1;
      const norm = normalize.value ? sessions : 1;
      return {
        date: p.date,
        rateLimits: p.rateLimits / norm,
        otherErrors: otherErrors / norm,
        compactions: p.compactions / norm,
        truncations: p.truncations / norm,
        rawRateLimits: p.rateLimits,
        rawOtherErrors: otherErrors,
        rawCompactions: p.compactions,
        rawTruncations: p.truncations,
        total: (p.rateLimits + otherErrors + p.compactions + p.truncations) / norm,
      };
    });

    const maxVal = Math.max(0.5, ...barData.map((b) => b.total));
    const barW = computeBarWidth(CHART_W, barData.length, 4, 18);

    const bars: IncidentBar[] = barData.map((b, i) => {
      const x = CHART_LEFT + ((i + 0.5) / barData.length) * CHART_W;
      const truncH = (b.truncations / maxVal) * CHART_H;
      const compH = (b.compactions / maxVal) * CHART_H;
      const otherH = (b.otherErrors / maxVal) * CHART_H;
      const rlH = (b.rateLimits / maxVal) * CHART_H;
      return {
        x,
        ...b,
        truncRect: { y: CHART_BOTTOM - truncH, h: truncH },
        compRect: { y: CHART_BOTTOM - truncH - compH, h: compH },
        otherRect: { y: CHART_BOTTOM - truncH - compH - otherH, h: otherH },
        rlRect: { y: CHART_BOTTOM - truncH - compH - otherH - rlH, h: rlH },
      };
    });

    // Nice Y-axis ticks
    const yTicks = 5;
    const step = maxVal <= 1 ? 0.2 : Math.ceil(maxVal / (yTicks - 1));
    const yLabels = Array.from({ length: yTicks }, (_, i) => {
      const value = maxVal <= 1 ? +(i * step).toFixed(1) : Math.round(i * step);
      return { value: String(value), y: CHART_BOTTOM - (i * CHART_H) / (yTicks - 1) };
    });

    const xLabels = generateXLabels(
      barData,
      (_, i) => CHART_LEFT + ((i + 0.5) / barData.length) * CHART_W,
      (b) => formatDateShort(b.date),
    );

    return { bars, yLabels, xLabels, barW, maxVal };
  });

  const gridLines = computed(() => chartData.value?.yLabels.map((yl) => yl.y) ?? []);

  /**
   * Format tooltip content for an incident bar.
   * Respects the current normalization mode.
   */
  function formatTooltip(bar: IncidentBar): string {
    const d = formatDateMedium(bar.date);
    if (normalize.value) {
      const parts: string[] = [];
      if (bar.rateLimits > 0) parts.push(`${bar.rateLimits.toFixed(1)} rate limits/session`);
      if (bar.otherErrors > 0) parts.push(`${bar.otherErrors.toFixed(1)} errors/session`);
      if (bar.compactions > 0) parts.push(`${bar.compactions.toFixed(1)} compactions/session`);
      if (bar.truncations > 0) parts.push(`${bar.truncations.toFixed(1)} truncations/session`);
      return parts.length > 0 ? `${d} — ${parts.join(", ")}` : `${d} — no incidents`;
    }
    const parts: string[] = [];
    if (bar.rawRateLimits > 0)
      parts.push(`${bar.rawRateLimits} rate limit${bar.rawRateLimits !== 1 ? "s" : ""}`);
    if (bar.rawOtherErrors > 0)
      parts.push(`${bar.rawOtherErrors} error${bar.rawOtherErrors !== 1 ? "s" : ""}`);
    if (bar.rawCompactions > 0)
      parts.push(`${bar.rawCompactions} compaction${bar.rawCompactions !== 1 ? "s" : ""}`);
    if (bar.rawTruncations > 0)
      parts.push(`${bar.rawTruncations} truncation${bar.rawTruncations !== 1 ? "s" : ""}`);
    return parts.length > 0 ? `${d} — ${parts.join(", ")}` : `${d} — no incidents`;
  }

  return { chartData, gridLines, formatTooltip };
}
