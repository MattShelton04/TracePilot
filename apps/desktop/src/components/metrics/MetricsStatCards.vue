<script setup lang="ts">
import type { AiCreditUsage, ShutdownMetrics } from "@tracepilot/types";
import {
  formatAiCredits,
  formatCost,
  formatDuration,
  formatNumber,
  StatCard,
} from "@tracepilot/ui";

defineProps<{
  metrics: ShutdownMetrics;
  totalRequests: number;
  copilotCost: number;
  totalWholesaleCost: number;
  aiCreditUsage: AiCreditUsage;
  totalTokens: number;
}>();

function sourceLabel(source: AiCreditUsage["source"]): string {
  if (source === "observed") return "Observed by Copilot CLI";
  if (source === "estimated-token-usage") return "Estimated from GitHub token rates";
  if (source === "estimated-direct-api") return "Estimated from local token rates";
  return "Unavailable";
}
</script>

<template>
  <div class="grid-4 mb-6">
    <StatCard
      :value="formatAiCredits(aiCreditUsage.credits)"
      :label="aiCreditUsage.source === 'observed' ? 'AI Credits' : 'AI Credits (estimate)'"
      color="accent"
      :tooltip="sourceLabel(aiCreditUsage.source)"
    />
    <StatCard :value="aiCreditUsage.usdEquivalent != null ? formatCost(aiCreditUsage.usdEquivalent) : '—'" label="AIC USD equivalent" :tooltip="sourceLabel(aiCreditUsage.source)" />
    <StatCard :value="formatNumber(totalTokens)" label="Total Tokens" :gradient="true" />
    <StatCard :value="formatDuration(metrics.totalApiDurationMs)" label="API Duration" color="done" />
  </div>

  <div v-if="aiCreditUsage.source === 'unavailable'" class="grid-4 mb-6">
    <StatCard :value="totalRequests" label="Total Requests" color="accent" />
    <StatCard :value="metrics.totalPremiumRequests?.toFixed(1) ?? '—'" label="Legacy Premium Requests" color="warning" />
    <StatCard :value="formatCost(copilotCost)" label="Legacy Cost Estimate" color="warning" />
    <StatCard :value="totalWholesaleCost > 0 ? formatCost(totalWholesaleCost) : '—'" label="Direct API Estimate" color="done" />
  </div>

  <p class="cost-legend mb-6">
    {{ sourceLabel(aiCreditUsage.source) }}
  </p>
</template>

<style scoped>
.cost-legend {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.4;
}
</style>
