<script setup lang="ts">
import type { AnalyticsData } from "@tracepilot/types";
import {
  formatAiCredits,
  formatCost,
  formatNumber,
  formatNumberFull,
  StatCard,
} from "@tracepilot/ui";
import type { AnalyticsAiCreditSummary } from "@/utils/analyticsCostSeries";

defineProps<{
  data: AnalyticsData;
  aiCreditSummary: AnalyticsAiCreditSummary | null;
}>();

function sourceLabel(summary: AnalyticsAiCreditSummary | null): string {
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
    <StatCard
      :value="formatAiCredits(aiCreditSummary?.credits)"
      label="AI Credits"
      color="done"
      :tooltip="sourceLabel(aiCreditSummary)"
    />
    <StatCard
      :value="formatCost(aiCreditSummary?.usdEquivalent)"
      label="AIC USD Equivalent"
      color="success"
      :tooltip="sourceLabel(aiCreditSummary)"
    />
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
