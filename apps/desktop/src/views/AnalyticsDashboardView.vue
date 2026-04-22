<script setup lang="ts">
import {
  computeGridLines,
  createChartLayout,
  ErrorState,
  LoadingOverlay,
  PageShell,
  useChartTooltip,
} from "@tracepilot/ui";
import { computed } from "vue";
import AnalyticsPageHeader from "@/components/AnalyticsPageHeader.vue";
import AnalyticsCacheHealthRow from "@/components/analytics/AnalyticsCacheHealthRow.vue";
import AnalyticsDistributionRow from "@/components/analytics/AnalyticsDistributionRow.vue";
import AnalyticsIncidentChart from "@/components/analytics/AnalyticsIncidentChart.vue";
import AnalyticsMetricPanels from "@/components/analytics/AnalyticsMetricPanels.vue";
import AnalyticsStatsGrids from "@/components/analytics/AnalyticsStatsGrids.vue";
import AnalyticsTokenActivityRow from "@/components/analytics/AnalyticsTokenActivityRow.vue";
import { useAnalyticsPage } from "@/composables/useAnalyticsPage";
import { usePerfMonitor } from "@/composables/usePerfMonitor";
import { useRenderBudget } from "@/composables/useRenderBudget";
import { usePreferencesStore } from "@/stores/preferences";

const prefs = usePreferencesStore();
usePerfMonitor("AnalyticsDashboardView");
useRenderBudget({
  key: "render.analyticsDashboardViewMs",
  budgetMs: 180,
  label: "AnalyticsDashboardView",
});
const { tooltip, dismissTooltip, onChartMouseMove, onChartClick } = useChartTooltip();
const { store } = useAnalyticsPage("fetchAnalytics");

const loading = computed(() => store.analyticsLoading);
const data = computed(() => store.analytics);

const pageSubtitle = computed(() => {
  const allPrefix = store.selectedRepo ? "" : "all ";
  const repoSuffix = store.selectedRepo ? ` in ${store.selectedRepo}` : "";
  return `Aggregate metrics across ${allPrefix}${data.value?.totalSessions ?? 0} sessions${repoSuffix}`;
});

const copilotCost = computed(() => {
  if (!data.value) return 0;
  return data.value.totalPremiumRequests * prefs.costPerPremiumRequest;
});
const totalWholesaleCost = computed(() => {
  if (!data.value) return 0;
  return data.value.modelDistribution.reduce(
    (sum, m) =>
      sum +
      (prefs.computeWholesaleCost(m.model, m.inputTokens, m.cacheReadTokens, m.outputTokens) ?? 0),
    0,
  );
});

const chartLayout = createChartLayout(55, 490, 20, 175);
const GRID_ROWS = 4;
const gridLines = computed(() => computeGridLines(chartLayout, GRID_ROWS));

const timeRangeLabel = computed(() => {
  const tr = store.selectedTimeRange;
  if (tr === "7d") return "the past 7 days";
  if (tr === "30d") return "the past 30 days";
  if (tr === "90d") return "the past 90 days";
  if (tr === "custom") {
    const range = store.dateRange;
    if (range?.fromDate && range?.toDate) {
      const from = new Date(range.fromDate);
      const to = new Date(range.toDate);
      const days = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
      return `${days} days`;
    }
    return "the selected period";
  }
  return "all time";
});
</script>

<template>
  <PageShell>
    <AnalyticsPageHeader title="Analytics Dashboard" :subtitle="pageSubtitle" />
    <LoadingOverlay :loading="loading" message="Loading analytics…">
      <ErrorState v-if="store.analyticsError" heading="Failed to load analytics" :message="store.analyticsError" @retry="store.fetchAnalytics({ force: true })" />
      <template v-else-if="data">
        <AnalyticsStatsGrids
          :data="data"
          :copilot-cost="copilotCost"
          :total-wholesale-cost="totalWholesaleCost"
        />
        <AnalyticsMetricPanels :data="data" />
        <AnalyticsTokenActivityRow
          :data="data"
          :chart-layout="chartLayout"
          :grid-lines="gridLines"
          :time-range-label="timeRangeLabel"
          :tooltip="tooltip"
          :on-chart-mouse-move="onChartMouseMove"
          :on-chart-click="onChartClick"
          :dismiss-tooltip="dismissTooltip"
        />
        <AnalyticsDistributionRow
          :data="data"
          :chart-layout="chartLayout"
          :grid-lines="gridLines"
          :time-range-label="timeRangeLabel"
          :tooltip="tooltip"
          :on-chart-mouse-move="onChartMouseMove"
          :on-chart-click="onChartClick"
          :dismiss-tooltip="dismissTooltip"
        />
        <AnalyticsCacheHealthRow :data="data" />
        <AnalyticsIncidentChart
          :data="data"
          :chart-layout="chartLayout"
          :tooltip="tooltip"
          :on-chart-mouse-move="onChartMouseMove"
          :on-chart-click="onChartClick"
          :dismiss-tooltip="dismissTooltip"
        />
      </template>
    </LoadingOverlay>
  </PageShell>
</template>
