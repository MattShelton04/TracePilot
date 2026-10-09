/**
 * Series for the share-shift and model-mix charts. Costs are API-equivalent
 * USD (`ModelRow.usdEquivalent`) so models from every source share one axis.
 */

import { resolveSessionSource, type SessionSource } from "@tracepilot/types";
import type { ModelRow } from "../types";

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
