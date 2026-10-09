/**
 * Pure derivations behind the Models page charts: per-model profile
 * measures, rank normalisation, scales, label placement, and the series for
 * the share-shift and model-mix charts.
 *
 * Costs here are API-equivalent USD (`ModelRow.usdEquivalent`) so models
 * from every source share one axis; charts mark rows priced in USD rather
 * than AI Credits so the unit change stays visible.
 */

import { formatAiCredits, resolveSessionSource, type SessionSource } from "@tracepilot/types";
import type { ModelRow } from "./types";
import type { ModelTooltipContent } from "./useModelChartTooltip";

// ── Scales ──────────────────────────────────────────────────

export type Scale = (value: number) => number;

/** Linear map from `domain` to `range`. */
export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/**
 * Base-10 log map from `domain` to `range`. The domain may run either way
 * (high-to-low flips the axis). Values at or below zero clamp to a tenth of
 * the domain's lower bound so they sit just outside it rather than at -∞.
 */
export function logScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  const floor = Math.min(d0, d1) / 10;
  const span = l1 - l0 || 1;
  return (value) => r0 + ((Math.log10(Math.max(value, floor)) - l0) / span) * (r1 - r0);
}

/** Powers of ten spanning `values`, at least `minDecades` apart. */
export function decadeDomain(values: readonly number[], minDecades = 2): [number, number] {
  const positive = values.filter((v) => v > 0);
  if (positive.length === 0) return [1, 10 ** minDecades];
  let lo = Math.floor(Math.log10(Math.min(...positive)));
  let hi = Math.ceil(Math.log10(Math.max(...positive)));
  while (hi - lo < minDecades) {
    hi += 1;
    if (hi - lo < minDecades) lo -= 1;
  }
  return [10 ** lo, 10 ** hi];
}

const NICE_LOG_STEPS = [1, 2, 5];

/**
 * A log domain that hugs the data: bounds snap outward to 1, 2 or 5 times a
 * power of ten instead of whole decades, so a series spanning 0.1–1.9 does
 * not waste two empty decades.
 */
export function niceLogDomain(values: readonly number[]): [number, number] {
  const positive = values.filter((v) => v > 0);
  if (positive.length === 0) return [1, 10];
  const min = Math.min(...positive);
  const max = Math.max(...positive);
  const down = (v: number) => {
    const p = 10 ** Math.floor(Math.log10(v));
    return (
      [...NICE_LOG_STEPS]
        .reverse()
        .map((k) => k * p)
        .find((s) => s <= v * (1 + 1e-9)) ?? p
    );
  };
  const up = (v: number) => {
    const p = 10 ** Math.floor(Math.log10(v));
    return [...NICE_LOG_STEPS, 10].map((k) => k * p).find((s) => s >= v * (1 - 1e-9)) ?? 10 * p;
  };
  const lo = down(min);
  const hi = up(max);
  return hi > lo ? [lo, hi] : [lo, up(lo * 1.0001)];
}

/** Ticks for a log axis: 1-2-5 steps when they fit, else whole powers of ten. */
export function logTicks(domain: [number, number], maxTicks = 6): number[] {
  const lo = Math.min(...domain);
  const hi = Math.max(...domain);
  const within = (v: number) => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9);
  const build = (steps: number[]) => {
    const out: number[] = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      for (const k of steps) {
        const v = Number((k * 10 ** e).toPrecision(6));
        if (within(v)) out.push(v);
      }
    }
    return out;
  };
  for (const steps of [NICE_LOG_STEPS, [1, 3], [1]]) {
    const ticks = build(steps);
    if (ticks.length <= maxTicks) return ticks;
  }
  const powers = build([1]);
  const stride = Math.ceil(powers.length / maxTicks);
  return powers.filter((_, i) => i % stride === 0);
}

/** Point on a radar axis: axis 0 points straight up, the rest go clockwise. */
export function radarPoint(
  axis: number,
  axisCount: number,
  center: { x: number; y: number },
  radius: number,
): { x: number; y: number } {
  const angle = (Math.PI * 2 * axis) / axisCount - Math.PI / 2;
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}

/** Radar radius (0–1) for a rank; unranked axes sit at the centre. */
export const rankRadius = (rank: AxisRank | null) => (rank ? 0.14 + 0.86 * rank.position : 0);

/** A "nice" upper bound and tick step for a linear axis starting at zero. */
export function niceLinearTicks(max: number, targetTicks = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const raw = max / targetTicks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * power).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Number(v.toFixed(10)));
  return { max: top, ticks };
}

/** Compact tick label for a power-of-ten token count: `10k`, `1M`, `1B`. */
export function formatTokenTick(value: number): string {
  if (value >= 1e9) return `${+(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${+(value / 1e3).toFixed(1)}k`;
  return `${value}`;
}

/** Compact token count: `4.16B`, `824.8M`, `31.1k`. */
export function formatTokens(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e8) return `${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e5 ? 0 : 1)}k`;
  return `${Math.round(value)}`;
}

/** A 0–1 fraction as a percentage. */
export function formatShare(value: number | null, digits = 1): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

/** USD with precision that suits the magnitude: `$1,093`, `$47.4`, `$0.37`. */
export function formatUsd(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1000) return `$${Math.round(value).toLocaleString("en-US")}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  return value > 0 ? "<$0.01" : "$0";
}

/** USD per million tokens: `$0.96`, `$0.105`. */
export function formatRate(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toFixed(value >= 0.1 ? 2 : 3)}`;
}

// ── Profiles ────────────────────────────────────────────────

/** The measures that separate one model's usage from another's. */
export interface ModelProfile {
  row: ModelRow;
  /** API-equivalent USD per million tokens; null when the model is unpriced. */
  rate: number | null;
  /** Share of input served from cache, 0–1. */
  cacheHit: number | null;
  /** Average tokens per request: how much context each call carried. */
  contextPerRequest: number | null;
  /** Output tokens as a share of all tokens, 0–1. */
  outputShare: number | null;
}

export function modelProfile(row: ModelRow): ModelProfile {
  const priced = row.usdEquivalent != null && row.usdEquivalent > 0 && row.tokens > 0;
  return {
    row,
    rate: priced ? ((row.usdEquivalent as number) / row.tokens) * 1e6 : null,
    cacheHit: row.inputTokens > 0 ? row.cacheReadTokens / row.inputTokens : null,
    contextPerRequest: row.requestCount > 0 ? row.tokens / row.requestCount : null,
    outputShare: row.tokens > 0 ? row.outputTokens / row.tokens : null,
  };
}

/** A row's cost in its own unit, with the USD equivalent for AI Credits. */
export function formatRowSpend(row: ModelRow): string {
  if (row.billedInAiCredits) {
    return row.aiCredits == null
      ? "Unpriced"
      : `${formatAiCredits(row.aiCredits)} ≈ ${formatUsd(row.usdEquivalent)}`;
  }
  return row.costUsd == null ? "Unpriced" : `${formatUsd(row.costUsd)} est.`;
}

/** The tooltip every model chart shows for one model. */
export function profileTooltip(profile: ModelProfile): ModelTooltipContent {
  const { row } = profile;
  return {
    title: row.label,
    color: row.color,
    hollow: !row.billedInAiCredits,
    rows: [
      { label: "Tokens", value: `${formatTokens(row.tokens)} · ${row.percentage.toFixed(1)}%` },
      { label: "Cost", value: formatRowSpend(row) },
      { label: "Per 1M tokens", value: formatRate(profile.rate) },
      { label: "Cache hit", value: formatShare(profile.cacheHit) },
      {
        label: "Context / request",
        value: profile.contextPerRequest == null ? "—" : formatTokens(profile.contextPerRequest),
      },
      { label: "Output share", value: formatShare(profile.outputShare, 2) },
      {
        label: "Requests",
        value: row.requestCount ? row.requestCount.toLocaleString("en-US") : "—",
      },
    ],
  };
}

export interface ProfileAxis {
  key: "volume" | "rate" | "cacheHit" | "context" | "output";
  label: string;
  /** What the axis measures, for tooltips. */
  description: string;
  value: (profile: ModelProfile) => number | null;
  format: (value: number) => string;
  /** True when a lower raw value should sit further out (cheaper = better). */
  invert?: boolean;
}

export const PROFILE_AXES: readonly ProfileAxis[] = [
  {
    key: "volume",
    label: "Volume",
    description: "Tokens",
    value: (p) => p.row.tokens || null,
    format: formatTokens,
  },
  {
    key: "rate",
    label: "Low $/token",
    description: "Per 1M tokens",
    value: (p) => p.rate,
    format: formatRate,
    invert: true,
  },
  {
    key: "cacheHit",
    label: "Cache hit",
    description: "Cache hit",
    value: (p) => p.cacheHit,
    format: (v) => formatShare(v),
  },
  {
    key: "context",
    label: "Context",
    description: "Context / request",
    value: (p) => p.contextPerRequest,
    format: formatTokens,
  },
  {
    key: "output",
    label: "Output",
    description: "Output share",
    value: (p) => p.outputShare,
    format: (v) => formatShare(v, 2),
  },
];

/** A model's standing on one axis among the ranked population. */
export interface AxisRank {
  /** 0 = lowest standing, 1 = highest (already inverted where the axis asks). */
  position: number;
  /** 1-based place, where 1 is the outermost. */
  place: number;
  of: number;
}

/**
 * Models with at least this share of tokens are ranked. Tiny models with a
 * handful of requests would otherwise take the extreme ranks on every axis.
 */
export const PROFILE_MIN_SHARE = 0.1;

/** The models a profile chart ranks: those with a meaningful share of use. */
export function profilePopulation(rows: readonly ModelRow[]): ModelRow[] {
  const sorted = [...rows].sort((a, b) => b.tokens - a.tokens);
  const meaningful = sorted.filter((row) => row.percentage >= PROFILE_MIN_SHARE);
  return meaningful.length >= 3 ? meaningful : sorted;
}

/**
 * Rank every profile on every axis. A model with no value on an axis (an
 * unpriced model on the cost axis) gets `null` there instead of a rank.
 */
export function rankProfiles(
  profiles: readonly ModelProfile[],
  axes: readonly ProfileAxis[] = PROFILE_AXES,
): Map<string, (AxisRank | null)[]> {
  const ranks = new Map<string, (AxisRank | null)[]>(
    profiles.map((p) => [p.row.id, axes.map(() => null)]),
  );
  axes.forEach((axis, axisIndex) => {
    const ranked = profiles
      .filter((p) => (axis.value(p) ?? 0) > 0)
      .sort((a, b) => (axis.value(a) as number) - (axis.value(b) as number));
    const n = ranked.length;
    ranked.forEach((p, i) => {
      const ascending = n > 1 ? i / (n - 1) : 1;
      const position = axis.invert ? 1 - ascending : ascending;
      const place = axis.invert ? i + 1 : n - i;
      const entry = ranks.get(p.row.id);
      if (entry) entry[axisIndex] = { position, place, of: n };
    });
  });
  return ranks;
}

// ── Label placement ─────────────────────────────────────────

export interface LabelCandidate {
  x: number;
  y: number;
  /** Radius of the mark the label belongs to. */
  r: number;
  text: string;
}

export interface PlacedLabel {
  index: number;
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Greedy label placement: each label, in the order given, takes the first
 * position around its mark that clears every mark, earlier label and the
 * bounds. Labels that fit nowhere are left out (the tooltip still has them).
 */
export function placeLabels(
  marks: readonly LabelCandidate[],
  bounds: Box,
  options: { charWidth?: number; height?: number; order?: number[]; obstacles?: Box[] } = {},
): PlacedLabel[] {
  const charWidth = options.charWidth ?? 6;
  const height = options.height ?? 13;
  const order = options.order ?? marks.map((_, i) => i);
  const taken: Box[] = [...(options.obstacles ?? [])];
  const placed: PlacedLabel[] = [];
  const hitsMark = (box: Box) =>
    marks.some((m) => {
      const nx = Math.max(box.x, Math.min(m.x, box.x + box.w));
      const ny = Math.max(box.y, Math.min(m.y, box.y + box.h));
      return (nx - m.x) ** 2 + (ny - m.y) ** 2 < (m.r + 1.5) ** 2;
    });
  const inside = (box: Box) =>
    box.x >= bounds.x &&
    box.y >= bounds.y &&
    box.x + box.w <= bounds.x + bounds.w &&
    box.y + box.h <= bounds.y + bounds.h;

  for (const index of order) {
    const m = marks[index];
    const w = m.text.length * charWidth + 4;
    const gap = m.r + 4;
    const candidates: [number, number, PlacedLabel["anchor"]][] = [
      [m.x + gap, m.y - height / 2, "start"],
      [m.x - gap - w, m.y - height / 2, "end"],
      [m.x - w / 2, m.y - gap - height + 2, "middle"],
      [m.x - w / 2, m.y + gap - 2, "middle"],
      [m.x + gap - 2, m.y - m.r - height + 2, "start"],
      [m.x + gap - 2, m.y + m.r - 2, "start"],
      [m.x - gap + 2 - w, m.y - m.r - height + 2, "end"],
      [m.x - gap + 2 - w, m.y + m.r - 2, "end"],
    ];
    for (const [x, y, anchor] of candidates) {
      const box = { x, y, w, h: height };
      if (!inside(box) || hitsMark(box) || taken.some((t) => intersects(t, box))) continue;
      taken.push(box);
      const textX = anchor === "start" ? x + 2 : anchor === "end" ? x + w - 2 : x + w / 2;
      placed.push({ index, x: textX, y: y + height - 3, anchor });
      break;
    }
  }
  return placed;
}

/** Push sorted label positions apart so neighbours are at least `gap` apart. */
export function spreadLabels(positions: readonly number[], gap: number, min = -Infinity): number[] {
  const order = positions.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = new Array<number>(positions.length);
  let last = min - gap;
  for (const { y, i } of order) {
    const next = Math.max(y, last + gap);
    out[i] = next;
    last = next;
  }
  return out;
}

// ── Share shift ─────────────────────────────────────────────

export interface ShareShiftGroup {
  id: string;
  label: string;
  color: string;
  /** True when the cost is a USD estimate rather than AI Credits. */
  usdEstimate: boolean;
  tokens: number;
  spend: number;
  tokenShare: number;
  spendShare: number;
  /** Rows folded into an "others" group. */
  members?: ModelRow[];
}

/**
 * Token share and spend share for the `named` most-used priced models, with
 * the rest folded into one group. Unpriced models are left out of both
 * sides so the two bars describe the same set of models.
 */
export function buildShareShift(
  rows: readonly ModelRow[],
  named: number,
  tailColor: string,
): ShareShiftGroup[] {
  const priced = rows
    .filter((row) => (row.usdEquivalent ?? 0) > 0 && row.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
  const totalTokens = priced.reduce((sum, row) => sum + row.tokens, 0);
  const totalSpend = priced.reduce((sum, row) => sum + (row.usdEquivalent ?? 0), 0);
  if (totalTokens === 0 || totalSpend === 0) return [];
  const head = priced.slice(0, named);
  const tail = priced.slice(named);
  const groups: ShareShiftGroup[] = head.map((row) => ({
    id: row.id,
    label: row.label,
    color: row.color,
    usdEstimate: !row.billedInAiCredits,
    tokens: row.tokens,
    spend: row.usdEquivalent ?? 0,
    tokenShare: row.tokens / totalTokens,
    spendShare: (row.usdEquivalent ?? 0) / totalSpend,
  }));
  if (tail.length > 0) {
    const tokens = tail.reduce((sum, row) => sum + row.tokens, 0);
    const spend = tail.reduce((sum, row) => sum + (row.usdEquivalent ?? 0), 0);
    groups.push({
      id: "__others",
      label: tail.length === 1 ? tail[0].label : `${tail.length} others`,
      color: tail.length === 1 ? tail[0].color : tailColor,
      usdEstimate: tail.every((row) => !row.billedInAiCredits),
      tokens,
      spend,
      tokenShare: tokens / totalTokens,
      spendShare: spend / totalSpend,
      members: tail,
    });
  }
  return groups;
}

// ── Model mix over time ─────────────────────────────────────

export type MixMeasure = "tokens" | "share" | "spend";
export type MixGranularity = "day" | "week";

export interface ModelUsageDay {
  date: string;
  model: string;
  source?: SessionSource;
  inputTokens: number;
  outputTokens: number;
}

export interface MixBucket {
  /** First day of the bucket, `YYYY-MM-DD`. */
  start: string;
  /** Tokens or estimated USD per series key. */
  values: Record<string, number>;
  total: number;
}

export interface MixSeries {
  granularity: MixGranularity;
  /** Series in stacking order (bottom first); `OTHERS_KEY` collects the rest. */
  keys: string[];
  buckets: MixBucket[];
}

export const OTHERS_KEY = "__others";

/** Spans up to this many days are shown per day; longer spans per week. */
export const MIX_DAILY_MAX_DAYS = 45;

const DAY_MS = 86_400_000;
const parseDay = (date: string) => Date.parse(`${date}T00:00:00Z`);
const formatDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const weekStart = (ms: number) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS;

/**
 * Tokens (or estimated spend) per model per day or week, with empty buckets
 * filled in so gaps in activity stay visible. Spend spreads each model's
 * total cost over its days in proportion to tokens, so the buckets add up
 * to the model's cost on the rest of the page.
 */
export function buildMixSeries(
  usage: readonly ModelUsageDay[],
  rows: readonly ModelRow[],
  options: { measure: MixMeasure; named: readonly string[] },
): MixSeries {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const named = new Set(options.named);
  const keys = [...options.named, OTHERS_KEY];
  const days = usage.map((u) => parseDay(u.date)).filter((ms) => !Number.isNaN(ms));
  if (days.length === 0) return { granularity: "day", keys, buckets: [] };
  const first = Math.min(...days);
  const last = Math.max(...days);
  const granularity: MixGranularity =
    (last - first) / DAY_MS + 1 <= MIX_DAILY_MAX_DAYS ? "day" : "week";
  const bucketOf = (ms: number) => (granularity === "day" ? ms : weekStart(ms));
  const step = granularity === "day" ? DAY_MS : 7 * DAY_MS;

  const buckets = new Map<number, MixBucket>();
  for (let ms = bucketOf(first); ms <= bucketOf(last); ms += step) {
    buckets.set(ms, {
      start: formatDay(ms),
      values: Object.fromEntries(keys.map((key) => [key, 0])),
      total: 0,
    });
  }

  for (const u of usage) {
    const ms = parseDay(u.date);
    if (Number.isNaN(ms)) continue;
    const id = `${resolveSessionSource(u.source)}:${u.model}`;
    const row = rowsById.get(id);
    if (!row) continue; // filtered out of the page (source or repository)
    const tokens = u.inputTokens + u.outputTokens;
    const value =
      options.measure === "spend"
        ? row.tokens > 0
          ? ((row.usdEquivalent ?? 0) * tokens) / row.tokens
          : 0
        : tokens;
    const bucket = buckets.get(bucketOf(ms));
    if (!bucket) continue;
    const key = named.has(id) ? id : OTHERS_KEY;
    bucket.values[key] += value;
    bucket.total += value;
  }

  return { granularity, keys, buckets: [...buckets.values()] };
}
