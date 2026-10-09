/**
 * Shared types for the `useModelComparison` composable and its pure helpers.
 *
 * Extracted from `useModelComparison.ts` to keep the composable file slim
 * and to allow the pure helpers in `metrics.ts` / `sorting.ts` to import
 * the type surface without pulling in Vue reactivity.
 */

import type { AiCreditSource, SessionSource } from "@tracepilot/types";

export type CostMode = "wholesale" | "copilot" | "both";
export type NormMode = "raw" | "per-10m-tokens" | "share";

export type SortKey =
  | "model"
  | "tokens"
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "percentage"
  | "premiumRequests"
  | "cacheHitRate"
  | "aiCredits"
  | "cost"
  | "copilotCost";

export interface ModelRow {
  /** Unique across sources: `<source>:<model>`. */
  id: string;
  /** Display name: the model, plus its source when two sources share it. */
  label: string;
  model: string;
  /** The model across sources, e.g. `claude-opus-4.5` for a dated Claude id. */
  family: string;
  source: SessionSource;
  /** False for sources priced in USD (Claude Code); they have no AI Credits. */
  billedInAiCredits: boolean;
  color: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  percentage: number;
  premiumRequests: number;
  /** API requests the model served. */
  requestCount: number;
  cacheHitRate: number;
  aiCredits: number | null;
  aiCreditSource: AiCreditSource;
  cost: number | null;
  copilotCost: number;
  /** Provider-priced USD for sources not billed in AI Credits. */
  costUsd: number | null;
  costUsdPartial: boolean;
  /**
   * Cost in API-equivalent USD (AI Credits at their USD value, or the
   * provider USD estimate), so charts can place every source on one axis.
   */
  usdEquivalent: number | null;
}

export interface CompareMetric {
  label: string;
  valueA: string;
  valueB: string;
  delta: string;
  direction: "up" | "down" | "neutral";
  better: "a" | "b" | "neutral";
}

/**
 * Subset of {@link import("@tracepilot/types").AnalyticsData}'s
 * `modelDistribution` entry that the pure row-builder depends on. Kept as a
 * minimal structural type so helpers can be tested without the full
 * `AnalyticsData` fixture.
 */
export interface ModelDistributionEntry {
  model: string;
  source?: SessionSource;
  costUsd?: number | null;
  costUsdPartial?: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens?: number;
  premiumRequests: number;
  requestCount?: number;
  totalNanoAiu?: number | null;
  unobservedInputTokens?: number;
  unobservedOutputTokens?: number;
  unobservedCacheReadTokens?: number;
  unobservedCacheWriteTokens?: number;
}

/** Signature compatible with `usePreferencesStore().computeWholesaleCost`. */
export type ComputeWholesaleCost = (
  model: string,
  inputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
  cacheWriteTokens?: number,
) => number | null;
