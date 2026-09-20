<script setup lang="ts">
/**
 * Agents summary on the Analytics dashboard. It queries
 * `agents_usage_summary` directly with the dashboard's range and
 * repository rather than widening `AnalyticsData`, because agent runs come
 * from their own index table and need no disk fallback.
 */
import { agentsUsageSummary } from "@tracepilot/client";
import { type AgentUsageSummary, calculateObservedAiCredits } from "@tracepilot/types";
import { formatAiCredits, formatNumber, SectionPanel, toErrorMessage } from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import UsageBreakdownBars, { type BreakdownRow } from "@/components/usage/UsageBreakdownBars.vue";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useAnalyticsStore } from "@/stores/analytics";
import { FAILING_RATE } from "@/utils/agents/entries";

const store = useAnalyticsStore();
const router = useRouter();

const summary = ref<AgentUsageSummary | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

watch(
  [() => store.dateRange, () => store.selectedRepo],
  async ([range, repo]) => {
    loading.value = true;
    error.value = null;
    try {
      summary.value = await agentsUsageSummary({
        fromDate: range.fromDate ?? null,
        toDate: range.toDate ?? null,
        repo: repo ?? null,
      });
    } catch (cause) {
      error.value = toErrorMessage(cause);
    } finally {
      loading.value = false;
    }
  },
  { immediate: true, deep: true },
);

const topAgents = computed<BreakdownRow[]>(
  () =>
    summary.value?.agents.slice(0, 6).map((agent) => ({
      key: agent.name,
      label: agent.name,
      value: agent.runs,
      // Orange marks a rate worth acting on, not any failure at all.
      tone:
        agent.runs > 0 && (agent.failed + agent.cancelled) / agent.runs > FAILING_RATE
          ? ("warning" as const)
          : ("accent" as const),
    })) ?? [],
);

const failureRate = computed(() => {
  const value = summary.value;
  if (!value || value.totalRuns === 0) return "—";
  const rate = ((value.failedRuns + value.cancelledRuns) / value.totalRuns) * 100;
  return `${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}%`;
});

/** Credits exist only on 1.0.83+ runs, so the denominator is always shown. */
const credits = computed(() => {
  const value = summary.value;
  if (!value || value.runsWithCredits === 0) return null;
  return {
    total: formatAiCredits(calculateObservedAiCredits(value.totalOwnNanoAiu)),
    coverage: `${formatNumber(value.runsWithCredits)} of ${formatNumber(value.totalRuns)} runs`,
  };
});
</script>

<template>
  <SectionPanel title="Agents">
    <template #actions>
      <button type="button" class="agents-panel__link" @click="pushRoute(router, ROUTE_NAMES.agentsManager)">
        Open Agents
      </button>
    </template>

    <p v-if="error" class="agents-panel__note" role="alert">{{ error }}</p>
    <p v-else-if="loading && !summary" class="agents-panel__note">Loading agent runs…</p>

    <div v-else-if="summary && summary.totalRuns > 0" class="agents-panel">
      <div class="agents-panel__metrics">
        <div class="agents-panel__metric">
          <span class="agents-panel__value agents-panel__value--accent">
            {{ formatNumber(summary.totalRuns) }}
          </span>
          <span class="agents-panel__metric-label">Agent Runs</span>
        </div>
        <div class="agents-panel__metric">
          <span class="agents-panel__value">{{ failureRate }}</span>
          <span class="agents-panel__metric-label">Failed or Cancelled</span>
        </div>
        <div class="agents-panel__metric">
          <span class="agents-panel__value">{{ summary.maxDepth }}</span>
          <span class="agents-panel__metric-label">Max Depth</span>
        </div>
        <div class="agents-panel__metric">
          <span class="agents-panel__value">{{ summary.peakParallelism }}</span>
          <span class="agents-panel__metric-label">Peak Parallel</span>
        </div>
      </div>

      <div class="agents-panel__top">
        <h4 class="agents-panel__title">Top agents by runs</h4>
        <UsageBreakdownBars :rows="topAgents" :total="summary.totalRuns" :limit="6" />
      </div>

      <p class="agents-panel__note">
        <template v-if="credits">
          Exclusive credits: {{ credits.total }} over {{ credits.coverage }} (CLI 1.0.83+ only).
        </template>
        <template v-else>
          No run carried an agent metrics ledger, so exclusive credits are unavailable.
        </template>
      </p>
    </div>

    <p v-else class="agents-panel__note">No agent runs were indexed for this range.</p>
  </SectionPanel>
</template>

<style scoped>
.agents-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.agents-panel__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 7rem), 1fr));
  gap: 16px;
}

.agents-panel__metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.agents-panel__value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.agents-panel__value--accent {
  color: var(--accent-fg);
}

.agents-panel__metric-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-align: center;
}

.agents-panel__top {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agents-panel__title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.agents-panel__link {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.6875rem;
  color: var(--accent-fg);
  cursor: pointer;
}

.agents-panel__link:hover {
  text-decoration: underline;
}

.agents-panel__note {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
</style>
