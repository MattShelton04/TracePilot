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
  resolveSessionSource,
} from "@tracepilot/types";
import { billedInAiCredits } from "@/utils/analyticsCostSeries";
import { formatModelDelta } from "@/utils/deltaFormatting";
import { modelLabels } from "@/utils/modelLabels";
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
  /**
   * Colour for models past the end of the palette. Without it the palette
   * repeats, which gives unrelated models the same colour.
   */
  tailColor?: string;
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
  tailColor,
}: BuildModelRowsOptions): ModelRow[] {
  // Colours follow token rank, so the most-used models get the named colours
  // whatever order the distribution arrives in.
  const tokenRank = new Map(
    distribution
      .map((m, i) => ({ i, tokens: m.inputTokens + m.outputTokens }))
      .sort((a, b) => b.tokens - a.tokens)
      .map((entry, rank) => [entry.i, rank]),
  );
  const colorAt = (i: number) => {
    const rank = tokenRank.get(i) ?? i;
    if (rank < palette.length || tailColor == null) return palette[rank % palette.length];
    return tailColor;
  };
  const grandTotal = distribution.reduce((sum, m) => sum + m.inputTokens + m.outputTokens, 0);
  const labels = modelLabels(distribution);
  return distribution.map((m, i) => {
    const source = resolveSessionSource(m.source);
    const { family, label } = labels[i];
    // A source priced in USD is never estimated in AI Credits.
    const billed = billedInAiCredits(m);
    const costUsd = m.costUsd ?? null;
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
      billed && estimateInput + estimateOutput + estimateCacheRead + estimateCacheWrite > 0;
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
    const observedCredits = billed ? calculateObservedAiCredits(m.totalNanoAiu) : null;
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
      id: `${source}:${m.model}`,
      label,
      family,
      model: m.model,
      source,
      billedInAiCredits: billed,
      color: colorAt(i),
      tokens,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheReadTokens: m.cacheReadTokens,
      cacheWriteTokens: m.cacheWriteTokens ?? 0,
      percentage,
      premiumRequests: m.premiumRequests,
      requestCount: m.requestCount ?? 0,
      cacheHitRate,
      aiCredits,
      aiCreditSource,
      // A USD-priced source has a provider estimate that includes cache
      // tiers a token-rate estimate cannot see.
      cost: billed ? cost : costUsd,
      copilotCost,
      costUsd,
      costUsdPartial: m.costUsdPartial ?? false,
      usdEquivalent: billed ? (aiCredits == null ? null : aiCredits * AI_CREDIT_USD) : costUsd,
    };
  });
}

/**
 * The first model used by two sources, as a [Copilot, other] pair of row
 * ids, so the comparison opens on the same model across sources.
 */
export function crossSourcePair(rows: readonly ModelRow[]): [string, string] | null {
  for (const row of rows) {
    if (row.source !== "copilot") continue;
    const other = rows.find((r) => r.family === row.family && r.source !== row.source);
    if (other) return [row.id, other.id];
  }
  return null;
}

/** The cost a row is priced in, in that row's own unit. */
export function formatRowCost(row: ModelRow): string {
  if (row.billedInAiCredits) return formatAiCredits(row.aiCredits);
  return row.costUsd == null ? "—" : `${formatCost(row.costUsd)} est.`;
}

/** A row's cost for the narrow matrix column: the header says it is an estimate. */
export function formatRowCostShort(row: ModelRow): string {
  if (row.billedInAiCredits) return formatAiCredits(row.aiCredits);
  return row.costUsd == null ? "—" : formatCost(row.costUsd);
}

/**
 * A row's cost-column value in the active normalisation mode, always in the
 * row's own unit: AI Credits say "AIC", USD estimates "$", shares "%".
 */
export function formatRowCostNorm(row: ModelRow, mode: NormMode): string {
  if (mode === "raw") return formatRowCostShort(row);
  const value = row.billedInAiCredits ? row.aiCredits : row.costUsd;
  if (mode === "per-10m-tokens" && row.billedInAiCredits) return formatAiCredits(value);
  return formatNorm(value, !row.billedInAiCredits, mode);
}

/**
 * Where a row's cost comes from. An unpriced row says so instead of
 * claiming an estimate.
 */
export function rowCostSource(row: ModelRow): string {
  if (!row.billedInAiCredits) {
    if (row.costUsd == null) return "Unpriced";
    return row.costUsdPartial ? "Partial USD" : "USD estimate";
  }
  switch (row.aiCreditSource) {
    case "observed":
      return "Observed";
    case "mixed-observed-estimated":
      return "Mixed";
    case "unavailable":
      return "Unpriced";
    default:
      return "Estimated";
  }
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
        costUsd: r.costUsd != null ? r.costUsd / divisor : null,
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
      costUsd: acc.costUsd + (r.costUsd ?? 0),
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
      costUsd: 0,
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
    costUsd: r.costUsd != null && sums.costUsd > 0 ? (r.costUsd / sums.costUsd) * 100 : null,
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
    costMetric(a, b, fmtNorm),
    {
      label: "Cache Hit Rate",
      valueA: formatPercent(a.cacheHitRate),
      valueB: formatPercent(b.cacheHitRate),
      ...formatModelDelta(a.cacheHitRate, b.cacheHitRate, true),
    },
    premiumMetric(a, b, fmtNorm),
  ];
}

/**
 * Copilot's legacy premium-request cost. It does not apply to a row billed
 * in another unit, which shows "—" rather than a $0 that looks cheaper.
 */
function premiumMetric(
  a: ModelRow,
  b: ModelRow,
  fmtNorm: (value: number | null, isCost?: boolean) => string,
): CompareMetric {
  const value = (row: ModelRow) => (row.billedInAiCredits ? fmtNorm(row.copilotCost, true) : "—");
  return {
    label: "Legacy Premium Cost",
    valueA: value(a),
    valueB: value(b),
    ...(a.billedInAiCredits && b.billedInAiCredits
      ? formatModelDelta(a.copilotCost, b.copilotCost, false)
      : { delta: "—", direction: "neutral" as const, better: "neutral" as const }),
  };
}

/**
 * Cost in each row's own unit. AI Credits and USD are different bills, so a
 * cross-source pair shows both values without a delta.
 */
function costMetric(
  a: ModelRow,
  b: ModelRow,
  fmtNorm: (value: number | null, isCost?: boolean) => string,
): CompareMetric {
  if (a.billedInAiCredits && b.billedInAiCredits) {
    return {
      label: "AI Credits",
      valueA: formatAiCredits(a.aiCredits),
      valueB: formatAiCredits(b.aiCredits),
      ...formatModelDelta(a.aiCredits ?? 0, b.aiCredits ?? 0, false),
    };
  }
  if (!a.billedInAiCredits && !b.billedInAiCredits) {
    return {
      label: "Estimated Cost",
      valueA: fmtNorm(a.costUsd, true),
      valueB: fmtNorm(b.costUsd, true),
      ...(a.costUsd == null || b.costUsd == null
        ? { delta: "—", direction: "neutral" as const, better: "neutral" as const }
        : formatModelDelta(a.costUsd, b.costUsd, false)),
    };
  }
  return {
    label: "Cost",
    valueA: formatRowCost(a),
    valueB: formatRowCost(b),
    delta: "Different units",
    direction: "neutral",
    better: "neutral",
  };
}
