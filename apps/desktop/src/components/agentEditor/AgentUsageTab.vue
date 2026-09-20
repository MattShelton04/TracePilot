<script setup lang="ts">
/**
 * Cross-session usage for one agent, scoped to the range selected on the
 * manager.
 *
 * The four figures that answer "is this agent healthy?" lead, then the
 * outcome split. Everything else is context you go looking for, so it sits
 * in collapsed sections rather than in a wall of bars. Denominators are
 * shown wherever older CLI versions report a metric on only some runs.
 */
import { calculateObservedAiCredits } from "@tracepilot/types";
import {
  formatAiCredits,
  formatDuration,
  formatNumber,
  formatRelativeTime,
  KPI,
  KPIRow,
  LoadingSpinner,
} from "@tracepilot/ui";
import { computed } from "vue";
import AgentRecentRuns from "@/components/agentEditor/AgentRecentRuns.vue";
import UsageBreakdownBars, { type BreakdownRow } from "@/components/usage/UsageBreakdownBars.vue";
import UsageDistribution from "@/components/usage/UsageDistribution.vue";
import UsageSparkline from "@/components/usage/UsageSparkline.vue";
import UsageStackedBar, { type StackedSegment } from "@/components/usage/UsageStackedBar.vue";
import { useAgentEditorContext } from "@/composables/useAgentEditor";
import { failureRate } from "@/utils/agents/entries";
import { rangeDays } from "@/utils/agents/range";

const ctx = useAgentEditorContext();

const stats = computed(() => ctx.usage?.stats ?? null);

const outcomes = computed<StackedSegment[]>(() => {
  const value = stats.value;
  if (!value) return [];
  return [
    { key: "completed", label: "Completed", value: value.completed, tone: "success" },
    { key: "failed", label: "Failed", value: value.failed, tone: "danger" },
    { key: "cancelled", label: "Cancelled", value: value.cancelled, tone: "warning" },
    { key: "incomplete", label: "Incomplete", value: value.incomplete, tone: "neutral" },
  ];
});

const dailyRuns = computed(() => {
  const value = stats.value;
  if (!value) return [];
  const byDate = new Map(value.dailyRuns.map((day) => [day.date, day.runs]));
  return rangeDays(ctx.store.range, value.firstUsed).map((date) => byDate.get(date) ?? 0);
});

/** The headline figures, each with the caveat it needs in its tooltip. */
const kpis = computed(() => {
  const value = stats.value;
  if (!value) return [];
  const rate = failureRate(value);
  const credits =
    value.ownNanoAiu != null && value.runsWithCredits > 0
      ? formatAiCredits(calculateObservedAiCredits(value.ownNanoAiu))
      : null;
  return [
    {
      key: "runs",
      label: "Runs",
      value: formatNumber(value.runs),
      description: `Across ${formatNumber(value.sessions)} session${value.sessions === 1 ? "" : "s"}.`,
    },
    {
      key: "duration",
      label: "Median duration",
      value: value.durationMs.p50 != null ? formatDuration(value.durationMs.p50) : "—",
      description:
        value.durationMs.p90 != null
          ? `p90 ${formatDuration(value.durationMs.p90)} over ${formatNumber(value.durationMs.count)} timed runs.`
          : "No run reported a duration.",
    },
    {
      key: "failed",
      label: "Failed or cancelled",
      value:
        value.runs === 0
          ? "—"
          : `${rate >= 0.1 ? Math.round(rate * 100) : (rate * 100).toFixed(1)}%`,
      description: `${formatNumber(value.failed + value.cancelled)} of ${formatNumber(value.runs)} runs.`,
    },
    {
      key: "credits",
      label: "Credits",
      value: credits ?? "—",
      description: credits
        ? `Exclusive to this agent, over ${formatNumber(value.runsWithCredits)} of ${formatNumber(value.runs)} runs that carried the CLI's metrics ledger.`
        : "No run carried the CLI's agent metrics ledger, which is where exclusive credits come from.",
    },
  ];
});

const models = computed<BreakdownRow[]>(
  () =>
    stats.value?.topModels.map((model) => ({
      key: model.label,
      label: model.label,
      value: model.runs,
    })) ?? [],
);

/** Only newer CLI versions record what was configured, so the denominator matters. */
const dispatch = computed<BreakdownRow[]>(
  () =>
    ctx.usage?.dispatch.map((row, index) => ({
      key: `${row.configuredModel}-${row.firstDispatchedModel}-${index}`,
      label: `${row.configuredModel ?? "not recorded"} → ${row.firstDispatchedModel ?? row.actualModel ?? "not recorded"}`,
      value: row.runs,
      detail: row.overrideReason,
      tone:
        row.configuredModel &&
        row.firstDispatchedModel &&
        row.configuredModel !== row.firstDispatchedModel
          ? "warning"
          : "accent",
    })) ?? [],
);

const invokedBy = computed<BreakdownRow[]>(
  () =>
    ctx.usage?.invokedBy.map((row) => ({
      key: row.parent ?? "main",
      label: row.parent ?? "Main agent",
      value: row.runs,
    })) ?? [],
);

const depths = computed<BreakdownRow[]>(
  () =>
    ctx.usage?.depths.map((row) => ({
      key: `depth-${row.value}`,
      label: row.value === 0 ? "Top level" : `Depth ${row.value}`,
      value: row.runs,
    })) ?? [],
);

const parallelism = computed<BreakdownRow[]>(
  () =>
    ctx.usage?.parallelism.map((row) => ({
      key: `par-${row.value}`,
      label: `${row.value} concurrent`,
      value: row.runs,
    })) ?? [],
);

const failures = computed<BreakdownRow[]>(
  () =>
    ctx.usage?.failureReasons.map((row) => ({
      key: row.reason,
      label: row.reason,
      value: row.runs,
      detail: row.example,
      tone: "danger" as const,
    })) ?? [],
);

const repositories = computed<BreakdownRow[]>(
  () =>
    ctx.usage?.repositories.map((row) => ({
      key: row.label,
      label: row.label,
      value: row.runs,
    })) ?? [],
);

const lastRun = computed(() =>
  stats.value?.lastUsed ? formatRelativeTime(stats.value.lastUsed) : null,
);

/** A mismatch is worth opening the section for, so it starts expanded. */
const modelsOpen = computed(() => (stats.value?.mismatchRuns ?? 0) > 0);
</script>

<template>
  <div class="agent-usage">
    <p v-if="ctx.usageError" class="agent-usage__error" role="alert">{{ ctx.usageError }}</p>
    <div v-else-if="ctx.usageLoading && !stats" class="agent-usage__loading">
      <LoadingSpinner size="sm" />
      Loading usage…
    </div>

    <template v-else-if="stats && stats.runs > 0">
      <KPIRow density="compact">
        <KPI
          v-for="kpi in kpis"
          :key="kpi.key"
          density="compact"
          :label="kpi.label"
          :value="kpi.value"
          :description="kpi.description"
        />
      </KPIRow>

      <section class="agent-usage__section">
        <h4 class="agent-usage__title">
          Outcomes
          <span v-if="lastRun" class="agent-usage__denominator">last run {{ lastRun }}</span>
        </h4>
        <UsageStackedBar :segments="outcomes" :total="stats.runs" />
        <UsageSparkline
          v-if="dailyRuns.length > 1"
          class="agent-usage__trend"
          :values="dailyRuns"
          :label="`Daily runs for ${ctx.agentName}`"
          :width="320"
          :height="32"
        />
      </section>

      <section v-if="failures.length" class="agent-usage__section">
        <h4 class="agent-usage__title">Why runs ended early</h4>
        <UsageBreakdownBars :rows="failures" :total="stats.failed + stats.cancelled" />
      </section>

      <details class="agent-usage__more" :open="modelsOpen">
        <summary>Models</summary>
        <div class="agent-usage__more-body">
          <div>
            <h4 class="agent-usage__title">Models actually used</h4>
            <UsageBreakdownBars :rows="models" :total="stats.runs" empty-text="No run recorded a model." />
          </div>
          <div v-if="dispatch.length">
            <h4 class="agent-usage__title">
              Configured vs dispatched
              <span class="agent-usage__denominator">
                {{ formatNumber(stats.runsWithConfiguration) }} of {{ formatNumber(stats.runs) }} runs
              </span>
            </h4>
            <UsageBreakdownBars :rows="dispatch" :total="stats.runsWithConfiguration || stats.runs" />
          </div>
        </div>
      </details>

      <details class="agent-usage__more">
        <summary>Timing, tokens and tool calls</summary>
        <div class="agent-usage__more-body">
          <UsageDistribution title="Duration" :distribution="stats.durationMs" :runs="stats.runs" format="duration" />
          <UsageDistribution
            title="Tokens"
            :distribution="stats.totalTokens"
            :runs="stats.runs"
            format="number"
            note="subagent.completed reports tokens that can include descendant agents, so these are never summed across a hierarchy."
          />
          <UsageDistribution title="Tool calls" :distribution="stats.toolCalls" :runs="stats.runs" format="number" />
        </div>
      </details>

      <details class="agent-usage__more">
        <summary>Where it runs</summary>
        <div class="agent-usage__more-body">
          <div>
            <h4 class="agent-usage__title">Invoked by</h4>
            <UsageBreakdownBars :rows="invokedBy" :total="stats.runs" />
          </div>
          <div>
            <h4 class="agent-usage__title">Nesting depth</h4>
            <UsageBreakdownBars :rows="depths" :total="stats.runs" />
          </div>
          <div>
            <h4 class="agent-usage__title">
              Parallelism
              <span class="agent-usage__denominator">peak {{ stats.peakSiblings }}</span>
            </h4>
            <UsageBreakdownBars :rows="parallelism" :total="stats.runs" />
          </div>
          <div v-if="repositories.length > 1">
            <h4 class="agent-usage__title">Repositories</h4>
            <UsageBreakdownBars :rows="repositories" :total="stats.runs" />
          </div>
        </div>
      </details>

      <section class="agent-usage__section">
        <h4 class="agent-usage__title">Recent runs</h4>
        <AgentRecentRuns :runs="ctx.usage?.recentRuns ?? []" />
      </section>
    </template>

    <p v-else class="agent-usage__empty">
      No runs for this agent in the selected range.
    </p>
  </div>
</template>

<style scoped>
.agent-usage {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.agent-usage__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-usage__trend {
  width: 100%;
}

.agent-usage__title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.agent-usage__denominator {
  font-size: 0.625rem;
  font-weight: 400;
  color: var(--text-tertiary);
}

/* Context you go looking for, rather than a wall of bars on arrival. */
.agent-usage__more > summary {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 0;
  list-style-position: inside;
}

.agent-usage__more > summary:hover {
  color: var(--text-primary);
}

.agent-usage__more-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0 4px;
}

.agent-usage__empty,
.agent-usage__loading {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-usage__error {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--danger-subtle);
  color: var(--danger-fg);
  font-size: 0.75rem;
}
</style>
