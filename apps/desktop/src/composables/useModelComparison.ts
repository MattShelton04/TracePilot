import { computed, type InjectionKey, inject, reactive, ref, watch } from "vue";
import { useAnalyticsPage } from "@/composables/useAnalyticsPage";
import { usePreferencesStore } from "@/stores/preferences";
import { analyticsTotalCostUsd } from "@/utils/analyticsCostSeries";
import { MODEL_PALETTE, MODEL_TAIL_COLOR } from "@/utils/chartColors";
import {
  bestCostIndex,
  bestIdx,
  buildCompareMetrics,
  buildModelRows,
  crossSourcePair,
  formatNorm,
  normalizeRows,
} from "./modelComparison/metrics";
import { sortArrow as sortArrowHelper, sortRows } from "./modelComparison/sorting";
import type { CompareMetric, CostMode, ModelRow, NormMode, SortKey } from "./modelComparison/types";

// Re-exported so consumers of `useModelComparison` keep a single import surface.
export {
  bestCostIndex,
  bestIdx,
  buildCompareMetrics,
  buildModelRows,
  formatNorm,
  normalizeRows,
} from "./modelComparison/metrics";
export { buildRowComparator, sortRows } from "./modelComparison/sorting";
export type { CompareMetric, CostMode, ModelRow, NormMode, SortKey };

/**
 * State + derivations for `ModelComparisonView`. The pure helpers now
 * live under `./modelComparison/`; this file owns only the reactive
 * glue (refs, computeds, watchers).
 */
export const MODEL_COLORS = MODEL_PALETTE;
export function useModelComparison() {
  const prefs = usePreferencesStore();
  const { store } = useAnalyticsPage("fetchAnalytics");

  const loading = computed(() => store.analyticsLoading);
  const data = computed(() => store.analytics);

  const pageSubtitle = computed(() => {
    const repoSuffix = store.selectedRepo ? ` in ${store.selectedRepo}` : "";
    return `Performance and cost metrics across all ${store.sourcePrefix}models${repoSuffix}`;
  });

  const modelRows = computed<ModelRow[]>(() => {
    if (!data.value?.modelDistribution) return [];
    return buildModelRows({
      distribution: data.value.modelDistribution,
      computeWholesaleCost: prefs.computeWholesaleCost,
      computeUsageBasedCost: prefs.computeUsageBasedCost,
      costPerPremiumRequest: prefs.costPerPremiumRequest,
      palette: MODEL_COLORS,
      tailColor: MODEL_TAIL_COLOR,
    });
  });

  /** Most common prompt-cache TTL (seconds) Copilot CLI reported per model. */
  const cacheTtlByModel = computed(
    () =>
      new Map(
        (prefs.isFeatureEnabled("promptCacheInsights")
          ? (data.value?.promptCache?.observedTtls ?? [])
          : []
        ).map((entry) => [entry.model, entry.ttlSeconds]),
      ),
  );
  const showCacheTtl = computed(() => cacheTtlByModel.value.size > 0);

  const totalTokens = computed(() => modelRows.value.reduce((sum, m) => sum + m.tokens, 0));
  const totalCost = computed(() => modelRows.value.reduce((sum, m) => sum + (m.cost ?? 0), 0));
  // Null when no model is priced in AI Credits (e.g. only Claude Code models).
  const totalAiCredits = computed(() =>
    modelRows.value.some((model) => model.aiCredits != null)
      ? modelRows.value.reduce((sum, model) => sum + (model.aiCredits ?? 0), 0)
      : null,
  );
  // Models priced in USD rather than AI Credits, and their total when they
  // all come from one source.
  const usdRows = computed(() => modelRows.value.filter((model) => !model.billedInAiCredits));
  const usdSource = computed(() => {
    const sources = new Set(usdRows.value.map((model) => model.source));
    return sources.size === 1 ? [...sources][0] : null;
  });
  const totalCostUsd = computed(() =>
    usdSource.value && usdRows.value.some((model) => model.costUsd != null)
      ? usdRows.value.reduce((sum, model) => sum + (model.costUsd ?? 0), 0)
      : null,
  );
  // AI Credit and USD models side by side: costs show in USD, AI Credits at
  // $0.01 each, so every source reads on one scale.
  const mixedUnits = computed(
    () => usdRows.value.length > 0 && usdRows.value.length < modelRows.value.length,
  );
  // The Analytics dashboard's total, from the same per-source figures, so the
  // two pages agree to the cent. Payloads without a per-source split add rows.
  const totalUsd = computed(() => {
    if (data.value?.costBySource?.length) {
      return analyticsTotalCostUsd(
        data.value,
        prefs.computeUsageBasedCost,
        prefs.computeWholesaleCost,
      ).usd;
    }
    return modelRows.value.some((model) => model.usdEquivalent != null)
      ? modelRows.value.reduce((sum, model) => sum + (model.usdEquivalent ?? 0), 0)
      : null;
  });
  const totalCopilotCost = computed(() =>
    modelRows.value.reduce((sum, m) => sum + m.copilotCost, 0),
  );
  const modelCount = computed(() => modelRows.value.length);

  const costMode = ref<CostMode>("both");
  const normMode = ref<NormMode>("raw");

  const bestCacheIdx = computed(() => bestIdx(modelRows.value.map((m) => m.cacheHitRate)));
  const bestCostIdx = computed(() => bestCostIndex(modelRows.value));
  const bestCopilotCostIdx = computed(() =>
    bestIdx(
      modelRows.value.map((m) => m.copilotCost),
      false,
    ),
  );

  const sortKey = ref<SortKey>("tokens");
  const sortDir = ref<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
    } else {
      sortKey.value = key;
      sortDir.value = key === "model" ? "asc" : "desc";
    }
  }

  const sortedRows = computed(() => sortRows(modelRows.value, sortKey.value, sortDir.value));
  const sortArrow = (key: SortKey) => sortArrowHelper(sortKey.value, sortDir.value, key);

  const displayRows = computed<ModelRow[]>(() => normalizeRows(sortedRows.value, normMode.value));
  const fmtNorm = (value: number | null, isCost = false) =>
    formatNorm(value, isCost, normMode.value);

  const compareA = ref<string>("");
  const compareB = ref<string>("");

  watch(
    modelRows,
    (rows) => {
      if (rows.length >= 2) {
        const valid = (id: string) => id && rows.some((r) => r.id === id);
        // Open on the same model across sources when one was used by both.
        const pair =
          !valid(compareA.value) && !valid(compareB.value) ? crossSourcePair(rows) : null;
        if (pair) [compareA.value, compareB.value] = pair;
        if (!valid(compareA.value)) compareA.value = rows[0].id;
        if (!valid(compareB.value)) compareB.value = rows[1].id;
      } else if (rows.length === 1) {
        compareA.value = rows[0].id;
        compareB.value = "";
      }
    },
    { immediate: true },
  );

  const compareRowA = computed(() => displayRows.value.find((r) => r.id === compareA.value));
  const compareRowB = computed(() => displayRows.value.find((r) => r.id === compareB.value));
  const compareMetrics = computed<CompareMetric[]>(() =>
    buildCompareMetrics(compareRowA.value, compareRowB.value, fmtNorm),
  );

  return reactive({
    store,
    loading,
    data,
    pageSubtitle,
    modelRows,
    cacheTtlByModel,
    showCacheTtl,
    totalTokens,
    totalCost,
    totalAiCredits,
    usdRows,
    usdSource,
    totalCostUsd,
    mixedUnits,
    totalUsd,
    totalCopilotCost,
    modelCount,
    costMode,
    normMode,
    bestCacheIdx,
    bestCostIdx,
    bestCopilotCostIdx,
    sortKey,
    sortDir,
    toggleSort,
    sortArrow,
    displayRows,
    fmtNorm,
    compareA,
    compareB,
    compareRowA,
    compareRowB,
    compareMetrics,
  });
}

export type ModelComparisonContext = ReturnType<typeof useModelComparison>;

export const ModelComparisonKey: InjectionKey<ModelComparisonContext> =
  Symbol("ModelComparisonContext");

export function useModelComparisonContext(): ModelComparisonContext {
  const ctx = inject(ModelComparisonKey);
  if (!ctx) {
    throw new Error("useModelComparisonContext must be used within a ModelComparisonView shell");
  }
  return ctx;
}
