/**
 * Pure tabulation, normalisation and ranking helpers for
 * `useModelComparison`.
 *
 * Everything in this module is a plain function (no Vue refs, no store
 * access) so it can be unit-tested directly with fixture data.
 */

import {
  AI_CREDIT_USD,
  calculateObservedAiCredits,
  formatAiCredits,
  formatNumber as formatCompactNumber,
  formatCost,
  formatNumber,
  formatPercent,
} from "@tracepilot/types";
import { formatModelDelta } from "@/utils/deltaFormatting";
import type {
  CompareMetric,
  ComputeWholesaleCost,
  ModelDistributionEntry,
  ModelRow,
  NormMode,
} from "./types";

/**
 * Index of the "best" entry in `arr`.
 *
 * @param arr     numeric series to scan.
 * @param higher  when `true` (default) the maximum is best; when `false`
 *                the minimum wins. Ties resolve to the first occurrence.
 * @returns the index of the best value, or `-1` when `arr` is empty.
 */
export function bestIdx(arr: number[], higher = true): number {
  if (!arr.length) return -1;
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (higher ? arr[i] > arr[best] : arr[i] < arr[best]) best = i;
  }
  return best;
}

/**
 * Best cost index, treating `null` costs as "unknown" (∞). If every row
 * has an unknown cost the function returns `-1` rather than picking an
 * arbitrary winner.
 */
export function bestCostIndex(rows: Array<{ cost: number | null }>): number {
  const costs = rows.map((m) => m.cost ?? Infinity);
  if (costs.every((c) => c === Infinity)) return -1;
  return bestIdx(costs, false);
}

export interface BuildModelRowsOptions {
  distribution: readonly ModelDistributionEntry[];
  computeWholesaleCost: ComputeWholesaleCost;
  computeUsageBasedCost?: ComputeWholesaleCost;
  costPerPremiumRequest: number;
  palette: readonly string[];
}

/**
 * Build the enriched per-model rows displayed in the comparison table.
 *
 * The `tokens` figure deliberately uses `inputTokens + outputTokens` —
 * `inputTokens` already includes `cacheReadTokens`, so adding the cache
 * read column again would double-count.
 */
export function buildModelRows({
  distribution,
  computeWholesaleCost,
  computeUsageBasedCost = computeWholesaleCost,
  costPerPremiumRequest,
  palette,
}: BuildModelRowsOptions): ModelRow[] {
  const grandTotal = distribution.reduce((sum, m) => sum + m.inputTokens + m.outputTokens, 0);
  return distribution.map((m, i) => {
    const tokens = m.inputTokens + m.outputTokens;
    const percentage = grandTotal > 0 ? (tokens / grandTotal) * 100 : 0;
    const cacheHitRate = m.inputTokens > 0 ? (m.cacheReadTokens / m.inputTokens) * 100 : 0;
    const cost = computeWholesaleCost(
      m.model,
      m.inputTokens,
      m.cacheReadTokens,
      m.outputTokens,
      m.cacheWriteTokens ?? 0,
    );
    const copilotCost = m.premiumRequests * costPerPremiumRequest;
    const hasCoverageFields =
      m.unobservedInputTokens != null ||
      m.unobservedOutputTokens != null ||
      m.unobservedCacheReadTokens != null ||
      m.unobservedCacheWriteTokens != null;
    const estimateInput = hasCoverageFields
      ? (m.unobservedInputTokens ?? 0)
      : m.totalNanoAiu == null
        ? m.inputTokens
        : 0;
    const estimateOutput = hasCoverageFields
      ? (m.unobservedOutputTokens ?? 0)
      : m.totalNanoAiu == null
        ? m.outputTokens
        : 0;
    const estimateCacheRead = hasCoverageFields
      ? (m.unobservedCacheReadTokens ?? 0)
      : m.totalNanoAiu == null
        ? m.cacheReadTokens
        : 0;
    const estimateCacheWrite = hasCoverageFields
      ? (m.unobservedCacheWriteTokens ?? 0)
      : m.totalNanoAiu == null
        ? (m.cacheWriteTokens ?? 0)
        : 0;
    const hasEstimateTokens =
      estimateInput + estimateOutput + estimateCacheRead + estimateCacheWrite > 0;
    const usageEstimate = hasEstimateTokens
      ? computeUsageBasedCost(
          m.model,
          estimateInput,
          estimateCacheRead,
          estimateOutput,
          estimateCacheWrite,
        )
      : null;
    const directEstimate =
      hasEstimateTokens && usageEstimate == null
        ? computeWholesaleCost(
            m.model,
            estimateInput,
            estimateCacheRead,
            estimateOutput,
            estimateCacheWrite,
          )
        : null;
    const observedCredits = calculateObservedAiCredits(m.totalNanoAiu);
    const estimatedCredits = (usageEstimate ?? directEstimate ?? 0) / AI_CREDIT_USD;
    const aiCredits =
      observedCredits != null || usageEstimate != null || directEstimate != null
        ? (observedCredits ?? 0) + estimatedCredits
        : null;
    const aiCreditSource =
      observedCredits != null && estimatedCredits > 0
        ? ("mixed-observed-estimated" as const)
        : observedCredits != null
          ? ("observed" as const)
          : usageEstimate != null
            ? ("estimated-token-usage" as const)
            : directEstimate != null
              ? ("estimated-direct-api" as const)
              : ("unavailable" as const);
    return {
      model: m.model,
      color: palette[i % palette.length],
      tokens,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheReadTokens: m.cacheReadTokens,
      cacheWriteTokens: m.cacheWriteTokens ?? 0,
      percentage,
      premiumRequests: m.premiumRequests,
      cacheHitRate,
      aiCredits,
      aiCreditSource,
      cost,
      copilotCost,
    };
  });
}

/**
 * Apply the active normalisation mode to a list of rows.
 *
 * - `raw` — pass-through.
 * - `per-10m-tokens` — divides volumetric fields by `tokens / 10_000_000`
 *   (so the output represents activity scaled to a 10M-token baseline).
 *   Rows with zero tokens are passed through unchanged (divisor falls
 *   back to `1`).
 * - `share` — converts volumetric fields into a per-row share of the
 *   group total, expressed as a percentage.
 */
export function normalizeRows(rows: readonly ModelRow[], mode: NormMode): ModelRow[] {
  if (mode === "raw") return rows.slice();

  if (mode === "per-10m-tokens") {
    return rows.map((r) => {
      const divisor = r.tokens / 10_000_000 || 1;
      return {
        ...r,
        tokens: r.tokens / divisor,
        inputTokens: r.inputTokens / divisor,
        outputTokens: r.outputTokens / divisor,
        cacheReadTokens: r.cacheReadTokens / divisor,
        premiumRequests: r.premiumRequests / divisor,
        aiCredits: r.aiCredits != null ? r.aiCredits / divisor : null,
        cost: r.cost != null ? r.cost / divisor : null,
        copilotCost: r.copilotCost / divisor,
      };
    });
  }

  const sums = rows.reduce(
    (acc, r) => ({
      tokens: acc.tokens + r.tokens,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
      premiumRequests: acc.premiumRequests + r.premiumRequests,
      aiCredits: acc.aiCredits + (r.aiCredits ?? 0),
      cost: acc.cost + (r.cost ?? 0),
      copilotCost: acc.copilotCost + r.copilotCost,
    }),
    {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      premiumRequests: 0,
      aiCredits: 0,
      cost: 0,
      copilotCost: 0,
    },
  );

  return rows.map((r) => ({
    ...r,
    tokens: sums.tokens > 0 ? (r.tokens / sums.tokens) * 100 : 0,
    inputTokens: sums.inputTokens > 0 ? (r.inputTokens / sums.inputTokens) * 100 : 0,
    outputTokens: sums.outputTokens > 0 ? (r.outputTokens / sums.outputTokens) * 100 : 0,
    cacheReadTokens:
      sums.cacheReadTokens > 0 ? (r.cacheReadTokens / sums.cacheReadTokens) * 100 : 0,
    premiumRequests:
      sums.premiumRequests > 0 ? (r.premiumRequests / sums.premiumRequests) * 100 : 0,
    aiCredits: sums.aiCredits > 0 ? ((r.aiCredits ?? 0) / sums.aiCredits) * 100 : 0,
    cost: sums.cost > 0 ? ((r.cost ?? 0) / sums.cost) * 100 : 0,
    copilotCost: sums.copilotCost > 0 ? (r.copilotCost / sums.copilotCost) * 100 : 0,
  }));
}

/**
 * Format a numeric value for display in the comparison table, taking the
 * active normalisation mode into account.
 */
export function formatNorm(value: number | null, isCost: boolean, mode: NormMode): string {
  if (value == null) return "—";
  if (mode === "share") return `${value.toFixed(1)}%`;
  if (isCost) {
    if (Math.abs(value) >= 1_000) return `$${formatCompactNumber(value).toUpperCase()}`;
    return formatCost(value);
  }
  if (mode === "per-10m-tokens") {
    if (Math.abs(value) >= 1_000) return formatNumber(value);
    return value % 1 === 0 ? value.toString() : value.toFixed(1);
  }
  return formatNumber(value);
}

/**
 * Compute the five radar-chart axis values (each in `[0, 1]`) for a row:
 * token volume, cache efficiency, premium-request share, cost efficiency
 * and token share. Cost efficiency is inverted so higher = cheaper.
 */
export function computeRadarValues(row: ModelRow, rows: readonly ModelRow[]): number[] {
  const maxTokens = Math.max(...rows.map((m) => m.tokens), 1);
  const tokenVol = row.tokens / maxTokens;
  const cacheEff = row.cacheHitRate / 100;
  const maxAiCredits = Math.max(...rows.map((m) => m.aiCredits ?? 0), 1);
  const aiCreditShare = (row.aiCredits ?? 0) / maxAiCredits;
  const costPerToken = row.aiCredits != null && row.tokens > 0 ? row.aiCredits / row.tokens : 0;
  const maxCostPerToken = Math.max(
    ...rows.map((m) => (m.aiCredits ?? 0) / Math.max(m.tokens, 1)),
    0.0001,
  );
  const costEff = 1 - Math.min(costPerToken / maxCostPerToken, 1);
  const share = row.percentage / 100;
  return [tokenVol, cacheEff, aiCreditShare, costEff, share];
}

/**
 * Pre-compute the per-axis maxima that drive the scatter plot bounds.
 * Guards against empty input by clamping to `1` token / `0.01` cost.
 */
export function computeScatterScale(rows: readonly ModelRow[]): { maxT: number; maxC: number } {
  const maxT = Math.max(...rows.map((m) => m.tokens), 1);
  const maxC = Math.max(...rows.map((m) => m.aiCredits ?? 0), 0.01);
  return { maxT, maxC };
}

/**
 * Build the side-by-side comparison rows shown beneath the table.
 *
 * `fmtNorm` is injected so the caller controls active-mode formatting.
 */
export function buildCompareMetrics(
  a: ModelRow | undefined,
  b: ModelRow | undefined,
  fmtNorm: (value: number | null, isCost?: boolean) => string,
): CompareMetric[] {
  if (!a || !b) return [];
  return [
    {
      label: "Total Tokens",
      valueA: fmtNorm(a.tokens),
      valueB: fmtNorm(b.tokens),
      ...formatModelDelta(a.tokens, b.tokens, true),
    },
    {
      label: "Input Tokens",
      valueA: fmtNorm(a.inputTokens),
      valueB: fmtNorm(b.inputTokens),
      ...formatModelDelta(a.inputTokens, b.inputTokens, true),
    },
    {
      label: "Output Tokens",
      valueA: fmtNorm(a.outputTokens),
      valueB: fmtNorm(b.outputTokens),
      ...formatModelDelta(a.outputTokens, b.outputTokens, true),
    },
    {
      label: "Cache Read",
      valueA: fmtNorm(a.cacheReadTokens),
      valueB: fmtNorm(b.cacheReadTokens),
      ...formatModelDelta(a.cacheReadTokens, b.cacheReadTokens, true),
    },
    {
      label: "Token Share",
      valueA: formatPercent(a.percentage),
      valueB: formatPercent(b.percentage),
      ...formatModelDelta(a.percentage, b.percentage, true),
    },
    {
      label: "AI Credits",
      valueA: formatAiCredits(a.aiCredits),
      valueB: formatAiCredits(b.aiCredits),
      ...formatModelDelta(a.aiCredits ?? 0, b.aiCredits ?? 0, false),
    },
    {
      label: "Cache Hit Rate",
      valueA: formatPercent(a.cacheHitRate),
      valueB: formatPercent(b.cacheHitRate),
      ...formatModelDelta(a.cacheHitRate, b.cacheHitRate, true),
    },
    {
      label: "Legacy Premium Cost",
      valueA: fmtNorm(a.copilotCost, true),
      valueB: fmtNorm(b.copilotCost, true),
      ...formatModelDelta(a.copilotCost, b.copilotCost, false),
    },
  ];
}
