<script setup lang="ts">
/**
 * Session Metrics: headline KPIs, then where the tokens and the money went,
 * which models or agents did the work, how the prompt cache held up across
 * idle gaps, the runs, and the files changed. Each section loads, empties
 * and fails on its own.
 */
import { EmptyState, ErrorAlert, SegmentedControl, useSessionTabLoader } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import SubagentPanel from "@/components/conversation/SubagentPanel.vue";
import MetricsAgents from "@/components/metrics/MetricsAgents.vue";
import MetricsCodeChanges from "@/components/metrics/MetricsCodeChanges.vue";
import MetricsCost from "@/components/metrics/MetricsCost.vue";
import MetricsKpis from "@/components/metrics/MetricsKpis.vue";
import MetricsModels from "@/components/metrics/MetricsModels.vue";
import MetricsPromptCacheSection from "@/components/metrics/MetricsPromptCacheSection.vue";
import MetricsSessionActivity from "@/components/metrics/MetricsSessionActivity.vue";
import MetricsTokens from "@/components/metrics/MetricsTokens.vue";
import { useChatViewPanelOffset } from "@/composables/useChatViewPanelOffset";
import { useCrossTurnSubagents } from "@/composables/useCrossTurnSubagents";
import { useFirstReveal } from "@/composables/useFirstReveal";
import { useMetricsCost } from "@/composables/useMetricsCost";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { usePromptCache } from "@/composables/usePromptCache";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { allowsAiCreditEstimate } from "@/composables/useSessionMetrics";
import { useSessionSource } from "@/composables/useSessionSource";
import { useSessionTabNavigation } from "@/composables/useSessionTabNavigation";
import { useSessionTabViews } from "@/composables/useSessionTabViews";
import { useSubagentPanel } from "@/composables/useSubagentPanel";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { usePreferencesStore } from "@/stores/preferences";
import { MODEL_COLORS } from "@/utils/metricsView";
import "@/styles/features/analytics-dashboard.css";

const store = useSessionDetailContext();
const prefs = usePreferencesStore();
const router = useRouter();
// Tab mode switches its own sub-tab; route mode pushes the Context route.
const navigateToTab = useSessionTabNavigation();
// Remembered across tabs and restarts; a remembered "agent" still loads turns
// on mount through the loader below.
const tabViews = useSessionTabViews();
const mode = computed({
  get: () => tabViews.value.metrics,
  set: (value) => {
    tabViews.value.metrics = value;
  },
});
const metricsRoot = ref<HTMLElement | null>(null);

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadShutdownMetrics(),
);
useSessionTabLoader(
  () => (mode.value === "agent" ? store.sessionId : null),
  () => store.loadTurns(),
);

const {
  enabled: promptCacheEnabled,
  timeline: promptCache,
  retry: retryPromptCache,
} = usePromptCache(store);

function retryLoadMetrics() {
  store.loaded.delete("metrics");
  store.loadShutdownMetrics();
}

function retryLoadTurns() {
  store.loaded.delete("turns");
  store.loadTurns();
}

const metrics = computed(() => store.shutdownMetrics);
const { source, capabilities } = useSessionSource(
  () => store.sessionId,
  () => store.detail,
);
const showCredits = computed(() => capabilities.value.hasAic);
const creditsObservedOnly = computed(() => !allowsAiCreditEstimate(source.value));
const { revealing } = useFirstReveal({
  key: () => store.sessionId && `metrics:${store.sessionId}`,
  ready: () => !!metrics.value,
  root: metricsRoot,
  countUpSelector: ".kpi__value-num",
});
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
const { panelTopPx } = useChatViewPanelOffset(metricsRoot, () => isPanelOpen.value);

const { modelEntries, tokenBreakdown, totalRequests, aiCreditUsage } = useMetricsTabData(
  metrics,
  prefs,
  creditsObservedOnly,
);
const {
  summary: cost,
  split,
  modelUsd,
} = useMetricsCost({
  metrics,
  source,
  credits: showCredits,
  aiCreditUsage,
  modelEntries,
  prefs,
});

const turnCount = computed(() => store.detail?.turnCount ?? 0);
const wallMs = computed(() => {
  const start = Date.parse(store.detail?.createdAt ?? "");
  const end = Date.parse(store.detail?.updatedAt ?? "");
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null;
});
const apiNote = computed(() => {
  const coverage = metrics.value?.coverage;
  if (!coverage) return null;
  return coverage.snapshotLine == null
    ? "Estimated from transcript timestamps."
    : "Reported with the last cost snapshot.";
});
const roots = computed(() => [store.detail?.gitRoot, store.detail?.cwd]);
const modelOrder = computed(() => modelEntries.value.map((entry) => entry.name));

/** Recorded AI Credits are exact per model; other totals split at list prices. */
function modelEstimated(name: string): boolean {
  if (!showCredits.value) return false;
  const entry = modelEntries.value.find((m) => m.name === name);
  return entry != null && entry.aiCreditSource !== "observed";
}
const mixedEstimates = computed(() => {
  const kinds = new Set(modelEntries.value.map((m) => modelEstimated(m.name)));
  return kinds.size > 1;
});
const costModels = computed(() =>
  modelEntries.value
    .map((m, index) => ({
      name: m.name,
      usd: modelUsd(m.name),
      estimated: mixedEstimates.value && modelEstimated(m.name),
      color: MODEL_COLORS[index % MODEL_COLORS.length],
    }))
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1)),
);
const estimatedOf = (name: string) => mixedEstimates.value && modelEstimated(name);

const modeOptions = computed(() => [
  { value: "model", label: "Models", count: modelEntries.value.length },
  { value: "agent", label: "Agents" },
]);

function openContext() {
  if (!store.sessionId) return;
  if (navigateToTab) navigateToTab("context");
  else pushRoute(router, ROUTE_NAMES.sessionContext, { params: { id: store.sessionId } });
}
</script>

<template>
  <div ref="metricsRoot" class="metrics" :class="{ 'chart-reveal': revealing, 'metrics--panel-open': isPanelOpen }">
    <ErrorAlert
      v-if="store.metricsError"
      :message="store.metricsError"
      variant="inline"
      :retryable="true"
      @retry="retryLoadMetrics"
    />

    <p v-if="!metrics && !store.loaded.has('metrics') && !store.metricsError" role="status" class="metrics__status">Loading session metrics…</p>
    <EmptyState v-else-if="!metrics && !store.metricsError" :description="showCredits ? 'No shutdown metrics available for this session. Metrics are only generated after the first session shutdown.' : 'No model usage has been recorded for this session yet.'" />

    <template v-if="metrics && cost">
      <MetricsKpis
        :cost="cost"
        :tokens="tokenBreakdown"
        :requests="totalRequests"
        :turns="turnCount"
        :api-ms="metrics.totalApiDurationMs"
        :wall-ms="wallMs"
        :api-note="apiNote"
      />

      <MetricsTokens :tokens="tokenBreakdown" :metrics="metrics" @open-context="openContext" />

      <MetricsCost :cost="cost" :split="split" :models="costModels" :credits="showCredits" />

      <section class="metrics__breakdown" aria-label="Breakdown">
        <div class="metrics__switch">
          <h3>Breakdown</h3>
          <SegmentedControl v-model="mode" :options="modeOptions" aria-label="Metrics breakdown" />
        </div>
        <template v-if="mode === 'agent'">
          <ErrorAlert v-if="store.turnsError" :message="store.turnsError" variant="inline" retryable @retry="retryLoadTurns" />
          <p v-else-if="!store.loaded.has('turns')" role="status" class="metrics__status">Loading agent activity…</p>
          <MetricsAgents v-else :key="store.sessionId ?? undefined" :metrics="metrics" :turns="turns" :show-credits="showCredits" @activity="selectSubagent" />
        </template>
        <MetricsModels v-else :models="modelEntries" :cost-of="modelUsd" :estimated-of="estimatedOf" />
      </section>
    </template>

    <template v-if="promptCacheEnabled">
      <ErrorAlert
        v-if="store.promptCacheError"
        :message="store.promptCacheError"
        variant="inline"
        :retryable="true"
        @retry="retryPromptCache"
      />
      <MetricsPromptCacheSection v-if="promptCache" :key="store.sessionId ?? undefined" :timeline="promptCache" :source="source" />
    </template>

    <template v-if="metrics">
      <MetricsSessionActivity :key="store.sessionId ?? undefined" :metrics="metrics" :observed-only="creditsObservedOnly" :model-order="modelOrder" />
      <MetricsCodeChanges :key="store.sessionId ?? undefined" :metrics="metrics" :roots="roots" />
    </template>

    <SubagentPanel :subagent="selectedSubagent" :is-open="isPanelOpen" :current-index="selectedIndex" :total-count="allSubagents.length" :has-prev="hasPrev" :has-next="hasNext" :top-offset="panelTopPx" @close="closePanel" @prev="navigatePrev" @next="navigateNext" @select-subagent="selectSubagent" />
  </div>
</template>

<style scoped>
.metrics {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  container-type: inline-size;
}
/* The subagent panel sits over the right edge; make room for it, as the
   Conversation tab does. */
.metrics--panel-open {
  margin-right: min(38vw, 650px);
}
@media (max-width: 959px) {
  .metrics--panel-open {
    margin-right: 0;
  }
}
.metrics__status {
  margin: 0;
  font-size: 13px;
  color: var(--text-tertiary);
}
.metrics__breakdown {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.metrics__switch {
  display: flex;
  align-items: center;
  gap: 12px;
}
.metrics__switch h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
</style>
