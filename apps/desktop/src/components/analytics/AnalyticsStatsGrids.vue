<script setup lang="ts">
import type { AnalyticsData } from "@tracepilot/types";
import { formatCost, formatNumber, formatNumberFull, StatCard } from "@tracepilot/ui";

defineProps<{
  data: AnalyticsData;
  copilotCost: number;
  totalWholesaleCost: number;
}>();
</script>

<template>
  <!-- Stats Row -->
  <div class="grid-4 mb-4">
    <StatCard :value="formatNumberFull(data.totalSessions)" label="Total Sessions" />
    <StatCard :value="formatNumber(data.totalTokens)" label="Total Tokens" :gradient="true" />
    <StatCard :value="formatCost(copilotCost)" label="Legacy Copilot Cost" color="warning" />
    <StatCard :value="formatCost(totalWholesaleCost)" label="Direct API Estimate" color="done" tooltip="Local token-rate estimate. Defaults mirror GitHub's published Copilot usage rates for documented models; Settings overrides can intentionally diverge." />
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
