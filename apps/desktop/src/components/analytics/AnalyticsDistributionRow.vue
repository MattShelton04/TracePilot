<script setup lang="ts">
import { AI_CREDIT_USD, type AnalyticsData } from "@tracepilot/types";
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
import { buildAnalyticsCostSeries } from "@/utils/analyticsCostSeries";
import { CHART_COLORS, DONUT_PALETTE } from "@/utils/chartColors";

const props = defineProps<{
  data: AnalyticsData;
  chartLayout: ChartLayout;
  gridLines: number[];
  timeRangeLabel: string;
  tooltip: ChartTooltipState;
  onChartMouseMove: ReturnType<typeof useChartTooltip>["onChartMouseMove"];
  onChartClick: ReturnType<typeof useChartTooltip>["onChartClick"];
  dismissTooltip: ReturnType<typeof useChartTooltip>["dismissTooltip"];
}>();

const prefs = usePreferencesStore();

const DONUT_COLORS = DONUT_PALETTE;
const DONUT_R = 56;
const DONUT_C = 2 * Math.PI * DONUT_R;

const donutSegments = computed(() => {
  let offset = 0;
  return props.data.modelDistribution.map((m, i) => {
    const dash = (m.percentage / 100) * DONUT_C;
    const seg = {
      dash,
      gap: DONUT_C - dash,
      offset: -offset,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      model: m.model,
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
type CostBasis = "aiCredits" | "legacy";

const costBasis = ref<CostBasis>("aiCredits");

const isAiCredits = computed(() => costBasis.value === "aiCredits");

const costPanelTitle = computed(() =>
  isAiCredits.value ? "AI Credit Trend" : "Legacy Premium Cost Trend",
);

const costColor = computed(() => (isAiCredits.value ? CHART_COLORS.success : CHART_COLORS.primary));
const costColorLight = computed(() =>
  isAiCredits.value ? CHART_COLORS.successLight : CHART_COLORS.primaryLight,
);

const costPoints = computed(() =>
  buildAnalyticsCostSeries(
    props.data,
    costBasis.value,
    prefs.costPerPremiumRequest,
    prefs.computeWholesaleCost,
    prefs.computeUsageBasedCost,
  ),
);

const { chartData: costChart } = useLineAreaChartData({
  data: costPoints,
  layout: props.chartLayout,
  accessor: (p) => p.cost,
  yTicks: 4,
  yFormatter: (value) => (isAiCredits.value ? formatAiCredits(value) : formatCost(value)),
  maxFloor: 0.01,
});

const costAriaLabel = computed(
  () =>
    `Area chart showing daily ${isAiCredits.value ? "AI Credit usage" : "legacy premium cost"} over ${props.timeRangeLabel}`,
);

const tooltipFormatter = (i: number) => {
  const point = costChart.value?.coords[i];
  return point
    ? `${formatDateMedium(point.date)} — ${
        isAiCredits.value
          ? `${formatAiCredits(point.cost)} (${formatCost(point.cost * AI_CREDIT_USD)})`
          : formatCost(point.cost)
      }`
    : "";
};
</script>

<template>
  <div class="grid-2 mb-4">
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
            @mouseenter="hoveredDonut = si"
            @mouseleave="hoveredDonut = null"
          />
          <text x="80" y="76" text-anchor="middle" font-size="20" font-weight="700" fill="currentColor" class="donut-center-value">
            {{ activeDonutSegment ? formatNumber(activeDonutSegment.tokens) : formatNumber(data.totalTokens) }}
          </text>
          <text x="80" y="92" text-anchor="middle" font-size="9" fill="currentColor" class="donut-center-label">
            {{ activeDonutSegment ? activeDonutSegment.model : 'total tokens' }}
          </text>
        </svg>
        <div class="donut-legend">
          <div
            v-for="(m, si) in data.modelDistribution"
            :key="`dl-${si}`"
            class="donut-legend-item"
            :class="{ 'donut-legend-item--active': hoveredDonut === si }"
            @mouseenter="hoveredDonut = si"
            @mouseleave="hoveredDonut = null"
          >
            <span class="donut-legend-dot" :style="{ background: DONUT_COLORS[si % DONUT_COLORS.length] }" />
            <span>{{ m.model }}</span>
            <span class="donut-legend-pct">{{ m.percentage.toFixed(0) }}%</span>
            <span class="donut-legend-requests" :title="`${formatNumberFull(m.requestCount)} API requests`">{{ formatNumberFull(m.requestCount) }} req</span>
          </div>
        </div>
      </div>
    </SectionPanel>

    <!-- Cost Trend -->
    <SectionPanel :title="costPanelTitle">
      <template #actions>
        <div
          class="cost-basis-switch"
          role="radiogroup"
          aria-label="Cost basis"
        >
          <button
            type="button"
            class="cost-basis-option"
            :class="{ active: costBasis === 'aiCredits' }"
            role="radio"
            :aria-checked="costBasis === 'aiCredits'"
            @click="costBasis = 'aiCredits'"
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
            @click="costBasis = 'legacy'"
          >
            Legacy Premium
          </button>
        </div>
      </template>
      <LineAreaChart
        v-if="costChart"
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
      <div v-if="isAiCredits" class="cost-equivalence">
        Dollar equivalent: 1 AIC = {{ formatCost(AI_CREDIT_USD) }}. Daily USD values are shown in
        chart tooltips.
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.donut-panel-body {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 18px;
}

.donut-legend {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.donut-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  cursor: default;
  transition: color var(--transition-fast, 0.15s);
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

.cost-equivalence {
  padding: 0 18px 12px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
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
