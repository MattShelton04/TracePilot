<script setup lang="ts">
import { Badge, EmptyState, ErrorAlert, useSessionTabLoader } from "@tracepilot/ui";
import { computed } from "vue";
import MetricsCacheBreakdown from "@/components/metrics/MetricsCacheBreakdown.vue";
import MetricsCodeChanges from "@/components/metrics/MetricsCodeChanges.vue";
import MetricsModelTable from "@/components/metrics/MetricsModelTable.vue";
import MetricsSessionActivity from "@/components/metrics/MetricsSessionActivity.vue";
import MetricsStatCards from "@/components/metrics/MetricsStatCards.vue";
import MetricsTokenBudget from "@/components/metrics/MetricsTokenBudget.vue";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { usePreferencesStore } from "@/stores/preferences";

const store = useSessionDetailContext();
const prefs = usePreferencesStore();

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadShutdownMetrics(),
);

function retryLoadMetrics() {
  store.loaded.delete("metrics");
  store.loadShutdownMetrics();
}

const metrics = computed(() => store.shutdownMetrics);

const {
  modelEntries,
  totalInputTokens,
  totalTokens,
  totalCacheReadTokens,
  totalRequests,
  hasReasoningData,
  hasTokenBudget,
  copilotCost,
  totalWholesaleCost,
  totalUsageBasedCost,
  hasUsageBasedUnknowns,
  june2026PreviewDelta,
  observedAiuCost,
  cacheHitRatio,
} = useMetricsTabData(metrics, prefs);
</script>

<template>
  <div>
    <ErrorAlert
      v-if="store.metricsError"
      :message="store.metricsError"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadMetrics"
    />

    <EmptyState v-if="!metrics && !store.metricsError" message="No shutdown metrics available for this session. Metrics are only generated after the first session shutdown." />

    <template v-if="metrics">
      <MetricsStatCards
        :metrics="metrics"
        :total-requests="totalRequests"
        :copilot-cost="copilotCost"
        :total-usage-based-cost="totalUsageBasedCost"
        :has-usage-based-unknowns="hasUsageBasedUnknowns"
        :total-wholesale-cost="totalWholesaleCost"
        :june2026-preview-delta="june2026PreviewDelta"
        :observed-aiu-cost="observedAiuCost"
        :total-tokens="totalTokens"
      />

      <MetricsModelTable
        :model-entries="modelEntries"
        :total-tokens="totalTokens"
        :has-reasoning-data="hasReasoningData"
      />

      <MetricsSessionActivity :metrics="metrics" />

      <MetricsCacheBreakdown
        :cache-hit-ratio="cacheHitRatio"
        :total-cache-read-tokens="totalCacheReadTokens"
        :total-input-tokens="totalInputTokens"
      />

      <MetricsTokenBudget :metrics="metrics" :has-token-budget="hasTokenBudget" />

      <MetricsCodeChanges :metrics="metrics" />

      <div v-if="metrics.currentModel" class="flex items-center gap-2">
        <span class="text-xs text-[var(--text-tertiary)]">Current Model:</span>
        <Badge variant="done">{{ metrics.currentModel }}</Badge>
      </div>
    </template>
  </div>
</template>
