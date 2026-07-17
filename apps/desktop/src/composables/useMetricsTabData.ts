import {
  type AiCreditSource,
  resolveAiCreditUsage,
  type ShutdownMetrics,
  sumTokenCosts,
} from "@tracepilot/types";
import { type ComputedRef, computed } from "vue";
import type { usePreferencesStore } from "@/stores/preferences";

type PreferencesStore = ReturnType<typeof usePreferencesStore>;

export interface MetricsModelEntry {
  [key: string]: unknown;
  name: string;
  requests: number;
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
}

export function useMetricsTabData(
  metrics: ComputedRef<ShutdownMetrics | null | undefined>,
  prefs: PreferencesStore,
) {
  const modelEntries = computed<MetricsModelEntry[]>(() => {
    if (!metrics.value?.modelMetrics) return [];
    return Object.entries(metrics.value.modelMetrics)
      .map(([name, data]) => {
        const inputTokens = data.usage?.inputTokens ?? 0;
        const outputTokens = data.usage?.outputTokens ?? 0;
        const cacheReadTokens = data.usage?.cacheReadTokens ?? 0;
        const cacheWriteTokens = data.usage?.cacheWriteTokens ?? 0;
        const reasoningTokens = data.usage?.reasoningTokens ?? null;
        const hasTokenUsage = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens > 0;
        const usageBased = prefs.computeUsageBasedCostBreakdown(
          name,
          inputTokens,
          cacheReadTokens,
          outputTokens,
          cacheWriteTokens,
        );
        const premiumRequests = data.requests?.cost ?? 0;
        const wholesale = prefs.computeWholesaleCostBreakdown(
          name,
          inputTokens,
          cacheReadTokens,
          outputTokens,
          cacheWriteTokens,
        );
        const aiCreditUsage = resolveAiCreditUsage(
          data.totalNanoAiu,
          hasTokenUsage ? usageBased : null,
          hasTokenUsage ? wholesale : null,
        );
        return {
          name,
          requests: data.requests?.count ?? 0,
          aiCredits: aiCreditUsage.credits,
          aiCreditUsd: aiCreditUsage.usdEquivalent,
          aiCreditSource: aiCreditUsage.source,
          directApiCost: wholesale.totalCost,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          reasoningTokens,
          totalTokens: inputTokens + outputTokens,
          legacyPremiumRequests: premiumRequests,
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens);
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
  const totalRequests = computed(() => modelEntries.value.reduce((sum, m) => sum + m.requests, 0));

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

  const totalWholesaleCost = computed(() => {
    let total = 0;
    for (const m of modelEntries.value) {
      if (m.directApiCost !== null) total += m.directApiCost;
    }
    return total;
  });

  const aiCreditUsage = computed(() => {
    const hasTokenUsage = modelEntries.value.some(
      (model) =>
        model.inputTokens + model.outputTokens + model.cacheReadTokens + model.cacheWriteTokens > 0,
    );
    const usageEstimate = sumTokenCosts(
      modelEntries.value.map((m) =>
        prefs.computeUsageBasedCostBreakdown(
          m.name,
          m.inputTokens,
          m.cacheReadTokens,
          m.outputTokens,
          m.cacheWriteTokens,
        ),
      ),
    );
    const directEstimate = sumTokenCosts(
      modelEntries.value.map((m) =>
        prefs.computeWholesaleCostBreakdown(
          m.name,
          m.inputTokens,
          m.cacheReadTokens,
          m.outputTokens,
          m.cacheWriteTokens,
        ),
      ),
    );
    return resolveAiCreditUsage(
      metrics.value?.totalNanoAiu,
      hasTokenUsage ? usageEstimate : null,
      hasTokenUsage ? directEstimate : null,
    );
  });

  const cacheHitRatio = computed(() =>
    totalInputTokens.value > 0 ? totalCacheReadTokens.value / totalInputTokens.value : 0,
  );

  return {
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
