<script setup lang="ts">
import type { ShutdownMetrics } from "@tracepilot/types";
import { formatCost, formatDuration, formatNumber, StatCard } from "@tracepilot/ui";

defineProps<{
  metrics: ShutdownMetrics;
  totalRequests: number;
  copilotCost: number;
  totalWholesaleCost: number;
  totalTokens: number;
}>();
</script>

<template>
  <div class="grid-4 mb-6">
    <StatCard :value="totalRequests" label="Total Requests" color="accent" />
    <StatCard :value="metrics.totalPremiumRequests?.toFixed(1) ?? '—'" label="Premium Requests" color="accent" />
    <StatCard :value="formatCost(copilotCost)" label="Copilot Cost" color="warning" />
    <StatCard :value="formatCost(totalWholesaleCost)" label="Wholesale Cost" color="done" tooltip="Estimated cost if this usage went through direct API access instead of GitHub Copilot, based on per-model token pricing configured in Settings." />
  </div>

  <div class="grid-2 mb-6">
    <StatCard :value="formatNumber(totalTokens)" label="Total Tokens" :gradient="true" />
    <StatCard :value="formatDuration(metrics.totalApiDurationMs)" label="API Duration" color="done" />
  </div>
</template>
