import {
  AI_CREDIT_USD,
  type AiCreditSource,
  type AnalyticsData,
  calculateObservedAiCredits,
  type SessionSource,
  sourceCapabilities,
} from "@tracepilot/types";

/** `usd` is provider-priced USD for sources not billed in AI Credits. */
export type AnalyticsCostBasis = "aiCredits" | "legacy" | "directApi" | "usd";

/**
 * Only usage from a source billed in AI Credits is priced in AI Credits.
 * Rows from payloads that predate sources are Copilot's.
 */
export function billedInAiCredits(usage: { source?: SessionSource | null }): boolean {
  return sourceCapabilities(usage.source).hasAic;
}

export interface CostPoint {
  date: string;
  cost: number;
}

type ComputeTokenCost = (
  model: string,
  inputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
  cacheWriteTokens?: number,
) => number | null;

export interface AnalyticsAiCreditSummary {
  credits: number | null;
  usdEquivalent: number | null;
  source: AiCreditSource;
  observedCredits: number;
  estimatedCredits: number;
  isPartial: boolean;
}

interface EstimableUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalNanoAiu?: number | null;
  unobservedInputTokens?: number;
  unobservedOutputTokens?: number;
  unobservedCacheReadTokens?: number;
  unobservedCacheWriteTokens?: number;
}

function usageToEstimate(usage: EstimableUsage) {
  const hasCoverageFields =
    usage.unobservedInputTokens != null ||
    usage.unobservedOutputTokens != null ||
    usage.unobservedCacheReadTokens != null ||
    usage.unobservedCacheWriteTokens != null;

  if (hasCoverageFields) {
    return {
      input: usage.unobservedInputTokens ?? 0,
      output: usage.unobservedOutputTokens ?? 0,
      cacheRead: usage.unobservedCacheReadTokens ?? 0,
      cacheWrite: usage.unobservedCacheWriteTokens ?? 0,
    };
  }

  // Compatibility with analytics payloads from before coverage-aware
  // aggregation: estimate the full row only when it has no observed AIC.
  if (usage.totalNanoAiu != null) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  }
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens,
    cacheWrite: usage.cacheWriteTokens,
  };
}

function estimateCredits(
  usage: EstimableUsage,
  computeUsageBasedCost: ComputeTokenCost,
  computeDirectApiCost: ComputeTokenCost,
): { credits: number; unknown: boolean; usedDirectApi: boolean } {
  const tokens = usageToEstimate(usage);
  if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite === 0) {
    return { credits: 0, unknown: false, usedDirectApi: false };
  }

  const usageCost = computeUsageBasedCost(
    usage.model,
    tokens.input,
    tokens.cacheRead,
    tokens.output,
    tokens.cacheWrite,
  );
  if (usageCost != null) {
    return { credits: usageCost / AI_CREDIT_USD, unknown: false, usedDirectApi: false };
  }

  const directCost = computeDirectApiCost(
    usage.model,
    tokens.input,
    tokens.cacheRead,
    tokens.output,
    tokens.cacheWrite,
  );
  return directCost == null
    ? { credits: 0, unknown: true, usedDirectApi: false }
    : { credits: directCost / AI_CREDIT_USD, unknown: false, usedDirectApi: true };
}

export function buildAnalyticsAiCreditSummary(
  data: AnalyticsData,
  computeUsageBasedCost: ComputeTokenCost,
  computeDirectApiCost: ComputeTokenCost,
): AnalyticsAiCreditSummary {
  const observedCredits = calculateObservedAiCredits(data.totalNanoAiu) ?? 0;
  let estimatedCredits = 0;
  let isPartial = false;
  let usedDirectApi = false;

  for (const usage of data.modelDistribution) {
    if (!billedInAiCredits(usage)) continue;
    const estimate = estimateCredits(usage, computeUsageBasedCost, computeDirectApiCost);
    estimatedCredits += estimate.credits;
    isPartial ||= estimate.unknown;
    usedDirectApi ||= estimate.usedDirectApi;
  }

  const hasObserved = (data.sessionsWithObservedAiCredits ?? 0) > 0 || observedCredits > 0;
  const hasEstimate = estimatedCredits > 0;
  const credits = observedCredits + estimatedCredits;
  let source: AiCreditSource;
  if (hasObserved && hasEstimate) source = "mixed-observed-estimated";
  else if (hasObserved) source = "observed";
  else if (hasEstimate) {
    source = usedDirectApi ? "estimated-direct-api" : "estimated-token-usage";
  } else source = "unavailable";

  return {
    credits: source === "unavailable" ? null : credits,
    usdEquivalent: source === "unavailable" ? null : credits * AI_CREDIT_USD,
    source,
    observedCredits,
    estimatedCredits,
    isPartial,
  };
}

export function buildAnalyticsCostSeries(
  data: AnalyticsData,
  basis: AnalyticsCostBasis,
  costPerPremiumRequest: number,
  computeDirectApiCost: ComputeTokenCost,
  computeUsageBasedCost: ComputeTokenCost = computeDirectApiCost,
): CostPoint[] {
  if (basis === "legacy") {
    return data.costByDay.map((p) => ({
      date: p.date,
      cost: p.cost * costPerPremiumRequest,
    }));
  }
  if (basis === "usd") {
    return (data.costUsdByDay ?? []).map((p) => ({ date: p.date, cost: p.cost }));
  }

  const totalsByDate = new Map<string, number>();
  for (const usage of data.modelUsageByDay) {
    if (!billedInAiCredits(usage)) continue;
    const value =
      basis === "directApi"
        ? (computeDirectApiCost(
            usage.model,
            usage.inputTokens,
            usage.cacheReadTokens,
            usage.outputTokens,
            usage.cacheWriteTokens,
          ) ?? 0)
        : (calculateObservedAiCredits(usage.totalNanoAiu) ?? 0) +
          estimateCredits(usage, computeUsageBasedCost, computeDirectApiCost).credits;
    totalsByDate.set(usage.date, (totalsByDate.get(usage.date) ?? 0) + value);
  }

  return Array.from(totalsByDate, ([date, cost]) => ({ date, cost })).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export interface SourceCostRow {
  source: SessionSource;
  sessions: number;
  tokens: number;
  /** The source's own unit: AI Credits for Copilot, USD otherwise. */
  unit: "aic" | "usd";
  /** AI Credits or USD; null when the source has no priced usage. */
  amount: number | null;
  /** USD equivalent of AI Credits; null for USD rows. */
  usdEquivalent: number | null;
  partial: boolean;
}

/**
 * One row per source in `costBySource`, each in its own billing unit. The
 * AI Credit row reuses the dashboard summary, which prices only usage from
 * sources billed in AI Credits. Rows are never summed together.
 */
export function buildSourceCostRows(
  data: AnalyticsData,
  aiCredits: AnalyticsAiCreditSummary | null,
): SourceCostRow[] {
  return (data.costBySource ?? []).map((entry) => {
    if (sourceCapabilities(entry.source).hasAic) {
      return {
        source: entry.source,
        sessions: entry.sessions,
        tokens: entry.tokens,
        unit: "aic",
        amount: aiCredits?.credits ?? null,
        usdEquivalent: aiCredits?.usdEquivalent ?? null,
        partial: aiCredits?.isPartial ?? false,
      };
    }
    return {
      source: entry.source,
      sessions: entry.sessions,
      tokens: entry.tokens,
      unit: "usd",
      amount: entry.costUsd,
      usdEquivalent: null,
      partial: entry.costUsd != null && entry.sessionsWithCostUsd < entry.sessions,
    };
  });
}
