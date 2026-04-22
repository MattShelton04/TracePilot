import type { ConversationTurn, ShutdownMetrics } from "@tracepilot/types";
import { type ComputedRef, computed } from "vue";
import type { usePreferencesStore } from "@/stores/preferences";

type PreferencesStore = ReturnType<typeof usePreferencesStore>;

function charsToTokens(chars: number): number {
  return Math.round(chars / 4);
}

export interface ModelEntry {
  name: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  cost: number;
}

export function useTokenFlowData(
  metrics: ComputedRef<ShutdownMetrics | null | undefined>,
  turns: ComputedRef<ConversationTurn[]>,
  prefs: PreferencesStore,
) {
  const modelEntries = computed<ModelEntry[]>(() => {
    if (!metrics.value?.modelMetrics) return [];
    return Object.entries(metrics.value.modelMetrics)
      .map(([name, data]) => ({
        name,
        inputTokens: data.usage?.inputTokens ?? 0,
        outputTokens: data.usage?.outputTokens ?? 0,
        cacheReadTokens: data.usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: data.usage?.cacheWriteTokens ?? 0,
        requests: data.requests?.count ?? 0,
        cost: data.requests?.cost ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const hasTurns = computed(() => turns.value.length > 0);

  const totalInputTokens = computed(() =>
    modelEntries.value.reduce((s, m) => s + m.inputTokens, 0),
  );
  const totalOutputTokens = computed(() =>
    modelEntries.value.reduce((s, m) => s + m.outputTokens, 0),
  );
  const totalTokens = computed(() => totalInputTokens.value + totalOutputTokens.value);
  const totalCacheRead = computed(() =>
    modelEntries.value.reduce((s, m) => s + m.cacheReadTokens, 0),
  );
  const totalCacheWrite = computed(() =>
    modelEntries.value.reduce((s, m) => s + m.cacheWriteTokens, 0),
  );
  const modelsUsed = computed(() => modelEntries.value.length);

  const wholesaleCost = computed(() =>
    modelEntries.value.reduce((s, m) => {
      const cost = prefs.computeWholesaleCost(
        m.name,
        m.inputTokens,
        m.cacheReadTokens,
        m.outputTokens,
      );
      return s + (cost ?? 0);
    }, 0),
  );
  const copilotCost = computed(() => {
    const premiumReqs = metrics.value?.totalPremiumRequests ?? 0;
    return premiumReqs * prefs.costPerPremiumRequest;
  });
  const cacheHitRate = computed(() => {
    const denom = totalInputTokens.value;
    return denom > 0 ? (totalCacheRead.value / denom) * 100 : 0;
  });

  const estimatedUserInput = computed(() =>
    turns.value.reduce((s, t) => s + charsToTokens((t.userMessage ?? "").length), 0),
  );
  const estimatedToolResults = computed(() =>
    turns.value.reduce(
      (s, t) =>
        s + t.toolCalls.reduce((ts, tc) => ts + charsToTokens((tc.resultContent ?? "").length), 0),
      0,
    ),
  );
  const estimatedSystemContext = computed(() => {
    const remainder =
      totalInputTokens.value - estimatedUserInput.value - estimatedToolResults.value;
    return Math.max(0, remainder);
  });

  const estimatedAssistantText = computed(() =>
    turns.value.reduce((s, t) => s + charsToTokens(t.assistantMessages.join("").length), 0),
  );
  const estimatedReasoning = computed(() =>
    turns.value.reduce((s, t) => s + charsToTokens((t.reasoningTexts ?? []).join("").length), 0),
  );
  const estimatedToolCalls = computed(() => {
    const remainder =
      totalOutputTokens.value - estimatedAssistantText.value - estimatedReasoning.value;
    return Math.max(0, remainder);
  });

  return {
    modelEntries,
    hasTurns,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalCacheRead,
    totalCacheWrite,
    modelsUsed,
    wholesaleCost,
    copilotCost,
    cacheHitRate,
    estimatedUserInput,
    estimatedToolResults,
    estimatedSystemContext,
    estimatedAssistantText,
    estimatedReasoning,
    estimatedToolCalls,
  };
}
