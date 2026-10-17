<script setup lang="ts">
/**
 * The Tools page: headline numbers, calls per day, every tool ranked, and
 * when tools run. Built from the Analytics dashboard's pieces; each panel
 * empties on its own, and a filter change keeps the current results on
 * screen until the new ones land.
 */
import { ErrorState, LoadingOverlay, PageShell } from "@tracepilot/ui";
import { computed, ref } from "vue";
import AnalyticsPageHeader from "@/components/AnalyticsPageHeader.vue";
import ToolCallsPanel from "@/components/toolAnalysis/ToolCallsPanel.vue";
import ToolHeatmapPanel from "@/components/toolAnalysis/ToolHeatmapPanel.vue";
import ToolKpis from "@/components/toolAnalysis/ToolKpis.vue";
import ToolRankPanel from "@/components/toolAnalysis/ToolRankPanel.vue";
import { useAnalyticsPage } from "@/composables/useAnalyticsPage";
import { useFirstReveal } from "@/composables/useFirstReveal";
import { useValueTween } from "@/composables/useValueTween";
import { repositoryFilterLabel } from "@/stores/sessions/filtering";
import { rangeText as describeRange, rangeDays } from "@/utils/analyticsDashboard";
import { toolDayRows } from "@/utils/toolAnalysis";
import "@/styles/features/analytics-dashboard.css";

const { store } = useAnalyticsPage("fetchToolAnalysis");

const loading = computed(() => store.toolAnalysisLoading);
const data = computed(() => store.toolAnalysis);
const refreshing = computed(() => store.toolAnalysisRefreshing);

const contentRoot = ref<HTMLElement | null>(null);
const { revealing } = useFirstReveal({
  key: "tools",
  ready: () => !loading.value && !!data.value,
  root: contentRoot,
  countUpSelector: ".kpi__value-num",
});
useValueTween({ root: contentRoot, selector: ".kpi__value-num", source: data });

const pageSubtitle = computed(() => {
  const repoSuffix = store.selectedRepo ? ` in ${repositoryFilterLabel(store.selectedRepo)}` : "";
  return `Performance and usage metrics across all ${store.sourcePrefix}tool invocations${repoSuffix}`;
});

const days = computed(() =>
  data.value
    ? rangeDays(
        (data.value.callsByDay ?? []).map((day) => day.date),
        store.dateRange,
      )
    : [],
);
/** Calls per day for the headline strip. */
const dayRows = computed(() =>
  data.value ? toolDayRows(data.value, days.value, "calls").rows : [],
);
const rangeText = computed(() => describeRange(store.selectedTimeRange));
</script>

<template>
  <PageShell>
    <AnalyticsPageHeader title="Tool Analysis" :subtitle="pageSubtitle" />
    <LoadingOverlay :loading="loading" message="Loading tool analysis…">
      <ErrorState
        v-if="store.toolAnalysisError"
        heading="Failed to load tool analysis"
        :message="store.toolAnalysisError"
        @retry="store.fetchToolAnalysis({ force: true })"
      />
      <div
        v-else-if="data"
        ref="contentRoot"
        class="ad-page"
        :class="{ 'chart-reveal': revealing }"
        :data-refreshing="refreshing"
        :aria-busy="refreshing"
      >
        <ToolKpis :data="data" :rows="dayRows" />
        <ToolCallsPanel :data="data" :days="days" :range-text="rangeText" />
        <ToolRankPanel :data="data" />
        <ToolHeatmapPanel :entries="data.activityHeatmap" />
      </div>
    </LoadingOverlay>
  </PageShell>
</template>
