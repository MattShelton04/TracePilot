/**
 * Pure computation functions for session metrics.
 * Extracted from SessionComparisonView to enable reuse across views.
 */
import {
  type AiCreditUsage,
  type ConversationTurn,
  type ModelMetricDetail,
  resolveAiCreditUsage,
  type SessionDetail,
  type SessionSource,
  type ShutdownMetrics,
  sourceCapabilities,
  sumTokenCosts,
  type TokenCostBreakdown,
} from "@tracepilot/types";
import { modelTokenBreakdown, shutdownTokenBreakdown } from "@/utils/metricsTokenBreakdown";

export function totalTokens(m: ShutdownMetrics | null): number | null {
  return shutdownTokenBreakdown(m).total;
}

export function totalInputTokens(m: ShutdownMetrics | null): number | null {
  return shutdownTokenBreakdown(m).input;
}

export function totalOutputTokens(m: ShutdownMetrics | null): number | null {
  return shutdownTokenBreakdown(m).output;
}

export function totalCacheRead(m: ShutdownMetrics | null): number | null {
  return shutdownTokenBreakdown(m).cacheRead;
}

export function totalReasoningTokens(m: ShutdownMetrics | null): number | null {
  return shutdownTokenBreakdown(m).reasoning;
}

type TokenCostCalculator = (
  model: string,
  input: number,
  cache: number,
  output: number,
  cacheWrite?: number,
) => TokenCostBreakdown;

interface ShutdownCreditPricing {
  computeUsageBasedCostBreakdown: TokenCostCalculator;
  computeWholesaleCostBreakdown: TokenCostCalculator;
}

/** Positive observed credits mean zero token counters cannot establish a free estimate. */
export function hasObservedCreditsWithZeroTokens(model: ModelMetricDetail): boolean {
  const observed = resolveAiCreditUsage(model.totalNanoAiu);
  return observed.credits != null && observed.credits > 0 && modelTokenBreakdown(model).total === 0;
}

/** False when the metrics carry a provider cost in a unit other than AI Credits. */
export function costUnitAllowsAiCredits(metrics: ShutdownMetrics | null | undefined): boolean {
  return metrics?.costUnit == null || metrics.costUnit === "aic";
}

/**
 * Whether missing AI Credits may be estimated from GitHub rates. Only sources
 * billed in AI Credits qualify; estimating them for another source would show
 * "estimated AI Credits" for usage that was never billed that way.
 */
export function allowsAiCreditEstimate(
  source: SessionSource | null | undefined,
  metrics?: ShutdownMetrics | null,
): boolean {
  return sourceCapabilities(source).hasAic && costUnitAllowsAiCredits(metrics);
}

/** Both session views use observed credits first, then a complete token estimate. */
export function shutdownAiCreditUsage(
  metrics: ShutdownMetrics | null | undefined,
  pricing: ShutdownCreditPricing,
  observedOnly = false,
): AiCreditUsage {
  const observed = resolveAiCreditUsage(metrics?.totalNanoAiu);
  if (observed.source === "observed" || observedOnly || !costUnitAllowsAiCredits(metrics)) {
    return observed;
  }
  // Partial input/output counts cannot establish a session-wide cost. Optional
  // cache counts retain the historical zero fallback used by the pricing API.
  if (shutdownTokenBreakdown(metrics).total == null) return observed;
  const modelEntries = Object.entries(metrics?.modelMetrics ?? {});
  // Do not silently omit an observed charge when estimating the whole session.
  if (modelEntries.some(([, model]) => hasObservedCreditsWithZeroTokens(model))) return observed;
  // Recorded zero usage costs nothing, even for a model without a price.
  const models = modelEntries.filter(
    ([, model]) =>
      (model.usage?.inputTokens ?? 0) +
        (model.usage?.outputTokens ?? 0) +
        (model.usage?.cacheReadTokens ?? 0) +
        (model.usage?.cacheWriteTokens ?? 0) >
      0,
  );
  const estimate = (calculate: TokenCostCalculator) =>
    sumTokenCosts(
      models.map(([name, model]) =>
        calculate(
          name,
          model.usage?.inputTokens ?? 0,
          model.usage?.cacheReadTokens ?? 0,
          model.usage?.outputTokens ?? 0,
          model.usage?.cacheWriteTokens ?? 0,
        ),
      ),
    );
  return resolveAiCreditUsage(
    metrics?.totalNanoAiu,
    estimate(pricing.computeUsageBasedCostBreakdown),
    estimate(pricing.computeWholesaleCostBreakdown),
  );
}

/** True when the session has any reasoning token data (v1.0.24+ sessions). */
export function hasReasoningTokenData(m: ShutdownMetrics | null): boolean {
  if (!m?.modelMetrics) return false;
  return Object.values(m.modelMetrics).some((mm) => mm.usage?.reasoningTokens != null);
}

/** True when the session has token budget data (v1.0.8+ sessions). */
export function hasTokenBudgetData(m: ShutdownMetrics | null): boolean {
  return m?.currentTokens != null || m?.systemTokens != null;
}

export function wholesaleCost(
  m: ShutdownMetrics | null,
  computeWholesaleCost: (
    model: string,
    input: number,
    cache: number,
    output: number,
    cacheWrite?: number,
  ) => number | null,
): number {
  if (!m?.modelMetrics) return 0;
  return Object.entries(m.modelMetrics).reduce((sum, [model, mm]) => {
    const cost = computeWholesaleCost(
      model,
      mm.usage?.inputTokens ?? 0,
      mm.usage?.cacheReadTokens ?? 0,
      mm.usage?.outputTokens ?? 0,
      mm.usage?.cacheWriteTokens ?? 0,
    );
    return sum + (cost ?? 0);
  }, 0);
}

export function copilotCost(m: ShutdownMetrics | null, costPerPremiumRequest: number): number {
  if (!m) return 0;
  return (m.totalPremiumRequests ?? 0) * costPerPremiumRequest;
}

export function totalToolCalls(turns: ConversationTurn[]): number {
  return turns.reduce((s, t) => s + (t.toolCalls?.length ?? 0), 0);
}

export function successRate(turns: ConversationTurn[]): number {
  let total = 0;
  let success = 0;
  for (const t of turns) {
    for (const tc of t.toolCalls ?? []) {
      total++;
      if (tc.success === true) success++;
    }
  }
  return total === 0 ? 1 : success / total;
}

export function toolCounts(turns: ConversationTurn[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of turns) {
    for (const tc of t.toolCalls ?? []) {
      counts[tc.toolName] = (counts[tc.toolName] ?? 0) + 1;
    }
  }
  return counts;
}

export function sessionDurationMs(detail: SessionDetail | null): number {
  if (!detail?.createdAt || !detail?.updatedAt) return 0;
  return new Date(detail.updatedAt).getTime() - new Date(detail.createdAt).getTime();
}

export function linesChanged(m: ShutdownMetrics | null): number {
  return (m?.codeChanges?.linesAdded ?? 0) + (m?.codeChanges?.linesRemoved ?? 0);
}

export function filesModified(m: ShutdownMetrics | null): number {
  return m?.codeChanges?.filesModified?.length ?? 0;
}
