/**
 * Per-model profile measures and their ranks, which drive the fingerprint,
 * overlay and trail views.
 */

import type { ModelRow } from "../types";
import type { ModelTooltipContent } from "../useModelChartTooltip";
import { formatRate, formatRowSpend, formatShare, formatTokens } from "./format";

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
