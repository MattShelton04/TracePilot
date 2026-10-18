<script setup lang="ts">
/**
 * The Analytics dashboard: headline numbers, then activity over the range,
 * what the tokens and models were, what it cost, how long the model took,
 * what went wrong, the cache, and agents and skills. Each panel loads,
 * empties and fails on its own; pairs sit side by side when there is room.
 */
import { sourceCapabilities, sourceLabel } from "@tracepilot/types";
import { ErrorState, LoadingOverlay, PageShell } from "@tracepilot/ui";
import { computed, ref } from "vue";
import AnalyticsPageHeader from "@/components/AnalyticsPageHeader.vue";
import AnalyticsActivityPanel from "@/components/analytics/AnalyticsActivityPanel.vue";
import AnalyticsAgentsPanel from "@/components/analytics/AnalyticsAgentsPanel.vue";
import AnalyticsCachePanel from "@/components/analytics/AnalyticsCachePanel.vue";
import AnalyticsCostPanel from "@/components/analytics/AnalyticsCostPanel.vue";
import AnalyticsIncidentsPanel from "@/components/analytics/AnalyticsIncidentsPanel.vue";
import AnalyticsKpis from "@/components/analytics/AnalyticsKpis.vue";
import AnalyticsModelMix from "@/components/analytics/AnalyticsModelMix.vue";
import AnalyticsPacePanel from "@/components/analytics/AnalyticsPacePanel.vue";
import AnalyticsSkillsPanel from "@/components/analytics/AnalyticsSkillsPanel.vue";
import AnalyticsTokenMix from "@/components/analytics/AnalyticsTokenMix.vue";
import { useAnalyticsPage } from "@/composables/useAnalyticsPage";
import { useFirstReveal } from "@/composables/useFirstReveal";
import { usePerfMonitor } from "@/composables/usePerfMonitor";
import { useRenderBudget } from "@/composables/useRenderBudget";
import { useValueTween } from "@/composables/useValueTween";
import type { AnalyticsDatasetName } from "@/stores/analytics";
import { usePreferencesStore } from "@/stores/preferences";
import {
  activityRows,
  analyticsScopeWords,
  dashboardDays,
  rangeText as describeRange,
  hasDailyUsage,
} from "@/utils/analyticsDashboard";
import { buildDashboardSummary } from "@/utils/analyticsSummary";
import "@/styles/features/analytics-dashboard.css";

const prefs = usePreferencesStore();
const showAgents = computed(() => prefs.isFeatureEnabled("agents"));
const showSkills = computed(() => prefs.isFeatureEnabled("skills"));
usePerfMonitor("AnalyticsDashboardView");
useRenderBudget({
  key: "render.analyticsDashboardViewMs",
  budgetMs: 180,
  label: "AnalyticsDashboardView",
});
const prefetchPanels = (): AnalyticsDatasetName[] => [
  ...(showAgents.value ? (["agents"] as const) : []),
  ...(showSkills.value ? (["skills"] as const) : []),
];
const { store } = useAnalyticsPage("fetchAnalytics", { alsoPrefetch: prefetchPanels });

const loading = computed(() => store.analyticsLoading);
const data = computed(() => store.analytics);
/** Newer results for changed filters are loading behind the current ones. */
const refreshing = computed(
  () => store.analyticsRefreshing || store.agentsSummaryRefreshing || store.skillsSummaryRefreshing,
);

const contentRoot = ref<HTMLElement | null>(null);
const { revealing } = useFirstReveal({
  key: "analytics",
  ready: () => !loading.value && !!data.value,
  root: contentRoot,
  countUpSelector: ".kpi__value-num, [data-count-up]",
});
// Later results (a new filter, a reindex) count from the old numbers.
useValueTween({
  root: contentRoot,
  selector: ".kpi__value-num, [data-count-up], .agents-panel__value, .skills-panel__value",
  source: () => [store.analytics, store.agentsSummary, store.skillsSummary],
});

/**
 * "across all 12 sessions" only when nothing narrows them; a time range is
 * named, so "6 sessions this month" never reads as every session.
 */
const pageSubtitle = computed(() => {
  const { all, suffix } = analyticsScopeWords(store);
  const scope = `${store.sourcePrefix}sessions${suffix}`;
  // No count until the first result arrives, rather than a false "No sessions".
  if (!data.value) return `Aggregate metrics across ${scope}`;
  const count = data.value.totalSessions;
  const noun = count === 1 ? "session" : "sessions";
  if (count === 0) return `No ${scope}`;
  return `Aggregate metrics across ${all}${count} ${store.sourcePrefix}${noun}${suffix}`;
});

const summary = computed(() =>
  data.value
    ? buildDashboardSummary(data.value, {
        computeUsageBasedCost: prefs.computeUsageBasedCost,
        computeWholesaleCost: prefs.computeWholesaleCost,
      })
    : null,
);

const days = computed(() => (data.value ? dashboardDays(data.value, store.dateRange) : []));
/** Runs ended in the range, even if no session was last active in it. */
const dailyUsage = computed(() => (data.value ? hasDailyUsage(data.value) : false));

/** Runs and incidents per day, for the headline numbers. */
const dayRows = computed(() =>
  data.value && summary.value
    ? activityRows({
        data: data.value,
        days: days.value,
        metric: "runs",
        aiCreditsByDay: summary.value.aiCreditsByDay,
        label: sourceLabel,
      }).rows
    : [],
);

const rangeText = computed(() => describeRange(store.selectedTimeRange));

const billedInAic = computed(() =>
  (data.value?.costBySource ?? []).every((entry) => sourceCapabilities(entry.source).hasAic),
);
</script>

<template>
  <PageShell>
    <AnalyticsPageHeader title="Analytics Dashboard" :subtitle="pageSubtitle" />
    <LoadingOverlay :loading="loading" message="Loading analytics…">
      <ErrorState
        v-if="store.analyticsError"
        heading="Failed to load analytics"
        :message="store.analyticsError"
        @retry="store.fetchAnalytics({ force: true })"
      />
      <div
        v-else-if="data && summary"
        ref="contentRoot"
        class="ad-page"
        :class="{ 'chart-reveal': revealing }"
        :data-refreshing="refreshing"
        :aria-busy="refreshing"
      >
        <AnalyticsKpis :data="data" :summary="summary" :rows="dayRows" />
        <AnalyticsActivityPanel :data="data" :summary="summary" :days="days" :range-text="rangeText" />
        <div class="ad-pair">
          <AnalyticsModelMix :models="summary.models" :daily-usage="dailyUsage" />
          <AnalyticsTokenMix
            :composition="summary.composition"
            :models="summary.models"
            :daily-usage="dailyUsage"
          />
        </div>
        <AnalyticsCostPanel
          :data="data"
          :summary="summary"
          :days="days"
          :range-text="rangeText"
          :cost-per-premium-request="prefs.costPerPremiumRequest"
        />
        <AnalyticsPacePanel :data="data" />
        <div class="ad-pair">
          <AnalyticsIncidentsPanel
            :data="data"
            :days="days"
            :sources="summary.sources"
            :range-text="rangeText"
          />
          <AnalyticsCachePanel
            :composition="summary.composition"
            :by-source="summary.cacheBySource"
            :timing="prefs.isFeatureEnabled('promptCacheInsights') ? data.promptCache : null"
            :billed-in-aic="billedInAic"
          />
        </div>
        <div v-if="showAgents || showSkills" class="ad-pair">
          <AnalyticsAgentsPanel v-if="showAgents" />
          <AnalyticsSkillsPanel v-if="showSkills" />
        </div>
      </div>
    </LoadingOverlay>
  </PageShell>
</template>
