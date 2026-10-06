import {
  type AiCreditSource,
  resolveAiCreditUsage,
  type ShutdownMetrics,
  sumTokenCosts,
} from "@tracepilot/types";
import { type ComputedRef, computed, type MaybeRefOrGetter, toValue } from "vue";
import {
  costUnitAllowsAiCredits,
  hasObservedCreditsWithZeroTokens,
  shutdownAiCreditUsage,
} from "@/composables/useSessionMetrics";
import type { usePreferencesStore } from "@/stores/preferences";
import {
  type MetricsTokenBreakdown,
  modelTokenBreakdown,
  shutdownTokenBreakdown,
} from "@/utils/metricsTokenBreakdown";

type PreferencesStore = ReturnType<typeof usePreferencesStore>;

export interface MetricsModelEntry {
  [key: string]: unknown;
  name: string;
  requests: number | null;
  aiCredits: number | null;
  aiCreditUsd: number | null;
  aiCreditSource: AiCreditSource;
  directApiCost: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number | null;
  totalTokens: number;
  legacyPremiumRequests: number;
  tokens: MetricsTokenBreakdown;
}

/**
 * `observedOnly` turns off AI Credit estimates, for agent snapshots and for
 * sources that are not billed in AI Credits.
 */
export function useMetricsTabData(
  metrics: ComputedRef<ShutdownMetrics | null | undefined>,
  prefs: PreferencesStore,
  observedOnly: MaybeRefOrGetter<boolean> = false,
) {
  const creditsObservedOnly = computed(
    () => toValue(observedOnly) || !costUnitAllowsAiCredits(metrics.value),
  );
  const modelEntries = computed<MetricsModelEntry[]>(() => {
    if (!metrics.value?.modelMetrics) return [];
    const noEstimate = creditsObservedOnly.value;
    return Object.entries(metrics.value.modelMetrics)
      .map(([name, data]) => {
        const inputTokens = data.usage?.inputTokens ?? 0;
        const outputTokens = data.usage?.outputTokens ?? 0;
        const cacheReadTokens = data.usage?.cacheReadTokens ?? 0;
        const cacheWriteTokens = data.usage?.cacheWriteTokens ?? 0;
        const reasoningTokens = data.usage?.reasoningTokens ?? null;
        const tokens = modelTokenBreakdown(data);
        // Recorded zero usage costs nothing, even for a model without a price.
        const hasTokenUsage = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens > 0;
        const usageBased =
          tokens.total == null
            ? null
            : hasTokenUsage
              ? prefs.computeUsageBasedCostBreakdown(
                  name,
                  inputTokens,
                  cacheReadTokens,
                  outputTokens,
                  cacheWriteTokens,
                )
              : sumTokenCosts([]);
        const premiumRequests = data.requests?.cost ?? 0;
        // A recorded charge conflicts with the zero counters, so the direct
        // fallback cannot confidently present a free model or session estimate.
        const wholesale =
          tokens.total == null || hasObservedCreditsWithZeroTokens(data)
            ? null
            : hasTokenUsage
              ? prefs.computeWholesaleCostBreakdown(
                  name,
                  inputTokens,
                  cacheReadTokens,
                  outputTokens,
                  cacheWriteTokens,
                )
              : sumTokenCosts([]);
        const aiCreditUsage = resolveAiCreditUsage(
          data.totalNanoAiu,
          noEstimate ? null : usageBased,
          noEstimate ? null : wholesale,
        );
        return {
          name,
          requests: data.requests?.count ?? null,
          aiCredits: aiCreditUsage.credits,
          aiCreditUsd: aiCreditUsage.usdEquivalent,
          aiCreditSource: aiCreditUsage.source,
          directApiCost: wholesale?.totalCost ?? null,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          reasoningTokens,
          totalTokens: inputTokens + outputTokens,
          legacyPremiumRequests: premiumRequests,
          tokens,
        };
      })
      .sort(
        (a, b) => b.totalTokens - a.totalTokens || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      );
  });

  const totalInputTokens = computed(() =>
    modelEntries.value.reduce((sum, m) => sum + m.inputTokens, 0),
  );
  const totalOutputTokens = computed(() =>
    modelEntries.value.reduce((sum, m) => sum + m.outputTokens, 0),
  );
  const totalTokens = computed(() => totalInputTokens.value + totalOutputTokens.value);
  const totalCacheReadTokens = computed(() =>
    modelEntries.value.reduce((sum, m) => sum + m.cacheReadTokens, 0),
  );
  const totalRequests = computed(() =>
    modelEntries.value.reduce((sum, m) => sum + (m.requests ?? 0), 0),
  );

  const hasReasoningData = computed(() =>
    modelEntries.value.some((m) => m.reasoningTokens != null),
  );

  const hasTokenBudget = computed(
    () => metrics.value?.currentTokens != null || metrics.value?.systemTokens != null,
  );

  const copilotCost = computed(() => {
    const premiumReqs = metrics.value?.totalPremiumRequests ?? 0;
    return premiumReqs * prefs.costPerPremiumRequest;
  });

  const totalWholesaleCost = computed<number | null>(() => {
    if (modelEntries.value.length === 0) return null;
    let total = 0;
    for (const m of modelEntries.value) {
      if (m.directApiCost == null) return null;
      total += m.directApiCost;
    }
    return total;
  });

  const aiCreditUsage = computed(() =>
    shutdownAiCreditUsage(metrics.value, prefs, creditsObservedOnly.value),
  );

  const cacheHitRatio = computed(() =>
    totalInputTokens.value > 0 ? totalCacheReadTokens.value / totalInputTokens.value : 0,
  );

  return {
    tokenBreakdown: computed(() => shutdownTokenBreakdown(metrics.value)),
    modelEntries,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalCacheReadTokens,
    totalRequests,
    hasReasoningData,
    hasTokenBudget,
    copilotCost,
    totalWholesaleCost,
    aiCreditUsage,
    cacheHitRatio,
  };
}
