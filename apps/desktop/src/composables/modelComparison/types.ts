/**
 * Shared types for the `useModelComparison` composable and its pure helpers.
 *
 * Extracted from `useModelComparison.ts` to keep the composable file slim
 * and to allow the pure helpers in `metrics.ts` / `sorting.ts` to import
 * the type surface without pulling in Vue reactivity.
 */

import type { AiCreditSource } from "@tracepilot/types";

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
  model: string;
  color: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  percentage: number;
  premiumRequests: number;
  cacheHitRate: number;
  aiCredits: number | null;
  aiCreditSource: AiCreditSource;
  cost: number | null;
  copilotCost: number;
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
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens?: number;
  premiumRequests: number;
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
