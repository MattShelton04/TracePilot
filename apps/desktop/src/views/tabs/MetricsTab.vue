<script setup lang="ts">
import { Badge, EmptyState, ErrorAlert, useSessionTabLoader } from "@tracepilot/ui";
import { computed, ref } from "vue";
import SubagentPanel from "@/components/conversation/SubagentPanel.vue";
import MetricsAgentBreakdown from "@/components/metrics/MetricsAgentBreakdown.vue";
import MetricsCacheBreakdown from "@/components/metrics/MetricsCacheBreakdown.vue";
import MetricsCodeChanges from "@/components/metrics/MetricsCodeChanges.vue";
import MetricsModelTable from "@/components/metrics/MetricsModelTable.vue";
import MetricsSessionActivity from "@/components/metrics/MetricsSessionActivity.vue";
import MetricsStatCards from "@/components/metrics/MetricsStatCards.vue";
import MetricsTokenBudget from "@/components/metrics/MetricsTokenBudget.vue";
import { useChatViewPanelOffset } from "@/composables/useChatViewPanelOffset";
import { useCrossTurnSubagents } from "@/composables/useCrossTurnSubagents";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSubagentPanel } from "@/composables/useSubagentPanel";
import { usePreferencesStore } from "@/stores/preferences";

const store = useSessionDetailContext();
const prefs = usePreferencesStore();
const mode = ref("model");
const metricsRoot = ref<HTMLElement | null>(null);
const { panelTopPx } = useChatViewPanelOffset(metricsRoot);

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadShutdownMetrics(),
);
useSessionTabLoader(
  () => (mode.value === "agent" ? store.sessionId : null),
  () => store.loadTurns(),
);

function retryLoadMetrics() {
  store.loaded.delete("metrics");
  store.loadShutdownMetrics();
}

function retryLoadTurns() {
  store.loaded.delete("turns");
  store.loadTurns();
}

const metrics = computed(() => store.shutdownMetrics);
const turns = computed(() => store.turns);
const { allSubagents } = useCrossTurnSubagents(turns);
const {
  selectedSubagent,
  selectedIndex,
  isPanelOpen,
  hasPrev,
  hasNext,
  selectSubagent,
  closePanel,
  navigatePrev,
  navigateNext,
} = useSubagentPanel(allSubagents);

const {
  modelEntries,
  totalTokens,
  tokenBreakdown,
  totalRequests,
  hasReasoningData,
  hasTokenBudget,
  copilotCost,
  totalWholesaleCost,
  aiCreditUsage,
} = useMetricsTabData(metrics, prefs);
</script>

<template>
  <div ref="metricsRoot">
    <ErrorAlert
      v-if="store.metricsError"
      :message="store.metricsError"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadMetrics"
    />

    <EmptyState v-if="!metrics && !store.metricsError" description="No shutdown metrics available for this session. Metrics are only generated after the first session shutdown." />

    <template v-if="metrics">
      <MetricsStatCards
        :metrics="metrics"
        :total-requests="totalRequests"
        :copilot-cost="copilotCost"
        :total-wholesale-cost="totalWholesaleCost"
        :ai-credit-usage="aiCreditUsage"
        :total-tokens="tokenBreakdown.total"
      />

      <div class="flex gap-2 mb-4" role="group" aria-label="Metrics breakdown">
        <button class="btn" :class="mode === 'model' ? 'btn-primary' : 'btn-secondary'" :aria-pressed="mode === 'model'" @click="mode = 'model'">By model</button>
        <button class="btn" :class="mode === 'agent' ? 'btn-primary' : 'btn-secondary'" :aria-pressed="mode === 'agent'" @click="mode = 'agent'">By agent</button>
      </div>
      <ErrorAlert v-if="mode === 'agent' && store.turnsError" :message="store.turnsError" variant="inline" class="mb-4" retryable @retry="retryLoadTurns" />
      <p v-if="mode === 'agent' && !store.loaded.has('turns') && !store.turnsError" class="text-sm text-[var(--text-tertiary)] mb-4">Loading agent activity…</p>
      <MetricsAgentBreakdown v-if="mode === 'agent' && store.loaded.has('turns')" :metrics="metrics" :turns="turns" @activity="selectSubagent" />
      <MetricsCacheBreakdown v-if="mode === 'model'" :breakdown="tokenBreakdown" />

      <MetricsModelTable
        v-if="mode === 'model'"
        :model-entries="modelEntries"
        :total-tokens="totalTokens"
        :has-reasoning-data="hasReasoningData"
      />

      <MetricsSessionActivity :metrics="metrics" />

      <MetricsTokenBudget :metrics="metrics" :has-token-budget="hasTokenBudget" />

      <MetricsCodeChanges :metrics="metrics" />

      <div v-if="metrics.currentModel" class="flex items-center gap-2">
        <span class="text-xs text-[var(--text-tertiary)]">Current Model:</span>
        <Badge variant="done">{{ metrics.currentModel }}</Badge>
      </div>
    </template>
    <SubagentPanel :subagent="selectedSubagent" :is-open="isPanelOpen" :current-index="selectedIndex" :total-count="allSubagents.length" :has-prev="hasPrev" :has-next="hasNext" :top-offset="panelTopPx" @close="closePanel" @prev="navigatePrev" @next="navigateNext" @select-subagent="selectSubagent" />
  </div>
</template>
