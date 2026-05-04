import type { ShutdownMetrics } from "@tracepilot/types";
import { type ComputedRef, computed } from "vue";
import type { usePreferencesStore } from "@/stores/preferences";

type PreferencesStore = ReturnType<typeof usePreferencesStore>;

export interface MetricsModelEntry {
  [key: string]: unknown;
  name: string;
  requests: number;
  copilotCost: number;
  usageBasedCost: number | null;
  usageBasedStatus: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number | null;
  totalTokens: number;
  wholesaleCost: number | null;
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
        const wholesaleCost = prefs.computeWholesaleCost(
          name,
          inputTokens,
          cacheReadTokens,
          outputTokens,
          cacheWriteTokens,
        );
        const usageBased = prefs.computeUsageBasedCostBreakdown(
          name,
          inputTokens,
          cacheReadTokens,
          outputTokens,
          cacheWriteTokens,
        );
        const premiumRequests = data.requests?.cost ?? 0;
        return {
          name,
          requests: data.requests?.count ?? 0,
          copilotCost: premiumRequests * prefs.costPerPremiumRequest,
          usageBasedCost: usageBased.totalCost,
          usageBasedStatus: usageBased.status,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          reasoningTokens,
          totalTokens: inputTokens + outputTokens,
          wholesaleCost,
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
      if (m.wholesaleCost !== null) total += m.wholesaleCost;
    }
    return total;
  });

  const totalUsageBasedCost = computed(() => {
    let total = 0;
    for (const m of modelEntries.value) {
      if (m.usageBasedCost !== null) total += m.usageBasedCost;
    }
    return total;
  });

  const hasUsageBasedUnknowns = computed(() =>
    modelEntries.value.some((m) => m.usageBasedCost === null || m.usageBasedStatus !== "priced"),
  );

  const june2026PreviewDelta = computed(() => totalUsageBasedCost.value - copilotCost.value);

  const observedAiuCost = computed(() => prefs.getObservedAiuCost(metrics.value?.totalNanoAiu));

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
    totalUsageBasedCost,
    hasUsageBasedUnknowns,
    june2026PreviewDelta,
    observedAiuCost,
    cacheHitRatio,
  };
}
