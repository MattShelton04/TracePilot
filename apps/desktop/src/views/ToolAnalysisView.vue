<script setup lang="ts">
import type { ToolUsageEntry } from "@tracepilot/types";
import { formatDuration, formatNumberFull, formatRate } from "@tracepilot/types";
import { ErrorState, LoadingOverlay, PageShell, StatCard } from "@tracepilot/ui";
import { computed } from "vue";
import AnalyticsPageHeader from "@/components/AnalyticsPageHeader.vue";
import ToolFrequencyList from "@/components/toolAnalysis/ToolFrequencyList.vue";
import ToolSuccessFailureChart from "@/components/toolAnalysis/ToolSuccessFailureChart.vue";
import ToolUsageHeatmap from "@/components/toolAnalysis/ToolUsageHeatmap.vue";
import ToolUsageList from "@/components/toolAnalysis/ToolUsageList.vue";
import { useAnalyticsPage } from "@/composables/useAnalyticsPage";

const { store } = useAnalyticsPage("fetchToolAnalysis");

const loading = computed(() => store.toolAnalysisLoading);
const data = computed(() => store.toolAnalysis);

const pageSubtitle = computed(() => {
  const repoSuffix = store.selectedRepo ? ` in ${store.selectedRepo}` : "";
  return `Performance and usage metrics across all tool invocations${repoSuffix}`;
});

const uniqueToolCount = computed(() => data.value?.tools.length ?? 0);

const sortedTools = computed<ToolUsageEntry[]>(() => {
  if (!data.value) return [];
  return [...data.value.tools].sort((a, b) => b.callCount - a.callCount);
});

const maxInvocations = computed(() => {
  if (!sortedTools.value.length) return 1;
  return sortedTools.value[0].callCount;
});
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
      <template v-else-if="data">
        <div class="grid-4 mb-4">
          <StatCard :value="formatNumberFull(data.totalCalls)" label="Total Tool Calls" />
          <StatCard :value="uniqueToolCount" label="Unique Tools" color="done" />
          <StatCard :value="formatRate(data.successRate)" label="Success Rate" color="success" />
          <StatCard :value="formatDuration(data.avgDurationMs)" label="Avg Duration" color="warning" />
        </div>

        <ToolUsageList :tools="sortedTools" />

        <div class="grid-2 mb-4">
          <ToolSuccessFailureChart :tools="sortedTools" :max-invocations="maxInvocations" />
          <ToolFrequencyList :tools="sortedTools" :max-invocations="maxInvocations" />
        </div>

        <ToolUsageHeatmap :entries="data.activityHeatmap" />
      </template>
    </LoadingOverlay>
  </PageShell>
</template>
