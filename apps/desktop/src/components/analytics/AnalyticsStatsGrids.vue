<script setup lang="ts">
import { type AnalyticsData, sourceCapabilities, sourceLabel } from "@tracepilot/types";
import {
  formatAiCredits,
  formatCost,
  formatNumber,
  formatNumberFull,
  StatCard,
} from "@tracepilot/ui";
import { computed } from "vue";
import {
  type AnalyticsAiCreditSummary,
  buildSourceCostRows,
  combinedCostTotal,
} from "@/utils/analyticsCostSeries";

const props = defineProps<{
  data: AnalyticsData;
  aiCreditSummary: AnalyticsAiCreditSummary | null;
}>();

/** A single source that is priced in USD rather than AI Credits. */
const usdSource = computed(() => {
  const entries = props.data.costBySource ?? [];
  const [only] = entries;
  return entries.length === 1 && !sourceCapabilities(only.source).hasAic ? only : null;
});

/**
 * With several sources, the AI Credit card covers only the sources billed in
 * them, and the cost card adds every source together in USD.
 */
const creditScope = computed(() => {
  const entries = props.data.costBySource ?? [];
  const billed = entries.filter((e) => sourceCapabilities(e.source).hasAic);
  if (billed.length === 0 || billed.length === entries.length) return null;
  return billed.map((e) => sourceLabel(e.source)).join(", ");
});

const sourceRows = computed(() =>
  creditScope.value ? buildSourceCostRows(props.data, props.aiCreditSummary) : [],
);
const combined = computed(() => combinedCostTotal(sourceRows.value));

const combinedTooltip = computed(() => {
  const parts = sourceRows.value.map(
    (row) =>
      `${sourceLabel(row.source)} ${row.usdEquivalent == null ? "unpriced" : formatCost(row.usdEquivalent)}`,
  );
  const partial = combined.value.partial ? " Partial: some usage could not be priced." : "";
  return `${parts.join(" + ")}. AI Credits count at $0.01 each.${partial}`;
});

const usdTooltip = computed(() => {
  const entry = usdSource.value;
  if (!entry) return "";
  const partial =
    entry.costUsd != null && entry.sessionsWithCostUsd < entry.sessions
      ? " Partial: some sessions could not be priced."
      : "";
  return `API-equivalent USD from ${sourceLabel(entry.source)} usage.${partial}`;
});

function aiCreditTooltip(summary: AnalyticsAiCreditSummary | null): string {
  if (!summary) return "";
  const partial = summary.isPartial ? " Partial total: some models could not be priced." : "";
  if (summary.source === "observed") return `Observed Copilot billing telemetry.${partial}`;
  if (summary.source === "mixed-observed-estimated") {
    return `Observed AIC merged with estimates for historical sessions.${partial}`;
  }
  if (summary.source === "estimated-token-usage") {
    return `Estimated from GitHub token rates.${partial}`;
  }
  if (summary.source === "estimated-direct-api") {
    return `Estimated from direct API rates.${partial}`;
  }
  return "No AIC or compatible token pricing data";
}
</script>

<template>
  <!-- Stats Row -->
  <div class="grid-4 mb-4">
    <StatCard :value="formatNumberFull(data.totalSessions)" label="Total Sessions" />
    <StatCard :value="formatNumber(data.totalTokens)" label="Total Tokens" :gradient="true" />
    <template v-if="usdSource">
      <StatCard
        :value="usdSource.costUsd == null ? '—' : formatCost(usdSource.costUsd)"
        label="Estimated Cost"
        color="success"
        :tooltip="usdTooltip"
      />
      <StatCard
        :value="`${formatNumberFull(usdSource.sessionsWithCostUsd)} of ${formatNumberFull(usdSource.sessions)}`"
        label="Priced Sessions"
        color="done"
        tooltip="Sessions whose usage could be priced in USD"
      />
    </template>
    <template v-else-if="creditScope">
      <StatCard
        :value="formatAiCredits(aiCreditSummary?.credits)"
        :label="`AI Credits (${creditScope})`"
        color="done"
        :tooltip="`${aiCreditTooltip(aiCreditSummary)} Covers ${creditScope} sessions only.`"
      />
      <StatCard
        :value="combined.usd == null ? '—' : formatCost(combined.usd)"
        label="Total Cost (USD)"
        color="success"
        :tooltip="combinedTooltip"
      />
    </template>
    <template v-else>
      <StatCard
        :value="formatAiCredits(aiCreditSummary?.credits)"
        label="AI Credits"
        color="done"
        :tooltip="aiCreditTooltip(aiCreditSummary)"
      />
      <StatCard
        :value="aiCreditSummary?.usdEquivalent == null ? '—' : formatCost(aiCreditSummary.usdEquivalent)"
        label="AIC USD Equivalent"
        color="success"
        :tooltip="aiCreditTooltip(aiCreditSummary)"
      />
    </template>
  </div>

  <!-- Incident Stats -->
  <div class="grid-4 mb-4">
    <StatCard
      class="stat-card--incident-error"
      variant="plain"
      accent-color="var(--danger-fg)"
      :value="formatNumberFull(data.sessionsWithErrors)"
      label="Sessions with Errors"
    />
    <StatCard
      class="stat-card--incident-ratelimit"
      variant="plain"
      accent-color="var(--warning-fg)"
      :value="formatNumberFull(data.totalRateLimits)"
      label="Total Rate Limits"
    />
    <StatCard
      class="stat-card--incident-compaction"
      variant="plain"
      accent-color="var(--chart-secondary)"
      :value="formatNumberFull(data.totalCompactions)"
      label="Total Compactions"
    />
    <StatCard
      class="stat-card--incident-truncation"
      variant="plain"
      accent-color="var(--text-tertiary)"
      :value="formatNumberFull(data.totalTruncations)"
      label="Total Truncations"
    />
  </div>
</template>

<style scoped>
.stat-card--incident-error {
  background: color-mix(in srgb, var(--danger-fg) 6%, var(--canvas-subtle));
}

.stat-card--incident-ratelimit {
  background: color-mix(in srgb, var(--warning-fg) 6%, var(--canvas-subtle));
}

.stat-card--incident-compaction {
  background: color-mix(in srgb, var(--chart-secondary) 6%, var(--canvas-subtle));
}

.stat-card--incident-truncation {
  background: color-mix(in srgb, var(--text-tertiary) 6%, var(--canvas-subtle));
}
</style>
