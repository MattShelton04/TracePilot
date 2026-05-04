<script setup lang="ts">
import type { ShutdownMetrics } from "@tracepilot/types";
import { formatCost, formatDuration, formatNumber, StatCard } from "@tracepilot/ui";

defineProps<{
  metrics: ShutdownMetrics;
  totalRequests: number;
  copilotCost: number;
  totalUsageBasedCost: number;
  hasUsageBasedUnknowns: boolean;
  totalWholesaleCost: number;
  june2026PreviewDelta: number;
  observedAiuCost: number | null;
  totalTokens: number;
}>();

function formatSignedCost(value: number): string {
  const formatted = formatCost(Math.abs(value));
  if (value === 0) return formatted;
  return `${value > 0 ? "+" : "-"}${formatted}`;
}
</script>

<template>
  <div class="grid-4 mb-6">
    <StatCard :value="totalRequests" label="Total Requests" color="accent" />
    <StatCard :value="metrics.totalPremiumRequests?.toFixed(1) ?? '—'" label="Premium Requests" color="accent" />
    <StatCard :value="formatCost(copilotCost)" label="Legacy Copilot" color="warning" tooltip="Legacy premium-request estimate: premium requests × local cost per premium request." />
    <StatCard :value="hasUsageBasedUnknowns ? '—' : formatCost(totalUsageBasedCost)" label="GitHub Copilot (usage)" color="done" tooltip="June 2026 usage-based estimate using GitHub Copilot token rates. Unknown models are not silently priced." />
  </div>

  <div class="grid-4 mb-6">
    <StatCard :value="formatCost(totalWholesaleCost)" label="Direct API (estimate)" color="done" tooltip="Local token-rate estimate. Defaults mirror GitHub's published Copilot usage rates for documented models; Settings overrides can intentionally diverge." />
    <StatCard
      v-if="!hasUsageBasedUnknowns && (totalUsageBasedCost > 0 || copilotCost > 0)"
      :value="formatSignedCost(june2026PreviewDelta)"
      label="Est. change after Jun 2026"
      :color="june2026PreviewDelta >= 0 ? 'warning' : 'done'"
      tooltip="GitHub Copilot usage estimate minus the legacy premium-request estimate. Positive means usage-based costs more than legacy."
    />
    <StatCard :value="formatNumber(totalTokens)" label="Total Tokens" :gradient="true" />
    <StatCard :value="formatDuration(metrics.totalApiDurationMs)" label="API Duration" color="done" />
  </div>

  <div v-if="observedAiuCost != null" class="grid-2 mb-6">
    <StatCard :value="formatCost(observedAiuCost)" label="Observed AI Credits" color="accent" tooltip="Observed totalNanoAiu converted as nano AI Credits at 1 AI Credit = $0.01. Treat as telemetry until real-session billing semantics are confirmed." />
  </div>

  <p class="cost-legend mb-6">
    Legacy: premium requests · Copilot usage: token billing · Direct API: local token-rate estimate.
  </p>
</template>

<style scoped>
.cost-legend {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.4;
}
</style>
