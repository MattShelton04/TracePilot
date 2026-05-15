import { computed, type InjectionKey, inject, reactive, ref, watch } from "vue";
import { useAnalyticsPage } from "@/composables/useAnalyticsPage";
import { usePreferencesStore } from "@/stores/preferences";
import { MODEL_PALETTE } from "@/utils/chartColors";
import {
  radarAxisEnd,
  radarLabelPos,
  radarPoint,
  radarPolygon,
  scatterRadius,
  scatterX,
  scatterY,
} from "@/utils/modelChartGeometry";
import {
  bestCostIndex,
  bestIdx,
  buildCompareMetrics,
  buildModelRows,
  computeRadarValues,
  computeScatterScale,
  formatNorm,
  normalizeRows,
} from "./modelComparison/metrics";
import { sortArrow as sortArrowHelper, sortRows } from "./modelComparison/sorting";
import type { CompareMetric, CostMode, ModelRow, NormMode, SortKey } from "./modelComparison/types";

export {
  RADAR_AXES,
  RADAR_CX,
  RADAR_CY,
  RADAR_R,
  SCATTER_H,
  SCATTER_PAD,
  SCATTER_W,
} from "@/utils/modelChartGeometry";
// Re-exported so consumers of `useModelComparison` keep a single import surface.
export {
  bestCostIndex,
  bestIdx,
  buildCompareMetrics,
  buildModelRows,
  computeRadarValues,
  computeScatterScale,
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
    return `Performance and cost metrics across all models${repoSuffix}`;
  });

  const modelRows = computed<ModelRow[]>(() => {
    if (!data.value?.modelDistribution) return [];
    return buildModelRows({
      distribution: data.value.modelDistribution,
      computeWholesaleCost: prefs.computeWholesaleCost,
      costPerPremiumRequest: prefs.costPerPremiumRequest,
      palette: MODEL_COLORS,
    });
  });

  const totalTokens = computed(() => modelRows.value.reduce((sum, m) => sum + m.tokens, 0));
  const totalCost = computed(() => modelRows.value.reduce((sum, m) => sum + (m.cost ?? 0), 0));
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

  const radarModels = computed(() =>
    [...modelRows.value].sort((a, b) => b.tokens - a.tokens).slice(0, 3),
  );
  const radarValues = (row: ModelRow) => computeRadarValues(row, modelRows.value);

  const scatterScale = computed(() => computeScatterScale(modelRows.value));
  const scatterXBound = (tokens: number) => scatterX(tokens, scatterScale.value.maxT);
  const scatterYBound = (cost: number) => scatterY(cost, scatterScale.value.maxC);

  const compareA = ref<string>("");
  const compareB = ref<string>("");

  watch(
    modelRows,
    (rows) => {
      if (rows.length >= 2) {
        if (!compareA.value || !rows.find((r) => r.model === compareA.value))
          compareA.value = rows[0].model;
        if (!compareB.value || !rows.find((r) => r.model === compareB.value))
          compareB.value = rows[1].model;
      } else if (rows.length === 1) {
        compareA.value = rows[0].model;
        compareB.value = "";
      }
    },
    { immediate: true },
  );

  const compareRowA = computed(() => displayRows.value.find((r) => r.model === compareA.value));
  const compareRowB = computed(() => displayRows.value.find((r) => r.model === compareB.value));
  const compareMetrics = computed<CompareMetric[]>(() =>
    buildCompareMetrics(compareRowA.value, compareRowB.value, fmtNorm),
  );

  return reactive({
    store,
    loading,
    data,
    pageSubtitle,
    modelRows,
    totalTokens,
    totalCost,
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
    radarModels,
    radarValues,
    radarPoint,
    radarPolygon,
    radarAxisEnd,
    radarLabelPos,
    scatterScale,
    scatterX: scatterXBound,
    scatterY: scatterYBound,
    scatterRadius,
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
