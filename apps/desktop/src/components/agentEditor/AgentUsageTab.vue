<script setup lang="ts">
/**
 * Cross-session usage for one agent. Every figure is scoped to the range
 * selected on the manager, and denominators are shown wherever older CLI
 * versions report a metric on only some runs.
 */
import { calculateObservedAiCredits } from "@tracepilot/types";
import { formatAiCredits, formatNumber, LoadingSpinner } from "@tracepilot/ui";
import { computed } from "vue";
import AgentRecentRuns from "@/components/agentEditor/AgentRecentRuns.vue";
import UsageBreakdownBars, { type BreakdownRow } from "@/components/usage/UsageBreakdownBars.vue";
import UsageDistribution from "@/components/usage/UsageDistribution.vue";
import UsageSparkline from "@/components/usage/UsageSparkline.vue";
import { useAgentEditorContext } from "@/composables/useAgentEditor";
import { rangeDays } from "@/utils/agents/range";

const ctx = useAgentEditorContext();

const stats = computed(() => ctx.usage?.stats ?? null);

const outcomes = computed<BreakdownRow[]>(() => {
  const value = stats.value;
  if (!value) return [];
  return (
    [
      { key: "completed", label: "Completed", value: value.completed, tone: "success" },
      { key: "failed", label: "Failed", value: value.failed, tone: "danger" },
      { key: "cancelled", label: "Cancelled", value: value.cancelled, tone: "warning" },
      { key: "incomplete", label: "Incomplete", value: value.incomplete, tone: "neutral" },
    ] as BreakdownRow[]
  ).filter((row) => row.value > 0);
});

const dailyRuns = computed(() => {
  const value = stats.value;
  if (!value) return [];
  const byDate = new Map(value.dailyRuns.map((day) => [day.date, day.runs]));
  return rangeDays(ctx.store.range, value.firstUsed).map((date) => byDate.get(date) ?? 0);
});

const models = computed<BreakdownRow[]>(
  () =>
    stats.value?.topModels.map((model) => ({
      key: model.label,
      label: model.label,
      value: model.runs,
    })) ?? [],
);

/** Only 1.0.83+ records what was configured, so the denominator matters. */
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

const credits = computed(() => {
  const value = stats.value;
  if (!value || value.ownNanoAiu == null || value.runsWithCredits === 0) return null;
  const credits = formatAiCredits(calculateObservedAiCredits(value.ownNanoAiu));
  return `${credits} over ${formatNumber(value.runsWithCredits)} of ${formatNumber(value.runs)} runs`;
});
</script>

<template>
  <div class="agent-usage">
    <p v-if="ctx.usageError" class="agent-usage__error" role="alert">{{ ctx.usageError }}</p>
    <div v-else-if="ctx.usageLoading && !stats" class="agent-usage__loading">
      <LoadingSpinner size="sm" />
      Loading usage…
    </div>

    <template v-else-if="stats && stats.runs > 0">
      <section class="agent-usage__head">
        <div>
          <span class="agent-usage__runs">{{ formatNumber(stats.runs) }}</span>
          <span class="agent-usage__runs-label">
            runs across {{ formatNumber(stats.sessions) }} session{{ stats.sessions === 1 ? "" : "s" }}
          </span>
        </div>
        <UsageSparkline
          v-if="dailyRuns.length > 1"
          :values="dailyRuns"
          :label="`Daily runs for ${ctx.agentName}`"
          :width="140"
          :height="28"
        />
      </section>

      <section class="agent-usage__section">
        <h4 class="agent-usage__title">Outcomes</h4>
        <UsageBreakdownBars :rows="outcomes" :total="stats.runs" />
      </section>

      <section class="agent-usage__grid">
        <UsageDistribution title="Duration" :distribution="stats.durationMs" :runs="stats.runs" format="duration" />
        <UsageDistribution
          title="Tokens"
          :distribution="stats.totalTokens"
          :runs="stats.runs"
          format="number"
          note="subagent.completed reports tokens that can include descendant agents, so these are never summed across a hierarchy."
        />
        <UsageDistribution title="Tool calls" :distribution="stats.toolCalls" :runs="stats.runs" format="number" />
      </section>

      <section class="agent-usage__section">
        <h4 class="agent-usage__title">Models actually used</h4>
        <UsageBreakdownBars :rows="models" :total="stats.runs" empty-text="No run recorded a model." />
      </section>

      <section v-if="dispatch.length" class="agent-usage__section">
        <h4 class="agent-usage__title">
          Configured vs dispatched
          <span class="agent-usage__denominator">
            {{ formatNumber(stats.runsWithConfiguration) }} of {{ formatNumber(stats.runs) }} runs recorded a configuration
          </span>
        </h4>
        <UsageBreakdownBars :rows="dispatch" :total="stats.runsWithConfiguration || stats.runs" />
      </section>

      <section class="agent-usage__grid">
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
            <span class="agent-usage__denominator">peak {{ stats.peakSiblings }} concurrent siblings</span>
          </h4>
          <UsageBreakdownBars :rows="parallelism" :total="stats.runs" />
        </div>
      </section>

      <section v-if="failures.length" class="agent-usage__section">
        <h4 class="agent-usage__title">Failure reasons</h4>
        <UsageBreakdownBars :rows="failures" :total="stats.failed + stats.cancelled" />
      </section>

      <section v-if="repositories.length > 1" class="agent-usage__section">
        <h4 class="agent-usage__title">Repositories</h4>
        <UsageBreakdownBars :rows="repositories" :total="stats.runs" />
      </section>

      <p v-if="credits" class="agent-usage__credits">
        Exclusive credits: {{ credits }} (from the CLI's agent metrics ledger, 1.0.83+).
      </p>
      <p v-else class="agent-usage__credits">
        No run carried an agent metrics ledger, so exclusive credits are unavailable.
      </p>

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
  gap: 18px;
}

.agent-usage__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.agent-usage__runs {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.agent-usage__runs-label {
  margin-left: 6px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.agent-usage__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-usage__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
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

.agent-usage__credits,
.agent-usage__empty,
.agent-usage__loading {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-usage__error {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--danger-subtle);
  color: var(--danger-fg);
  font-size: 0.75rem;
}
</style>
