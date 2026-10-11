<script setup lang="ts">
/**
 * Agents summary on the Analytics dashboard. It queries
 * `agents_usage_summary` directly with the dashboard's range, repository
 * and source rather than widening `AnalyticsData`, because agent runs come
 * from their own index table and need no disk fallback.
 *
 * The shape follows the skills-analytics plan: headline figures, the
 * outcome split, then a ranked list that is a way into each agent rather
 * than a chart to read and leave.
 */
import { agentsUsageSummary } from "@tracepilot/client";
import { type AgentUsageSummary, calculateObservedAiCredits } from "@tracepilot/types";
import { formatAiCredits, formatDuration, formatNumber, toErrorMessage } from "@tracepilot/ui";
import { ArrowRight, Bot, Coins, Network, OctagonX } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useFirstReveal } from "@/composables/useFirstReveal";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useAnalyticsStore } from "@/stores/analytics";
import { NO_FINAL_REPORT } from "@/utils/agentEndState";
import { FAILING_RATE } from "@/utils/agents/entries";

const store = useAnalyticsStore();
const router = useRouter();

const summary = ref<AgentUsageSummary | null>(null);
const panelRoot = ref<HTMLElement | null>(null);
// The panel loads its own data, usually after the dashboard's reveal window.
const { revealing } = useFirstReveal({
  key: "analytics:agents",
  ready: () => (summary.value?.totalRuns ?? 0) > 0,
  root: panelRoot,
  countUpSelector: ".agents-panel__value",
});
const loading = ref(false);
const error = ref<string | null>(null);

// A finished reindex refreshes the figures in place; only a new filter (or
// the first load) shows the loading note.
watch(
  [
    () => store.dateRange,
    () => store.selectedRepo,
    () => store.selectedSource,
    () => store.dataRevision,
  ],
  async ([range, repo, source, revision], previous, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    const [oldRange, oldRepo, oldSource, oldRevision] = previous;
    const reindexOnly =
      summary.value !== null &&
      revision !== oldRevision &&
      range === oldRange &&
      repo === oldRepo &&
      source === oldSource;
    if (!reindexOnly) loading.value = true;
    error.value = null;
    try {
      const result = await agentsUsageSummary({
        fromDate: range.fromDate ?? null,
        toDate: range.toDate ?? null,
        repo: repo ?? null,
        source: source ?? null,
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
  value === 0
    ? "0%"
    : value >= 0.1
      ? `${Math.round(value * 100)}%`
      : `${(value * 100).toFixed(1)}%`;

/** Credits exist only on newer CLI runs, so the denominator is always shown. */
const credits = computed(() => {
  const value = summary.value;
  if (!value || value.runsWithCredits === 0) return null;
  return {
    total: formatAiCredits(calculateObservedAiCredits(value.totalOwnNanoAiu)),
    coverage: `${formatNumber(value.runsWithCredits)} of ${formatNumber(value.totalRuns)} runs`,
  };
});

/** The same four-tile header as Skills, so the two panels line up. */
const tiles = computed(() => {
  const value = summary.value;
  if (!value) return [];
  const failed = value.failedRuns + value.cancelledRuns;
  return [
    {
      key: "runs",
      icon: Bot,
      label: "Runs",
      value: formatNumber(value.totalRuns),
      detail: `${formatNumber(value.totalSessions)} session${value.totalSessions === 1 ? "" : "s"}`,
    },
    {
      key: "failed",
      icon: OctagonX,
      label: "Failed",
      value: value.totalRuns ? percent(failed / value.totalRuns) : "—",
      detail: `${formatNumber(failed)} of ${formatNumber(value.totalRuns)} runs`,
    },
    {
      key: "depth",
      icon: Network,
      label: "Deepest",
      value: formatNumber(value.maxDepth),
      detail: `peak ${formatNumber(value.peakParallelism)} at once`,
    },
    {
      key: "credits",
      icon: Coins,
      label: "Own credits",
      value: credits.value?.total ?? "—",
      detail: credits.value ? credits.value.coverage : "no metrics ledger",
    },
  ];
});

const outcomes = computed(() => {
  const value = summary.value;
  if (!value) return [];
  const failed = value.failedRuns + value.cancelledRuns;
  const unreported = value.unreportedRuns ?? 0;
  return [
    {
      key: "completed",
      label: "Completed",
      value: value.totalRuns - failed - value.incompleteRuns - unreported,
      color: "var(--success-fg)",
    },
    { key: "failed", label: "Failed or cancelled", value: failed, color: "var(--danger-fg)" },
    {
      key: "incomplete",
      label: "Incomplete",
      value: value.incompleteRuns,
      color: "var(--text-tertiary)",
    },
    {
      key: "unreported",
      label: NO_FINAL_REPORT,
      value: unreported,
      color: "var(--surface-tertiary)",
    },
  ]
    .filter((segment) => segment.value > 0)
    .map((segment) => ({ ...segment, width: (segment.value / value.totalRuns) * 100 }));
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
  <OverviewPanel
    title="Agents"
    :flush="!!summary && summary.totalRuns > 0 && !loading && !error"
    data-testid="analytics-agents"
  >
    <template #aside>
      <button type="button" class="ad-link" @click="openAgents()">
        Open Agents <ArrowRight :size="12" aria-hidden="true" />
      </button>
    </template>

    <p v-if="error" class="ad-empty" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="ad-empty" role="status">Loading agent runs…</p>

    <div
      v-else-if="summary && summary.totalRuns > 0"
      ref="panelRoot"
      class="ad-usage"
      :class="{ 'chart-reveal': revealing }"
    >
      <div class="ad-tiles ad-usage__tiles">
        <div v-for="tile in tiles" :key="tile.key" class="ad-tile">
          <div class="ad-tile__label">
            <component :is="tile.icon" :size="13" aria-hidden="true" />{{ tile.label }}
          </div>
          <div class="ad-tile__value agents-panel__value">{{ tile.value }}</div>
          <div class="ad-tile__detail" :title="tile.detail">{{ tile.detail }}</div>
        </div>
      </div>

      <div class="ad-usage__body">
        <div class="ad-usage__split">
          <div class="ad-meter ad-meter--lg" aria-hidden="true">
            <i
              v-for="segment in outcomes"
              :key="segment.key"
              :title="`${segment.label}: ${segment.value}`"
              :style="{ width: `${segment.width}%`, background: segment.color }"
              data-reveal="grow-x"
            />
          </div>
          <div class="ad-legend ad-legend--nowrap">
            <span v-for="segment in outcomes" :key="segment.key" class="ad-usage__item">
              <i class="ad-sw" :style="{ background: segment.color }" />{{ segment.label }}<b>{{ segment.value }}</b>
            </span>
          </div>
        </div>

        <div class="ad-rows" role="list" aria-label="Busiest agents">
          <div class="ad-rowh ad-usage__grid">
            <span>Busiest agents</span><span /><span class="ad-num">Runs</span>
            <span class="ad-num">Median</span><span class="ad-num">Failed</span>
          </div>
          <button
            v-for="agent in topAgents"
            :key="agent.name"
            type="button"
            role="listitem"
            class="ad-row ad-usage__grid agents-panel__row"
            :aria-label="`Open agent ${agent.name}: ${agent.runs} runs, median ${agent.median}, ${agent.failure} failed or cancelled`"
            @click="openAgents(agent.name)"
          >
            <span class="ad-row__name">
              <span class="agents-panel__name" :title="agent.name">{{ agent.name }}</span>
            </span>
            <span class="ad-track" aria-hidden="true">
              <i
                data-reveal="grow-x"
                :style="{
                  width: agent.width,
                  background: agent.failing ? 'var(--warning-fg)' : 'var(--accent-fg)',
                }"
              />
            </span>
            <span class="ad-num">{{ agent.runs }}</span>
            <span class="ad-num ad-num--muted">{{ agent.median }}</span>
            <span class="ad-num" :class="agent.failing ? 'ad-num--warning' : 'ad-num--muted'">
              {{ agent.failure }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <p v-else class="ad-empty">
      <b>No agent runs</b>
      No subagents were indexed for this range.
    </p>
  </OverviewPanel>
</template>
