import { formatCost, formatNumber, formatPercent } from "@tracepilot/ui";
import { computed, type InjectionKey, inject, reactive, ref, watch } from "vue";
import { useAnalyticsPage } from "@/composables/useAnalyticsPage";
import { usePreferencesStore } from "@/stores/preferences";
import { MODEL_PALETTE } from "@/utils/chartColors";
import { formatModelDelta } from "@/utils/deltaFormatting";
import {
  radarAxisEnd,
  radarLabelPos,
  radarPoint,
  radarPolygon,
  scatterRadius,
  scatterX,
  scatterY,
} from "@/utils/modelChartGeometry";

export {
  RADAR_AXES,
  RADAR_CX,
  RADAR_CY,
  RADAR_R,
  SCATTER_H,
  SCATTER_PAD,
  SCATTER_W,
} from "@/utils/modelChartGeometry";

/**
 * State + derivations for `ModelComparisonView`.
 *
 * Extracted from `views/ModelComparisonView.vue` in Wave 33. Behaviour is
 * preserved byte-for-byte; the shell provides a single instance of this
 * composable which the children consume via `provide`/`inject`
 * (`ModelComparisonKey` + `useModelComparisonContext`).
 */

export const MODEL_COLORS = MODEL_PALETTE;

export type CostMode = "wholesale" | "copilot" | "both";
export type NormMode = "raw" | "per-10m-tokens" | "share";

export type SortKey =
  | "model"
  | "tokens"
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "percentage"
  | "premiumRequests"
  | "cacheHitRate"
  | "cost"
  | "copilotCost";

export interface ModelRow {
  model: string;
  color: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  percentage: number;
  premiumRequests: number;
  cacheHitRate: number;
  cost: number | null;
  copilotCost: number;
}

export interface CompareMetric {
  label: string;
  valueA: string;
  valueB: string;
  delta: string;
  direction: "up" | "down" | "neutral";
  better: "a" | "b" | "neutral";
}

function bestIdx(arr: number[], higher = true): number {
  if (!arr.length) return -1;
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (higher ? arr[i] > arr[best] : arr[i] < arr[best]) best = i;
  }
  return best;
}

function buildCompareMetrics(
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
      label: "Premium Requests",
      valueA: fmtNorm(a.premiumRequests),
      valueB: fmtNorm(b.premiumRequests),
      ...formatModelDelta(a.premiumRequests, b.premiumRequests, true),
    },
    {
      label: "Cache Hit Rate",
      valueA: formatPercent(a.cacheHitRate),
      valueB: formatPercent(b.cacheHitRate),
      ...formatModelDelta(a.cacheHitRate, b.cacheHitRate, true),
    },
    {
      label: "Wholesale Cost",
      valueA: fmtNorm(a.cost, true),
      valueB: fmtNorm(b.cost, true),
      ...formatModelDelta(a.cost ?? 0, b.cost ?? 0, false),
    },
    {
      label: "Copilot Cost",
      valueA: fmtNorm(a.copilotCost, true),
      valueB: fmtNorm(b.copilotCost, true),
      ...formatModelDelta(a.copilotCost, b.copilotCost, false),
    },
  ];
}

export function useModelComparison() {
  const prefs = usePreferencesStore();
  const { store } = useAnalyticsPage("fetchAnalytics");

  const loading = computed(() => store.analyticsLoading);
  const data = computed(() => store.analytics);

  const pageSubtitle = computed(() => {
    const repoSuffix = store.selectedRepo ? ` in ${store.selectedRepo}` : "";
    return `Performance and cost metrics across all models${repoSuffix}`;
  });

  // ── Enriched model data ──────────────────────────────────────
  const modelRows = computed<ModelRow[]>(() => {
    if (!data.value?.modelDistribution) return [];
    const dist = data.value.modelDistribution;
    // Correct total: inputTokens + outputTokens (inputTokens already includes cacheReadTokens)
    const grandTotal = dist.reduce((sum, m) => sum + m.inputTokens + m.outputTokens, 0);
    return dist.map((m, i) => {
      const tokens = m.inputTokens + m.outputTokens;
      const percentage = grandTotal > 0 ? (tokens / grandTotal) * 100 : 0;
      const premiumRequests = m.premiumRequests;
      const cacheHitRate = m.inputTokens > 0 ? (m.cacheReadTokens / m.inputTokens) * 100 : 0;
      const cost = prefs.computeWholesaleCost(
        m.model,
        m.inputTokens,
        m.cacheReadTokens,
        m.outputTokens,
      );
      const copilotCost = premiumRequests * prefs.costPerPremiumRequest;
      return {
        model: m.model,
        color: MODEL_COLORS[i % MODEL_COLORS.length],
        tokens,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens,
        percentage,
        premiumRequests,
        cacheHitRate,
        cost,
        copilotCost,
      };
    });
  });

  const totalTokens = computed(() => modelRows.value.reduce((sum, m) => sum + m.tokens, 0));
  const totalCost = computed(() => modelRows.value.reduce((sum, m) => sum + (m.cost ?? 0), 0));
  const totalCopilotCost = computed(() =>
    modelRows.value.reduce((sum, m) => sum + m.copilotCost, 0),
  );
  const modelCount = computed(() => modelRows.value.length);

  // ── Cost & normalization toggles ─────────────────────────────
  const costMode = ref<CostMode>("both");
  const normMode = ref<NormMode>("raw");

  // ── Best/worst highlighting ──────────────────────────────────
  const bestCacheIdx = computed(() => bestIdx(modelRows.value.map((m) => m.cacheHitRate)));
  const bestCostIdx = computed(() => {
    const costs = modelRows.value.map((m) => m.cost ?? Infinity);
    if (costs.every((c) => c === Infinity)) return -1;
    return bestIdx(costs, false);
  });
  const bestCopilotCostIdx = computed(() =>
    bestIdx(
      modelRows.value.map((m) => m.copilotCost),
      false,
    ),
  );

  // ── Sort state ───────────────────────────────────────────────
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

  const sortedRows = computed(() => {
    const rows = [...modelRows.value];
    const dir = sortDir.value === "asc" ? 1 : -1;
    const key = sortKey.value;
    return rows.sort((a, b) => {
      if (key === "model") return dir * a.model.localeCompare(b.model);
      if (key === "cost") {
        const ac = a.cost ?? Infinity;
        const bc = b.cost ?? Infinity;
        if (ac === Infinity && bc === Infinity) return 0;
        if (ac === Infinity) return 1;
        if (bc === Infinity) return -1;
        return dir * (ac - bc);
      }
      return dir * ((a[key] as number) - (b[key] as number));
    });
  });

  function sortArrow(key: SortKey): string {
    if (sortKey.value !== key) return "⇅";
    return sortDir.value === "asc" ? "↑" : "↓";
  }

  // ── Normalized display rows ──────────────────────────────────
  const displayRows = computed<ModelRow[]>(() => {
    const rows = sortedRows.value;
    if (normMode.value === "raw") return rows;

    if (normMode.value === "per-10m-tokens") {
      return rows.map((r) => {
        const divisor = r.tokens / 10_000_000 || 1;
        return {
          ...r,
          tokens: r.tokens / divisor,
          inputTokens: r.inputTokens / divisor,
          outputTokens: r.outputTokens / divisor,
          cacheReadTokens: r.cacheReadTokens / divisor,
          premiumRequests: r.premiumRequests / divisor,
          cost: r.cost != null ? r.cost / divisor : null,
          copilotCost: r.copilotCost / divisor,
        };
      });
    }

    // share mode
    const sums = rows.reduce(
      (acc, r) => ({
        tokens: acc.tokens + r.tokens,
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
        premiumRequests: acc.premiumRequests + r.premiumRequests,
        cost: acc.cost + (r.cost ?? 0),
        copilotCost: acc.copilotCost + r.copilotCost,
      }),
      {
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        premiumRequests: 0,
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
      cost: sums.cost > 0 ? ((r.cost ?? 0) / sums.cost) * 100 : 0,
      copilotCost: sums.copilotCost > 0 ? (r.copilotCost / sums.copilotCost) * 100 : 0,
    }));
  });

  function fmtNorm(value: number | null, isCost = false): string {
    if (value == null) return "—";
    if (normMode.value === "share") return `${value.toFixed(1)}%`;
    if (isCost) {
      // Compact cost format for large values
      if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
      return formatCost(value);
    }
    if (normMode.value === "per-10m-tokens") {
      if (Math.abs(value) >= 1_000) return formatNumber(value);
      return value % 1 === 0 ? value.toString() : value.toFixed(1);
    }
    return formatNumber(value);
  }

  // ── Radar chart (top 3 by tokens) ────────────────────────────
  const radarModels = computed(() => {
    return [...modelRows.value].sort((a, b) => b.tokens - a.tokens).slice(0, 3);
  });

  function radarValues(row: ModelRow): number[] {
    const maxTokens = Math.max(...modelRows.value.map((m) => m.tokens), 1);
    const tokenVol = row.tokens / maxTokens;
    const cacheEff = row.cacheHitRate / 100;
    const maxPR = Math.max(...modelRows.value.map((m) => m.premiumRequests), 1);
    const prShare = row.premiumRequests / maxPR;
    const costPerToken = row.cost != null && row.tokens > 0 ? row.cost / row.tokens : 0;
    const maxCostPerToken = Math.max(
      ...modelRows.value.map((m) => (m.cost ?? 0) / Math.max(m.tokens, 1)),
      0.0001,
    );
    const costEff = 1 - Math.min(costPerToken / maxCostPerToken, 1);
    const share = row.percentage / 100;
    return [tokenVol, cacheEff, prShare, costEff, share];
  }

  // ── Scatter plot ─────────────────────────────────────────────
  const scatterScale = computed(() => {
    const maxT = Math.max(...modelRows.value.map((m) => m.tokens), 1);
    const maxC = Math.max(...modelRows.value.map((m) => m.cost ?? 0), 0.01);
    return { maxT, maxC };
  });

  const scatterXBound = (tokens: number) => scatterX(tokens, scatterScale.value.maxT);
  const scatterYBound = (cost: number) => scatterY(cost, scatterScale.value.maxC);

  // ── Side-by-side comparison ──────────────────────────────────
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
    // state / store proxies
    store,
    loading,
    data,
    pageSubtitle,
    // rows + totals
    modelRows,
    totalTokens,
    totalCost,
    totalCopilotCost,
    modelCount,
    // toggles
    costMode,
    normMode,
    // best
    bestCacheIdx,
    bestCostIdx,
    bestCopilotCostIdx,
    // sort
    sortKey,
    sortDir,
    toggleSort,
    sortArrow,
    // display
    displayRows,
    fmtNorm,
    // radar
    radarModels,
    radarValues,
    radarPoint,
    radarPolygon,
    radarAxisEnd,
    radarLabelPos,
    // scatter
    scatterScale,
    scatterX: scatterXBound,
    scatterY: scatterYBound,
    scatterRadius,
    // compare
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
