<script setup lang="ts">
import {
  AI_CREDIT_USD,
  type AnalyticsData,
  sourceCapabilities,
  sourceLabel,
} from "@tracepilot/types";
import type { ChartLayout, ChartTooltipState } from "@tracepilot/ui";
import {
  formatAiCredits,
  formatCost,
  formatDateMedium,
  formatNumber,
  formatNumberFull,
  SectionPanel,
  useChartTooltip,
} from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import LineAreaChart from "@/components/charts/LineAreaChart.vue";
import { useLineAreaChartData } from "@/composables/useLineAreaChartData";
import { usePreferencesStore } from "@/stores/preferences";
import { buildAnalyticsCostSeries, buildCombinedCostSeries } from "@/utils/analyticsCostSeries";
import { CHART_COLORS, DONUT_PALETTE } from "@/utils/chartColors";
import { modelLabels } from "@/utils/modelLabels";

const props = defineProps<{
  data: AnalyticsData;
  chartLayout: ChartLayout;
  gridLines: number[];
  timeRangeLabel: string;
  tooltip: ChartTooltipState;
  onChartMouseMove: ReturnType<typeof useChartTooltip>["onChartMouseMove"];
  onChartClick: ReturnType<typeof useChartTooltip>["onChartClick"];
  dismissTooltip: ReturnType<typeof useChartTooltip>["dismissTooltip"];
  /** False when the filtered source is not billed in AI Credits (Claude Code). */
  billedInAic?: boolean;
}>();

const prefs = usePreferencesStore();

const DONUT_COLORS = DONUT_PALETTE;
const DONUT_R = 56;
const DONUT_C = 2 * Math.PI * DONUT_R;

// Named as on the Models page: one name per model, with the source added
// only when the same model appears under two sources.
const legendItems = computed(() => {
  const labels = modelLabels(props.data.modelDistribution);
  return props.data.modelDistribution.map((m, i) => {
    const { label } = labels[i];
    // The hover names the source and the raw id when the legend truncates.
    return { ...m, label, title: label === m.model ? m.model : `${label} (${m.model})` };
  });
});

const donutSegments = computed(() => {
  let offset = 0;
  return legendItems.value.map((m, i) => {
    const dash = (m.percentage / 100) * DONUT_C;
    const seg = {
      dash,
      gap: DONUT_C - dash,
      offset: -offset,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      model: m.label,
      pct: m.percentage,
      tokens: m.inputTokens + m.outputTokens,
    };
    offset += dash;
    return seg;
  });
});

const hoveredDonut = ref<number | null>(null);

const activeDonutSegment = computed(() =>
  hoveredDonut.value !== null && hoveredDonut.value < donutSegments.value.length
    ? donutSegments.value[hoveredDonut.value]
    : null,
);

watch(donutSegments, () => {
  hoveredDonut.value = null;
});

// ── Cost basis toggle ─────────────────────────────────────────────
// `combined` is the default when some runs are priced in USD: every source
// on one USD axis, AI Credits at $0.01 each. The other bases keep one
// source's own series: Copilot's AI Credits or legacy premium requests, or
// the USD estimates of sources not billed in AI Credits.
type CostBasis = "combined" | "aiCredits" | "legacy" | "usd";

const selectedBasis = ref<CostBasis>("combined");
const hasUsdCost = computed(() => (props.data.costUsdByDay?.length ?? 0) > 0);
const costBasis = computed<CostBasis>(() => {
  if (props.billedInAic === false) return "usd";
  const usdBasis = selectedBasis.value === "combined" || selectedBasis.value === "usd";
  return usdBasis && !hasUsdCost.value ? "aiCredits" : selectedBasis.value;
});

const isAiCredits = computed(() => costBasis.value === "aiCredits");

/**
 * Names of the sources on one side of the combined series, or null when no
 * such source has sessions. Payloads from older builds list no sources.
 */
function sourceNames(billed: boolean): string | null {
  const entries = props.data.costBySource;
  if (!entries) return billed ? "AI Credits" : "Estimated USD";
  const names = entries
    .filter((entry) => sourceCapabilities(entry.source).hasAic === billed)
    .map((entry) => sourceLabel(entry.source));
  return names.length ? names.join(", ") : null;
}
const aicSourceName = computed(() => sourceNames(true));
const usdSourceName = computed(() => sourceNames(false) ?? "Estimated USD");

const costColor = computed(() => (isAiCredits.value ? CHART_COLORS.success : CHART_COLORS.primary));
const costColorLight = computed(() =>
  isAiCredits.value ? CHART_COLORS.successLight : CHART_COLORS.primaryLight,
);

interface CostChartPoint {
  date: string;
  cost: number;
  aiCredits: number | null;
  parts: { aiCreditsUsd: number; sourceUsd: number } | null;
}

const costPoints = computed<CostChartPoint[]>(() => {
  if (costBasis.value === "combined") {
    return buildCombinedCostSeries(
      props.data,
      prefs.computeWholesaleCost,
      prefs.computeUsageBasedCost,
    ).map(({ date, cost, aiCreditsUsd, sourceUsd }) => ({
      date,
      cost,
      aiCredits: null,
      parts: { aiCreditsUsd, sourceUsd },
    }));
  }
  const points = buildAnalyticsCostSeries(
    props.data,
    costBasis.value,
    prefs.costPerPremiumRequest,
    prefs.computeWholesaleCost,
    prefs.computeUsageBasedCost,
  );
  return points.map((point) => ({
    date: point.date,
    aiCredits: isAiCredits.value ? point.cost : null,
    cost: isAiCredits.value ? point.cost * AI_CREDIT_USD : point.cost,
    parts: null,
  }));
});

const { chartData: costChart } = useLineAreaChartData({
  data: costPoints,
  layout: props.chartLayout,
  accessor: (p) => p.cost,
  yTicks: 4,
  yFormatter: formatCost,
  maxFloor: 0.01,
});

const costAriaLabel = computed(() => {
  const series = {
    combined: "cost in US dollars across all sources",
    usd: "estimated cost in US dollars",
    aiCredits: "AI Credit cost in US dollars",
    legacy: "legacy premium cost",
  }[costBasis.value];
  return `Area chart showing daily ${series} over ${props.timeRangeLabel}`;
});

const tooltipFormatter = (i: number) => {
  const point = costChart.value?.coords[i];
  if (!point) return "";
  const head = `${formatDateMedium(point.date)} — ${formatCost(point.cost)}`;
  if (point.parts) {
    const parts = [
      [aicSourceName.value, point.parts.aiCreditsUsd],
      [sourceNames(false), point.parts.sourceUsd],
    ] as const;
    return [
      head,
      ...parts.filter(([name]) => name).map(([name, usd]) => `${name} ${formatCost(usd)}`),
    ].join(" · ");
  }
  return point.aiCredits == null ? head : `${head} · ${formatAiCredits(point.aiCredits)}`;
};
</script>

<template>
  <div class="grid-2 mb-4 analytics-distribution-grid">
    <!-- Model Distribution (Donut) -->
    <SectionPanel title="Model Distribution">
      <template #actions>
        <router-link :to="{ name: 'model-comparison' }" class="more-info-link">More Info →</router-link>
      </template>
      <div class="donut-panel-body">
        <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Donut chart showing token distribution by model">
          <circle
            v-for="(seg, si) in donutSegments"
            :key="`ds-${si}`"
            cx="80"
            cy="80"
            :r="DONUT_R"
            fill="none"
            :stroke="seg.color"
            :stroke-width="hoveredDonut === si ? 22 : 18"
            :stroke-dasharray="`${seg.dash} ${seg.gap}`"
            :stroke-dashoffset="seg.offset"
            transform="rotate(-90 80 80)"
            class="donut-segment"
            data-reveal="arc"
            @mouseenter="hoveredDonut = si"
            @mouseleave="hoveredDonut = null"
          />
          <text x="80" y="76" text-anchor="middle" font-size="20" font-weight="700" fill="currentColor" class="donut-center-value" data-count-up>
            {{ activeDonutSegment ? formatNumber(activeDonutSegment.tokens) : formatNumber(data.totalTokens) }}
          </text>
          <text x="80" y="92" text-anchor="middle" font-size="9" fill="currentColor" class="donut-center-label">
            {{ activeDonutSegment ? activeDonutSegment.model : 'total tokens' }}
          </text>
        </svg>
        <div class="donut-legend">
          <div
            v-for="(m, si) in legendItems"
            :key="`dl-${si}`"
            class="donut-legend-item"
            :class="{ 'donut-legend-item--active': hoveredDonut === si }"
            @mouseenter="hoveredDonut = si"
            @mouseleave="hoveredDonut = null"
          >
            <span class="donut-legend-dot" :style="{ background: DONUT_COLORS[si % DONUT_COLORS.length] }" />
            <span class="donut-legend-model" :title="m.title">{{ m.label }}</span>
            <span class="donut-legend-pct">{{ m.percentage.toFixed(0) }}%</span>
            <span class="donut-legend-requests" :title="`${formatNumberFull(m.requestCount)} API requests`">{{ formatNumberFull(m.requestCount) }} req</span>
          </div>
        </div>
      </div>
    </SectionPanel>

    <!-- Cost Trend -->
    <SectionPanel title="Cost Trend">
      <template v-if="billedInAic !== false" #actions>
        <div
          class="cost-basis-switch"
          role="radiogroup"
          aria-label="Cost basis"
        >
          <template v-if="hasUsdCost">
            <button
              type="button"
              class="cost-basis-option"
              :class="{ active: costBasis === 'combined' }"
              role="radio"
              :aria-checked="costBasis === 'combined'"
              title="Every source in USD, AI Credits at $0.01 each"
              @click="selectedBasis = 'combined'"
            >
              All Sources
            </button>
            <span class="cost-basis-separator" aria-hidden="true">/</span>
          </template>
          <button
            type="button"
            class="cost-basis-option"
            :class="{ active: costBasis === 'aiCredits' }"
            role="radio"
            :aria-checked="costBasis === 'aiCredits'"
            @click="selectedBasis = 'aiCredits'"
          >
            AI Credits
          </button>
          <span class="cost-basis-separator" aria-hidden="true">/</span>
          <button
            type="button"
            class="cost-basis-option"
            :class="{ active: costBasis === 'legacy' }"
            role="radio"
            :aria-checked="costBasis === 'legacy'"
            @click="selectedBasis = 'legacy'"
          >
            Legacy Premium
          </button>
          <template v-if="hasUsdCost">
            <span class="cost-basis-separator" aria-hidden="true">/</span>
            <button
              type="button"
              class="cost-basis-option"
              :class="{ active: costBasis === 'usd' }"
              role="radio"
              :aria-checked="costBasis === 'usd'"
              :title="`API-equivalent USD for ${usdSourceName} sessions`"
              @click="selectedBasis = 'usd'"
            >
              {{ usdSourceName }}
            </button>
          </template>
        </div>
      </template>
      <p
        v-if="costBasis === 'usd' && !hasUsdCost"
        class="cost-trend-note"
        data-testid="cost-trend-unbilled"
      >
        These sessions are not billed in AI Credits, and none of their runs could be priced in
        USD for this period.
      </p>
      <LineAreaChart
        v-else-if="costChart"
        :chart-data="costChart"
        :chart-layout="chartLayout"
        :grid-lines="gridLines"
        :tooltip="tooltip"
        chart-id="cost"
        :ariaLabel="costAriaLabel"
        :color="costColor"
        :color-light="costColorLight"
        :gradient-opacity="0.35"
        @mousemove="onChartMouseMove($event, costChart.coords, tooltipFormatter, 'cost', '.chart-frame')"
        @click="onChartClick($event, costChart.coords, tooltipFormatter, 'cost', '.chart-frame')"
        @dismiss-tooltip="dismissTooltip"
      />
    </SectionPanel>
  </div>
</template>

<style scoped>
.donut-panel-body {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 18px;
  min-width: 0;
}

.cost-trend-note {
  margin: 0;
  padding: 24px 18px;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

.analytics-distribution-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.analytics-distribution-grid :deep(.section-panel) {
  min-width: 0;
}

.donut-legend {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-width: 0;
  max-height: 160px;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 6px;
  scrollbar-gutter: stable;
}

.donut-legend-item {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  cursor: default;
  transition: color var(--transition-fast, 0.15s);
}

.donut-legend-model {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.donut-legend-item--active {
  color: var(--text-primary);
}

.donut-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.donut-legend-pct {
  margin-left: auto;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
  min-width: 36px;
  text-align: right;
}

.donut-legend-requests {
  font-size: 0.7rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 52px;
  text-align: right;
}

.donut-center-value {
  fill: var(--text-primary);
}

.donut-center-label {
  fill: var(--text-tertiary);
}

.donut-segment {
  cursor: default;
  transition: stroke-width 0.15s ease;
}

.more-info-link {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  cursor: pointer;
  transition: color 0.15s;
}
.more-info-link:hover {
  color: var(--accent-primary);
}

.cost-basis-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.cost-basis-option {
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  padding: 2px 0;
  transition: color var(--transition-fast, 0.15s);
}

.cost-basis-option:hover {
  color: var(--text-secondary);
}

.cost-basis-option.active {
  color: var(--text-primary);
}

.cost-basis-option:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 3px;
  border-radius: var(--radius-sm, 4px);
}

.cost-basis-separator {
  opacity: 0.45;
}
</style>
