/**
 * Pure helpers for the Analytics dashboard: the day span a range covers, the
 * per-day series its Activity chart stacks, binning to the measured width,
 * axis ticks, error pins and the model-time strip.
 *
 * Daily series from `get_analytics` skip days with no rows, so everything
 * here works on a zero-filled list of UTC days: a quiet day stays on the axis
 * as a flat baseline instead of vanishing.
 */
import {
  AI_CREDIT_USD,
  type AnalyticsData,
  type ApiDurationStats,
  formatDuration,
  resolveSessionSource,
  SESSION_SOURCES,
  type SessionSource,
} from "@tracepilot/types";
import { repositoryFilterLabel } from "@/stores/sessions/filtering";
import type { AnalyticsTimeRange } from "@/utils/analyticsFilters";

const DAY_MS = 86_400_000;
/** Ten years of days, a guard against corrupt dates rather than a real limit. */
const MAX_DAYS = 3_660;

export type ActivityMetric = "cost" | "tokens" | "runs";

/** One stacked series: a source, or every source together. */
export interface DaySeries {
  key: string;
  label: string;
  /** A CSS colour, e.g. `var(--claude-fg)`. */
  color: string;
}

/** One day (or one bin of days) of the chart. `values` follows the series order. */
export interface DayRow {
  from: string;
  to: string;
  values: number[];
  runs: number;
  errors: number;
  rateLimits: number;
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Every UTC day from `from` to `to`, inclusive. Empty when the span is inverted. */
export function daysBetween(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return [];
  const days: string[] = [];
  for (let t = start; t <= end && days.length < MAX_DAYS; t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * The days a day chart draws: the selected range, or for All time the first
 * dated point to the last (or today, if later). A range with no data still
 * draws its own days.
 */
export function rangeDays(
  dates: readonly string[],
  range: { fromDate?: string; toDate?: string },
  now: Date = new Date(),
): string[] {
  if (!range.fromDate && dates.length === 0) return [];
  const sorted = [...dates].sort();
  const from = range.fromDate ?? sorted[0];
  const last = sorted.at(-1);
  const today = todayUtc(now);
  const to = range.toDate ?? (last && last > today ? last : today);
  return daysBetween(from, to);
}

/** The days the dashboard draws, from every daily series it has. */
export function dashboardDays(
  data: AnalyticsData,
  range: { fromDate?: string; toDate?: string },
  now: Date = new Date(),
): string[] {
  const dated = [
    ...data.activityPerDay,
    ...data.tokenUsageByDay,
    ...(data.incidentsByDay ?? []),
  ].map((point) => point.date);
  return rangeDays(dated, range, now);
}

/** The range in words, for empty states: `No sessions ended in the past 7 days`. */
export function rangeText(range: AnalyticsTimeRange): string {
  if (range === "7d") return "the past 7 days";
  if (range === "30d") return "the past 30 days";
  if (range === "90d") return "the past 90 days";
  if (range === "month-to-date") return "this month";
  if (range === "custom") return "the selected period";
  return "any session";
}

/** The words an analytics subtitle scopes its noun with. */
export interface AnalyticsScopeWords {
  /** `"all "` only when no range, repository or source narrows the scope. */
  all: string;
  /** The repository, then the range: `" in harbor in the past 30 days"`, `" this month"`, or `""`. */
  suffix: string;
}

/**
 * Scope words for the active filters, so "across all tool invocations" is
 * never said of one month or one repository. "This Month" is month-to-date.
 */
export function analyticsScopeWords(filters: {
  selectedTimeRange: AnalyticsTimeRange;
  selectedRepo: string | null;
  selectedSource: SessionSource | null;
}): AnalyticsScopeWords {
  const range = filters.selectedTimeRange;
  const repo = filters.selectedRepo;
  const repoSuffix = repo ? ` in ${repositoryFilterLabel(repo)}` : "";
  const rangeSuffix =
    range === "all"
      ? ""
      : range === "month-to-date"
        ? ` ${rangeText(range)}`
        : ` in ${rangeText(range)}`;
  const narrowed = Boolean(repo || filters.selectedSource) || range !== "all";
  return { all: narrowed ? "" : "all ", suffix: `${repoSuffix}${rangeSuffix}` };
}

/**
 * Sources with sessions in the payload, in display order. Payloads from
 * before sources were recorded are Copilot's.
 */
export function payloadSources(data: AnalyticsData): SessionSource[] {
  if (!data.costBySource) return data.totalSessions > 0 ? ["copilot"] : [];
  return data.costBySource.filter((entry) => entry.sessions > 0).map((entry) => entry.source);
}

/**
 * Sources the per-day series have data for, in display order. The day series
 * count runs by the day each ended, so a source whose sessions were resumed
 * after the range has rows there but no `costBySource` entry; it is added
 * here so its tokens and cost still draw. USD per day is Claude Code's.
 */
export function daySources(data: AnalyticsData): SessionSource[] {
  const found = new Set(payloadSources(data));
  for (const row of data.modelUsageByDay ?? []) found.add(resolveSessionSource(row.source));
  if (data.costUsdByDay?.length) found.add("claudeCode");
  return SESSION_SOURCES.filter((source) => found.has(source));
}

/**
 * Whether any per-day series has data. They can when no session was last
 * active in the range (so `totalSessions` and the per-source totals are 0):
 * a session resumed after the range still has runs that ended in it.
 */
export function hasDailyUsage(data: AnalyticsData): boolean {
  return (
    data.activityPerDay.some((point) => point.count > 0) ||
    data.tokenUsageByDay.some((point) => point.tokens > 0) ||
    (data.modelUsageByDay?.length ?? 0) > 0 ||
    (data.costUsdByDay?.length ?? 0) > 0
  );
}

export const SOURCE_COLORS: Record<SessionSource, string> = {
  copilot: "var(--accent-fg)",
  claudeCode: "var(--claude-fg)",
};

export interface ActivityInput {
  data: AnalyticsData;
  days: string[];
  metric: ActivityMetric;
  /** AI Credits per day for sources billed in them (already priced). */
  aiCreditsByDay: ReadonlyMap<string, number>;
  /** Source label, e.g. `sourceLabel`. */
  label: (source: SessionSource) => string;
}

/**
 * Daily rows for the Activity chart. Tokens and cost stack by source; runs
 * have no source split in one payload, so they draw as one series.
 */
export function activityRows(input: ActivityInput): { series: DaySeries[]; rows: DayRow[] } {
  const { data, days, metric } = input;
  const sources = daySources(data);
  const index = new Map(days.map((day, i) => [day, i]));
  const blank = () => days.map(() => 0);
  let series: DaySeries[];
  let values: number[][];

  if (metric === "runs") {
    const single = sources.length === 1 ? sources[0] : null;
    series = [
      {
        key: "runs",
        label: single ? `${input.label(single)} runs` : "Runs",
        color: single ? SOURCE_COLORS[single] : "var(--chart-secondary)",
      },
    ];
    const runs = blank();
    for (const point of data.activityPerDay) {
      const i = index.get(point.date);
      if (i != null) runs[i] = point.count;
    }
    values = [runs];
  } else {
    const shown: SessionSource[] = sources.length ? sources : ["copilot"];
    series = shown.map((source) => ({
      key: source,
      label: input.label(source),
      color: SOURCE_COLORS[source],
    }));
    values = shown.map(() => blank());
    const at = (source: SessionSource | undefined) => {
      const i = shown.indexOf(source ?? "copilot");
      return i >= 0 ? values[i] : null;
    };
    if (metric === "tokens") {
      if (data.modelUsageByDay?.length) {
        for (const row of data.modelUsageByDay) {
          const i = index.get(row.date);
          const target = at(row.source);
          if (i != null && target) target[i] += row.inputTokens + row.outputTokens;
        }
      } else {
        // Older payloads have no per-model rows: the total, unsplit.
        for (const point of data.tokenUsageByDay) {
          const i = index.get(point.date);
          if (i != null) values[0][i] += point.tokens;
        }
      }
    } else {
      // Every source in USD: AI Credits at $0.01 each.
      const copilot = at("copilot");
      for (const [date, aic] of input.aiCreditsByDay) {
        const i = index.get(date);
        if (i != null && copilot) copilot[i] += aic * AI_CREDIT_USD;
      }
      const claude = at("claudeCode");
      for (const point of data.costUsdByDay ?? []) {
        const i = index.get(point.date);
        if (i != null && claude) claude[i] += point.cost;
      }
    }
  }

  const runs = blank();
  for (const point of data.activityPerDay) {
    const i = index.get(point.date);
    if (i != null) runs[i] = point.count;
  }
  const errors = blank();
  const rateLimits = blank();
  for (const point of data.incidentsByDay ?? []) {
    const i = index.get(point.date);
    if (i == null) continue;
    errors[i] = Math.max(0, point.errors - point.rateLimits);
    rateLimits[i] = point.rateLimits;
  }

  const rows = days.map((day, i) => ({
    from: day,
    to: day,
    values: values.map((column) => column[i]),
    runs: runs[i],
    errors: errors[i],
    rateLimits: rateLimits[i],
  }));
  return { series, rows };
}

/**
 * Merge consecutive days so no more than `maxBins` columns are drawn. Daily
 * values add up; running totals (`cumulative`) keep each bin's last value.
 */
export function binRows(rows: readonly DayRow[], maxBins: number, cumulative = false): DayRow[] {
  const limit = Math.max(1, Math.floor(maxBins));
  if (rows.length <= limit) return [...rows];
  const size = Math.ceil(rows.length / limit);
  const bins: DayRow[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    bins.push({
      from: chunk[0].from,
      to: chunk[chunk.length - 1].to,
      values: cumulative
        ? [...chunk[chunk.length - 1].values]
        : chunk[0].values.map((_, j) => chunk.reduce((sum, row) => sum + row.values[j], 0)),
      runs: chunk.reduce((sum, row) => sum + row.runs, 0),
      errors: chunk.reduce((sum, row) => sum + row.errors, 0),
      rateLimits: chunk.reduce((sum, row) => sum + row.rateLimits, 0),
    });
  }
  return bins;
}

/** Days one drawn column covers: 1 until the chart merges days into bins. */
export function columnDays(columns: readonly DayRow[]): number {
  const first = columns[0];
  return first ? Math.round((Date.parse(first.to) - Date.parse(first.from)) / DAY_MS) + 1 : 1;
}

/** A chart title's unit: `Calls per day`, or `Calls per 2 days` once days merge. */
export function perColumnTitle(noun: string, columns: readonly DayRow[]): string {
  const days = columnDays(columns);
  return days > 1 ? `${noun} per ${days} days` : `${noun} per day`;
}

/**
 * The tallest drawn column and its label (`Mar 24`, or `Mar 15 – Mar 16` for
 * a merged one), so a footer's "busiest" matches the bars. `null` when there
 * is nothing above zero.
 */
export function busiestColumn(
  columns: readonly DayRow[],
  total: (row: DayRow) => number = (row) => row.values.reduce((a, b) => a + b, 0),
): { row: DayRow; total: number; label: string } | null {
  let best: { row: DayRow; total: number } | null = null;
  for (const row of columns) {
    const value = total(row);
    if (value > 0 && (!best || value > best.total)) best = { row, total: value };
  }
  if (!best) return null;
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const { from, to } = best.row;
  return { ...best, label: from === to ? day(from) : `${day(from)} – ${day(to)}` };
}

/** Running totals of each series, for the cumulative cost view. */
export function cumulativeRows(rows: readonly DayRow[]): DayRow[] {
  const totals = rows[0]?.values.map(() => 0) ?? [];
  return rows.map((row) => {
    row.values.forEach((value, j) => {
      totals[j] += value;
    });
    return { ...row, values: [...totals] };
  });
}

/** Column indices to label, spaced so labels `spacingPx` wide never touch. */
export function tickIndices(count: number, widthPx: number, spacingPx = 84): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const maxTicks = Math.max(2, Math.floor(widthPx / spacingPx));
  const stride = Math.max(1, Math.ceil(count / maxTicks));
  const ticks: number[] = [];
  for (let i = 0; i < count; i += stride) ticks.push(i);
  return ticks;
}

export interface ErrorPin {
  /** Centre of the pin in percent of the plot width. */
  pct: number;
  errors: number;
  rateLimits: number;
  /** Indices of the columns merged into this pin. */
  columns: number[];
}

/**
 * Errors and rate limits pinned over their column. Pins closer than `gapPct`
 * merge, so a run of bad days reads as one pin with a count.
 */
export function errorPins(rows: readonly DayRow[], gapPct: number): ErrorPin[] {
  const pins: (ErrorPin & { last: number })[] = [];
  rows.forEach((row, i) => {
    if (row.errors + row.rateLimits === 0) return;
    const pct = ((i + 0.5) / rows.length) * 100;
    const previous = pins.at(-1);
    if (previous && pct - previous.last < gapPct) {
      previous.errors += row.errors;
      previous.rateLimits += row.rateLimits;
      previous.columns.push(i);
      previous.last = pct;
      previous.pct = (((previous.columns[0] + i) / 2 + 0.5) / rows.length) * 100;
      return;
    }
    pins.push({ pct, last: pct, errors: row.errors, rateLimits: row.rateLimits, columns: [i] });
  });
  return pins.map(({ last: _last, ...pin }) => pin);
}

export type StripKey = "min" | "median" | "avg" | "p95" | "max";

export interface StripMark {
  /** Statistics at this point; equal values share one mark and label. */
  keys: StripKey[];
  /** Their names, joined: "median · mean". */
  label: string;
  /** The shared value, formatted. */
  text: string;
  ms: number;
  /** Position on a log axis, in percent. */
  pct: number;
  /** Label anchor: centred on the tick unless that would leave the strip. */
  align: "start" | "center" | "end";
  /** Label row: the first row where it overlaps no label already placed. */
  row: number;
}

/** Below this, model time is noise; it only keeps the log axis finite. */
const STRIP_FLOOR_MS = 10;
/** Advance of the strip's 10px monospace label font, and the space kept between labels. */
const STRIP_CHAR_PX = 6;
const STRIP_LABEL_GAP_PX = 8;

/**
 * The five recorded statistics on one log axis. Statistics with the same
 * value merge into one mark (one timed session gives a single centred mark),
 * and each label takes the first row where it overlaps nothing.
 */
export function durationStrip(stats: ApiDurationStats, widthPx = 800): StripMark[] {
  const log = (ms: number) => Math.log10(Math.max(STRIP_FLOOR_MS, ms));
  const lo = log(stats.minMs);
  const span = log(stats.maxMs) - lo;
  const pct = (ms: number) =>
    span > 0 ? Math.min(100, Math.max(0, ((log(ms) - lo) / span) * 100)) : 50;
  const ordered = (
    [
      ["min", "min", stats.minMs],
      ["median", "median", stats.medianMs],
      ["avg", "mean", stats.avgMs],
      ["p95", "p95", stats.p95Ms],
      ["max", "max", stats.maxMs],
    ] as const
  )
    .map(([key, name, ms]) => ({ key, name, ms, pct: pct(ms), text: formatDuration(ms) || "0s" }))
    .sort((a, b) => a.pct - b.pct); // by position; ties keep the order above

  const groups: { keys: StripKey[]; names: string[]; ms: number; text: string; pct: number }[] = [];
  for (const { key, name, ms, pct: at, text } of ordered) {
    const previous = groups.at(-1);
    if (previous?.text === text) {
      previous.keys.push(key);
      previous.names.push(name);
    } else {
      groups.push({ keys: [key], names: [name], ms, text, pct: at });
    }
  }

  const rows: [number, number][][] = [];
  return groups.map(({ keys, names, ms, text, pct: at }) => {
    const label = names.join(" · ");
    const w = (label.length + 1 + text.length) * STRIP_CHAR_PX;
    const x = (at / 100) * widthPx;
    const align: StripMark["align"] =
      x - w / 2 < 0 ? "start" : x + w / 2 > widthPx ? "end" : "center";
    const start = align === "start" ? x : align === "end" ? x - w : x - w / 2;
    const end = start + w;
    const free = (row: [number, number][]) =>
      row.every(([s, e]) => e + STRIP_LABEL_GAP_PX <= start || end + STRIP_LABEL_GAP_PX <= s);
    let row = rows.findIndex(free);
    if (row < 0) row = rows.push([]) - 1;
    rows[row].push([start, end]);
    return { keys, label, text, ms, pct: at, align, row };
  });
}

/** Share as text, so a sliver reads `<0.1%` rather than `0%`. */
export function formatShare(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return "0%";
  if (percent < 0.1) return "<0.1%";
  if (percent < 1) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}
