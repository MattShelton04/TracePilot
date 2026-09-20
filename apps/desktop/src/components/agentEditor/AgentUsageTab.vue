<script setup lang="ts">
import { calculateObservedAiCredits } from "@tracepilot/types";
import {
  formatAiCredits,
  formatDuration,
  formatNumber,
  formatRelativeTime,
  LoadingSpinner,
} from "@tracepilot/ui";
import { computed } from "vue";
import AgentRecentRuns from "@/components/agentEditor/AgentRecentRuns.vue";
import UsageBreakdownBars, { type BreakdownRow } from "@/components/usage/UsageBreakdownBars.vue";
import UsageMetricDistribution from "@/components/usage/UsageMetricDistribution.vue";
import UsageSparkline from "@/components/usage/UsageSparkline.vue";
import UsageStackedBar, { type StackedSegment } from "@/components/usage/UsageStackedBar.vue";
import { useAgentEditorContext } from "@/composables/useAgentEditor";
import { failureRate } from "@/utils/agents/entries";
import { rangeDays } from "@/utils/agents/range";
import { USAGE_RANGE_LABELS } from "@/utils/usage/range";

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
      note: `${formatNumber(value.sessions)} session${value.sessions === 1 ? "" : "s"}`,
      description: `Across ${formatNumber(value.sessions)} session${value.sessions === 1 ? "" : "s"}.`,
    },
    {
      key: "duration",
      label: "Median duration",
      value: value.durationMs.p50 != null ? formatDuration(value.durationMs.p50) : "—",
      note: `${formatNumber(value.durationMs.count)} timed runs`,
      description:
        value.durationMs.p90 != null
          ? `p90 ${formatDuration(value.durationMs.p90)} over ${formatNumber(value.durationMs.count)} timed runs.`
          : "No run reported a duration.",
    },
    {
      key: "failed",
      label: "Failed or cancelled",
      note: `${formatNumber(value.failed + value.cancelled)} of ${formatNumber(value.runs)} runs`,
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
      note:
        value.runsWithCredits > 0
          ? `Exclusive · ${formatNumber(value.runsWithCredits)} of ${formatNumber(value.runs)} runs`
          : "No ledger recorded",
      description: credits
        ? `Exclusive to this agent, over ${formatNumber(value.runsWithCredits)} of ${formatNumber(value.runs)} runs that carried the CLI's metrics ledger.`
        : "No run carried the CLI's agent metrics ledger, which is where exclusive credits come from.",
    },
  ];
});

// Percentiles retain their reporting denominator for older CLI sessions.
const distributions = computed(() => {
  const value = stats.value;
  if (!value) return [];
  return [
    {
      title: "Duration per run",
      description: "Elapsed time from the start of a run to its end.",
      data: value.durationMs,
      format: formatDuration,
    },
    {
      title: "Tokens per run",
      description:
        "Reported token total; can include descendant agents. This is not the context window size.",
      data: value.totalTokens,
      format: formatNumber,
    },
    {
      title: "Tool calls per run",
      description: "Number of tool calls reported for each run.",
      data: value.toolCalls,
      format: formatNumber,
    },
  ];
});

const models = computed<BreakdownRow[]>(() => {
  const value = stats.value;
  if (!value) return [];
  const rows = value.topModels.map((model) => ({
    key: model.label,
    label: model.label,
    value: model.runs,
  }));
  const missing = value.runs - rows.reduce((sum, row) => sum + row.value, 0);
  if (missing > 0) rows.push({ key: "not-recorded", label: "Not recorded", value: missing });
  return rows;
});

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
  <div class="usage-detail agent-usage">
    <p v-if="ctx.usageError" class="usage-detail__error" role="alert">{{ ctx.usageError }}</p>
    <div v-else-if="ctx.usageLoading && !stats" class="usage-detail__loading">
      <LoadingSpinner size="sm" />
      Loading usage…
    </div>

    <template v-else-if="stats && stats.runs > 0">
      <p class="usage-detail__help">Usage over {{ USAGE_RANGE_LABELS[ctx.store.range] }} · grouped by agent name</p>
      <dl class="usage-detail__summary">
        <div v-for="kpi in kpis" :key="kpi.key" :title="kpi.description">
          <dt>{{ kpi.label }}</dt>
          <dd>{{ kpi.value }}</dd>
          <small>{{ kpi.note }}</small>
        </div>
      </dl>

      <section class="usage-detail__section">
        <h4 class="usage-detail__title">
          Outcomes
          <span v-if="lastRun" class="usage-detail__denominator">last run {{ lastRun }}</span>
        </h4>
        <UsageStackedBar :segments="outcomes" :total="stats.runs" />
        <UsageSparkline
          v-if="dailyRuns.length > 1"
          class="usage-detail__trend"
          :values="dailyRuns"
          :label="`Daily runs for ${ctx.agentName}`"
          :width="320"
          :height="32"
        />
      </section>

      <details class="usage-detail__more" :open="modelsOpen">
        <summary>Models</summary>
        <div class="usage-detail__more-body">
          <div>
            <h4 class="usage-detail__title">Models actually used</h4>
            <p class="usage-detail__help">Share of all runs, including those without a recorded model.</p>
            <UsageBreakdownBars :rows="models" :total="stats.runs" :limit="models.length" empty-text="No run recorded a model." />
          </div>
          <div v-if="dispatch.length">
            <h4 class="usage-detail__title">
              Configured vs dispatched
              <span class="usage-detail__denominator">
                {{ formatNumber(stats.runsWithConfiguration) }} of {{ formatNumber(stats.runs) }} runs
              </span>
            </h4>
            <p class="usage-detail__help">Requested model → model chosen at dispatch. Percentages use runs with configuration recorded.</p>
            <UsageBreakdownBars :rows="dispatch" :total="stats.runsWithConfiguration || stats.runs" />
          </div>
        </div>
      </details>

      <details v-if="failures.length" class="usage-detail__more">
        <summary>Failure reasons <span class="usage-detail__denominator">{{ formatNumber(stats.failed) }} failed runs</span></summary>
        <div class="usage-detail__more-body">
          <UsageBreakdownBars :rows="failures" :total="stats.failed" :limit="10" />
        </div>
      </details>

      <details class="usage-detail__more">
        <summary>Timing, tokens and tool calls</summary>
        <div class="usage-detail__more-body">
          <UsageMetricDistribution
            v-for="metric in distributions"
            :key="metric.title"
            v-bind="metric"
            :runs="stats.runs"
          />
        </div>
      </details>

      <details class="usage-detail__more">
        <summary>Where it runs</summary>
        <div class="usage-detail__more-body">
          <div>
            <h4 class="usage-detail__title">Invoked by</h4>
            <UsageBreakdownBars :rows="invokedBy" :total="stats.runs" />
          </div>
          <div>
            <h4 class="usage-detail__title">Nesting depth</h4>
            <p class="usage-detail__help">Top level means called by the main agent. Each depth adds one layer of subagents.</p>
            <UsageBreakdownBars :rows="depths" :total="stats.runs" />
          </div>
          <div>
            <h4 class="usage-detail__title">
              Concurrent agents
              <span class="usage-detail__denominator">peak {{ stats.peakSiblings }}</span>
            </h4>
            <p class="usage-detail__help">Agents running at the same time under the same parent, including this run.</p>
            <UsageBreakdownBars :rows="parallelism" :total="stats.runs" />
          </div>
          <div v-if="repositories.length > 1">
            <h4 class="usage-detail__title">Repositories</h4>
            <UsageBreakdownBars :rows="repositories" :total="stats.runs" />
          </div>
        </div>
      </details>

      <section class="usage-detail__section">
        <h4 class="usage-detail__title">Recent runs</h4>
        <AgentRecentRuns :runs="ctx.usage?.recentRuns ?? []" />
      </section>
    </template>

    <p v-else class="usage-detail__empty">
      No runs for this agent in the selected range.
    </p>
  </div>
</template>

<style src="../usage/usage-detail.css"></style>
