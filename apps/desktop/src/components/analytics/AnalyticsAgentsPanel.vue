<script setup lang="ts">
/**
 * Agents summary on the Analytics dashboard. It queries
 * `agents_usage_summary` directly with the dashboard's range and
 * repository rather than widening `AnalyticsData`, because agent runs come
 * from their own index table and need no disk fallback.
 *
 * The shape follows the skills-analytics plan: headline figures, the
 * outcome split, then a ranked list that is a way into each agent rather
 * than a chart to read and leave.
 */
import { agentsUsageSummary } from "@tracepilot/client";
import { type AgentUsageSummary, calculateObservedAiCredits } from "@tracepilot/types";
import {
  formatAiCredits,
  formatDuration,
  formatNumber,
  SectionPanel,
  toErrorMessage,
} from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import UsageStackedBar, { type StackedSegment } from "@/components/usage/UsageStackedBar.vue";
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
  async ([range, repo], _previous, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    loading.value = true;
    error.value = null;
    try {
      const result = await agentsUsageSummary({
        fromDate: range.fromDate ?? null,
        toDate: range.toDate ?? null,
        repo: repo ?? null,
      });
      if (active) summary.value = result;
    } catch (cause) {
      if (active) error.value = toErrorMessage(cause);
    } finally {
      if (active) loading.value = false;
    }
  },
  { immediate: true, deep: true },
);

const percent = (value: number) =>
  value >= 0.1 ? `${Math.round(value * 100)}%` : `${(value * 100).toFixed(1)}%`;

const failureRate = computed(() => {
  const value = summary.value;
  if (!value || value.totalRuns === 0) return "—";
  return percent((value.failedRuns + value.cancelledRuns) / value.totalRuns);
});

/** Credits exist only on newer CLI runs, so the denominator is always shown. */
const credits = computed(() => {
  const value = summary.value;
  if (!value || value.runsWithCredits === 0) return null;
  return {
    total: formatAiCredits(calculateObservedAiCredits(value.totalOwnNanoAiu)),
    coverage: `${formatNumber(value.runsWithCredits)} of ${formatNumber(value.totalRuns)} runs`,
  };
});

const metrics = computed(() => {
  const value = summary.value;
  if (!value) return [];
  return [
    { key: "runs", value: formatNumber(value.totalRuns), label: "Agent Runs", accent: true },
    { key: "sessions", value: formatNumber(value.totalSessions), label: "Sessions" },
    { key: "failed", value: failureRate.value, label: "Failed or Cancelled" },
    { key: "credits", value: credits.value?.total ?? "—", label: "Exclusive Credits" },
  ];
});

const outcomes = computed<StackedSegment[]>(() => {
  const value = summary.value;
  if (!value) return [];
  const failed = value.failedRuns + value.cancelledRuns;
  return [
    {
      key: "completed",
      label: "Completed",
      value: value.totalRuns - failed - value.incompleteRuns,
      tone: "success",
    },
    { key: "failed", label: "Failed or cancelled", value: failed, tone: "danger" },
    { key: "incomplete", label: "Incomplete", value: value.incompleteRuns, tone: "neutral" },
  ];
});

/** Ranked by runs, with the figures that say whether the runs went well. */
const topAgents = computed(() => {
  const agents = summary.value?.agents ?? [];
  const max = Math.max(1, ...agents.map((agent) => agent.runs));
  return [...agents]
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 6)
    .map((agent) => {
      const rate = agent.runs > 0 ? (agent.failed + agent.cancelled) / agent.runs : 0;
      return {
        name: agent.name,
        runs: formatNumber(agent.runs),
        width: `${Math.max(2, (agent.runs / max) * 100)}%`,
        median: agent.durationMs.p50 != null ? formatDuration(agent.durationMs.p50) : "—",
        failure: percent(rate),
        // Orange marks a rate worth acting on, not any failure at all.
        failing: rate > FAILING_RATE,
      };
    });
});

function openAgents(search?: string) {
  pushRoute(router, ROUTE_NAMES.agentsManager, search ? { query: { q: search } } : {});
}
</script>

<template>
  <SectionPanel title="Agents">
    <template #actions>
      <button type="button" class="agents-panel__link" @click="openAgents()">Open Agents</button>
    </template>

    <p v-if="error" class="agents-panel__note" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="agents-panel__note" role="status">Loading agent runs…</p>

    <div v-else-if="summary && summary.totalRuns > 0" class="agents-panel">
      <div class="agents-panel__metrics">
        <div v-for="metric in metrics" :key="metric.key" class="agents-panel__metric">
          <span class="agents-panel__value" :class="{ 'agents-panel__value--accent': metric.accent }">
            {{ metric.value }}
          </span>
          <span class="agents-panel__metric-label">{{ metric.label }}</span>
        </div>
      </div>

      <UsageStackedBar :segments="outcomes" :total="summary.totalRuns" />

      <div class="agents-panel__top">
        <div class="agents-panel__head">
          <h4 class="agents-panel__title">Busiest agents</h4>
          <span class="agents-panel__legend">runs · median · failed/cancelled</span>
        </div>
        <ul class="agents-panel__list">
          <li v-for="agent in topAgents" :key="agent.name">
            <button type="button" class="agents-panel__row" :aria-label="`Open agent ${agent.name}: ${agent.runs} runs, median ${agent.median}, ${agent.failure} failed or cancelled`" @click="openAgents(agent.name)">
              <span class="agents-panel__name" :title="agent.name">{{ agent.name }}</span>
              <span class="agents-panel__track" aria-hidden="true">
                <span
                  class="agents-panel__fill"
                  :class="{ 'agents-panel__fill--warning': agent.failing }"
                  :style="{ width: agent.width }"
                />
              </span>
              <span class="agents-panel__figure">{{ agent.runs }}</span>
              <span class="agents-panel__figure agents-panel__figure--muted">{{ agent.median }}</span>
              <span
                class="agents-panel__figure"
                :class="agent.failing ? 'agents-panel__figure--warning' : 'agents-panel__figure--muted'"
              >{{ agent.failure }}</span>
            </button>
          </li>
        </ul>
      </div>

      <p class="agents-panel__note">
        Deepest nesting {{ summary.maxDepth }} · peak {{ summary.peakParallelism }} concurrent ·
        <template v-if="credits">credits from {{ credits.coverage }}</template>
        <template v-else>no run carried an agent metrics ledger, so credits are unavailable</template>
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

.agents-panel__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.agents-panel__title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.agents-panel__legend {
  font-size: 0.625rem;
  color: var(--text-tertiary);
}

.agents-panel__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Each row is the way into that agent, so the whole row is the target. */
.agents-panel__row {
  display: grid;
  grid-template-columns: minmax(4rem, 1fr) minmax(48px, 1.2fr) auto auto auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.agents-panel__row:hover {
  background: var(--neutral-subtle);
}

.agents-panel__name {
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agents-panel__row:hover .agents-panel__name {
  color: var(--text-primary);
}

.agents-panel__track {
  height: 4px;
  border-radius: var(--radius-sm);
  background: var(--canvas-inset, var(--canvas-subtle));
  overflow: hidden;
}

.agents-panel__fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--accent-emphasis);
}

.agents-panel__fill--warning {
  background: var(--warning-emphasis);
}

.agents-panel__figure {
  font-size: 0.6875rem;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.agents-panel__figure--muted {
  color: var(--text-tertiary);
}

.agents-panel__figure--warning {
  color: var(--warning-fg);
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
