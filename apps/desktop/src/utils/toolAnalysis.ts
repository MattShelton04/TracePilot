/**
 * Pure helpers for the Tools page: which calls are waits rather than work,
 * the split of tool time, per-day rows for `AnalyticsDayChart`, ranking, and
 * the heatmap's edges and shading.
 *
 * A subagent's tool call lasts as long as the whole subagent, and `ask_user`
 * as long as the person takes to answer, so on real data they hold most of
 * the tool time. Averages and time shares keep them apart from ordinary
 * tools instead of letting them swamp the headline.
 */
import type { ToolAnalysisData, ToolUsageEntry } from "@tracepilot/types";
import { formatDuration, formatNumberFull } from "@tracepilot/types";
import type { DayRow, DaySeries } from "@/utils/analyticsDashboard";

export type ToolKind = "tool" | "agent" | "wait";
export type ToolDayMetric = "calls" | "failures" | "time";
export type ToolSort = "calls" | "failures" | "slowest" | "time";

/** Canonical tools whose duration is a subagent's run, not the tool's own work. */
const AGENT_TOOLS = new Set([
  "task",
  "read_agent",
  "explore",
  "general-purpose",
  "code-review",
  "rubber-duck",
]);
/** Claude Code's subagent launchers, whatever agent type they ran. */
const AGENT_NATIVE_TOOLS = new Set(["Agent", "Task"]);
const WAIT_TOOLS = new Set(["ask_user"]);

/** A failure rate worth flagging, once a tool has enough calls to judge. */
export const FAILING_TOOL_RATE = 0.05;
export const MIN_JUDGED_CALLS = 10;

export const TOOL_KINDS: Record<ToolKind, { label: string; color: string }> = {
  tool: { label: "Tools", color: "var(--chart-primary)" },
  agent: { label: "Subagents", color: "var(--done-fg)" },
  wait: { label: "Waiting on you", color: "var(--text-tertiary)" },
};

type ToolLike = Pick<ToolUsageEntry, "name" | "nativeTools">;

export function toolKind(tool: ToolLike): ToolKind {
  if (WAIT_TOOLS.has(tool.name)) return "wait";
  if (
    AGENT_TOOLS.has(tool.name) ||
    tool.nativeTools?.some((native) => AGENT_NATIVE_TOOLS.has(native.name))
  ) {
    return "agent";
  }
  return "tool";
}

/** Failed calls. Payloads before `failureCount` estimate it from the rate. */
export function toolFailures(tool: ToolUsageEntry): number {
  return tool.failureCount ?? Math.round(tool.callCount * (1 - tool.successRate));
}

export function failureRate(tool: ToolUsageEntry): number {
  return tool.callCount > 0 ? toolFailures(tool) / tool.callCount : 0;
}

/** Fails often enough, over enough calls, to call out. */
export function isFailing(tool: ToolUsageEntry): boolean {
  return tool.callCount >= MIN_JUDGED_CALLS && failureRate(tool) >= FAILING_TOOL_RATE;
}

export interface ToolTimeSplit {
  /** Summed duration per kind, in milliseconds. */
  ms: Record<ToolKind, number>;
  calls: Record<ToolKind, number>;
  totalMs: number;
}

export function toolTimeSplit(tools: readonly ToolUsageEntry[]): ToolTimeSplit {
  const ms: Record<ToolKind, number> = { tool: 0, agent: 0, wait: 0 };
  const calls: Record<ToolKind, number> = { tool: 0, agent: 0, wait: 0 };
  for (const tool of tools) {
    const kind = toolKind(tool);
    ms[kind] += tool.totalDurationMs;
    calls[kind] += tool.callCount;
  }
  return { ms, calls, totalMs: ms.tool + ms.agent + ms.wait };
}

/**
 * Tools ranked for the list. Failure rate ranks tools with enough calls to
 * judge first; the rest follow by failed calls, so one failed call out of one
 * does not top the list.
 */
export function rankTools(tools: readonly ToolUsageEntry[], sort: ToolSort): ToolUsageEntry[] {
  const byCalls = (a: ToolUsageEntry, b: ToolUsageEntry) =>
    b.callCount - a.callCount || a.name.localeCompare(b.name);
  const ranked = [...tools];
  if (sort === "calls") return ranked.sort(byCalls);
  if (sort === "slowest") {
    return ranked.sort((a, b) => b.avgDurationMs - a.avgDurationMs || byCalls(a, b));
  }
  if (sort === "time") {
    return ranked.sort((a, b) => b.totalDurationMs - a.totalDurationMs || byCalls(a, b));
  }
  const judged = (tool: ToolUsageEntry) => tool.callCount >= MIN_JUDGED_CALLS;
  return ranked.sort(
    (a, b) =>
      Number(judged(b)) - Number(judged(a)) ||
      (judged(a) ? failureRate(b) - failureRate(a) : 0) ||
      toolFailures(b) - toolFailures(a) ||
      byCalls(a, b),
  );
}

/** One day chart row per day; `values` follows the series of the metric. */
export function toolDayRows(
  data: ToolAnalysisData,
  days: readonly string[],
  metric: ToolDayMetric,
): { series: DaySeries[]; rows: DayRow[] } {
  const byDate = new Map((data.callsByDay ?? []).map((day) => [day.date, day]));
  const series: DaySeries[] =
    metric === "calls"
      ? [
          { key: "calls", label: "Calls", color: "var(--chart-primary)" },
          { key: "failed", label: "Failed", color: "var(--danger-fg)" },
        ]
      : metric === "failures"
        ? [{ key: "failed", label: "Failed", color: "var(--danger-fg)" }]
        : [{ key: "time", label: "Tool time", color: "var(--chart-primary)" }];
  const rows = days.map((date) => {
    const day = byDate.get(date);
    const calls = day?.calls ?? 0;
    const failures = Math.min(calls, day?.failures ?? 0);
    const values =
      metric === "calls"
        ? [calls - failures, failures]
        : metric === "failures"
          ? [failures]
          : [day?.durationMs ?? 0];
    // Runs carry the day's calls, so a readout can name them on any metric.
    return { from: date, to: date, values, runs: calls, errors: failures, rateLimits: 0 };
  });
  return { series, rows };
}

export interface HeatmapSummary {
  /** `grid[day][hour]`, Monday first, in local time. */
  grid: number[][];
  dayTotals: number[];
  hourTotals: number[];
  total: number;
  max: number;
  peak: { day: number; hour: number; count: number } | null;
  /** Share of calls Monday to Friday, 0–1. */
  weekdayShare: number;
  /** The busiest hour of the day across the week. */
  peakHour: number | null;
}

export function summarizeHeatmap(grid: number[][]): HeatmapSummary {
  const dayTotals = grid.map((row) => row.reduce((sum, value) => sum + value, 0));
  const hourTotals = Array.from({ length: 24 }, (_, hour) =>
    grid.reduce((sum, row) => sum + (row[hour] ?? 0), 0),
  );
  const total = dayTotals.reduce((sum, value) => sum + value, 0);
  let peak: HeatmapSummary["peak"] = null;
  grid.forEach((row, day) => {
    row.forEach((count, hour) => {
      if (count > 0 && (!peak || count > peak.count)) peak = { day, hour, count };
    });
  });
  const maxHour = Math.max(...hourTotals);
  return {
    grid,
    dayTotals,
    hourTotals,
    total,
    max: Math.max(0, ...grid.flat()),
    peak,
    weekdayShare: total ? dayTotals.slice(0, 5).reduce((sum, value) => sum + value, 0) / total : 0,
    peakHour: total ? hourTotals.indexOf(maxHour) : null,
  };
}

export const HEAT_LEVELS = 5;

/** 0 for an empty cell, else 1–5 by share of the busiest cell. */
export function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(HEAT_LEVELS, Math.ceil((value / max) * HEAT_LEVELS)));
}

/** One call's time, to a whole millisecond or a tenth of a second: `132ms`, `6.6s`, `2m 5s`. */
export function formatCallTime(ms: number): string {
  if (ms <= 0) return "0ms";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return formatDuration(ms);
}

/** Summed tool time, short for columns and axes: `45s`, `48m`, `1.5h`, `908h`. */
export function formatToolTime(ms: number): string {
  if (ms < 1_000) return formatCallTime(ms);
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const hours = ms / 3_600_000;
  return hours < 10 ? `${hours.toFixed(1)}h` : `${formatNumberFull(Math.round(hours))}h`;
}
