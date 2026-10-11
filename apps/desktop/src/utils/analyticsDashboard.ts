/**
 * Pure helpers for the Analytics dashboard: the day span a range covers, the
 * per-day series its Activity chart stacks, binning to the measured width,
 * axis ticks, error pins and the model-time strip.
 *
 * Daily series from `get_analytics` skip days with no rows, so everything
 * here works on a zero-filled list of UTC days: a quiet day stays on the axis
 * as a flat baseline instead of vanishing.
 */
import type { AnalyticsData, ApiDurationStats, SessionSource } from "@tracepilot/types";
import { sourceCapabilities } from "@tracepilot/types";

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
 * The days the dashboard draws: the selected range, or for All time the first
 * to the last day with data. A range with no data still draws its own days.
 */
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
  if (!range.fromDate && dated.length === 0) return [];
  const sorted = dated.sort();
  const from = range.fromDate ?? sorted[0];
  const last = sorted.at(-1);
  const today = todayUtc(now);
  const to = range.toDate ?? (last && last > today ? last : today);
  return daysBetween(from, to);
}

/**
 * Sources with sessions in the payload, in display order. Payloads from
 * before sources were recorded are Copilot's.
 */
export function payloadSources(data: AnalyticsData): SessionSource[] {
  if (!data.costBySource) return data.totalSessions > 0 ? ["copilot"] : [];
  return data.costBySource.filter((entry) => entry.sessions > 0).map((entry) => entry.source);
}

export const SOURCE_COLORS: Record<SessionSource, string> = {
  copilot: "var(--accent-fg)",
  claudeCode: "var(--claude-fg)",
};

/** True when every source in range is billed in AI Credits, so cost reads in them. */
export function costInAiCredits(data: AnalyticsData): boolean {
  const sources = payloadSources(data);
  return sources.length > 0 && sources.every((source) => sourceCapabilities(source).hasAic);
}

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
  const sources = payloadSources(data);
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
      const credits = costInAiCredits(data);
      const copilot = at("copilot");
      for (const [date, aic] of input.aiCreditsByDay) {
        const i = index.get(date);
        if (i != null && copilot) copilot[i] += credits ? aic : aic * 0.01;
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

export interface StripMark {
  key: "min" | "median" | "avg" | "p95" | "max";
  label: string;
  ms: number;
  /** Position on a log axis, in percent. */
  pct: number;
  /** Label row, 0 or 1: neighbours too close for one row alternate. */
  row: number;
}

/** The five recorded statistics on one log axis, labels staggered when close. */
export function durationStrip(stats: ApiDurationStats, minGapPct = 11): StripMark[] {
  const floor = 1_000;
  const lo = Math.log10(Math.max(floor, stats.minMs));
  const hi = Math.log10(Math.max(floor, stats.maxMs));
  const span = hi - lo || 1;
  const pct = (ms: number) => ((Math.log10(Math.max(floor, ms)) - lo) / span) * 100;
  const marks: Omit<StripMark, "row">[] = [
    { key: "min", label: "min", ms: stats.minMs, pct: pct(stats.minMs) },
    { key: "median", label: "median", ms: stats.medianMs, pct: pct(stats.medianMs) },
    { key: "avg", label: "mean", ms: stats.avgMs, pct: pct(stats.avgMs) },
    { key: "p95", label: "p95", ms: stats.p95Ms, pct: pct(stats.p95Ms) },
    { key: "max", label: "max", ms: stats.maxMs, pct: pct(stats.maxMs) },
  ];
  let lastOnTop = Number.NEGATIVE_INFINITY;
  return marks.map((mark) => {
    const row = mark.pct - lastOnTop < minGapPct ? 1 : 0;
    if (row === 0) lastOnTop = mark.pct;
    return { ...mark, row };
  });
}

/** Share as text, so a sliver reads `<0.1%` rather than `0%`. */
export function formatShare(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return "0%";
  if (percent < 0.1) return "<0.1%";
  if (percent < 1) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}
