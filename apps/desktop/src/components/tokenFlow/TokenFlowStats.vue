<script setup lang="ts">
import { formatCost, formatNumber, StatCard } from "@tracepilot/ui";

defineProps<{
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheHitRate: number;
  modelsUsed: number;
  wholesaleCost: number;
  copilotCost: number;
}>();
</script>

<template>
  <div class="grid-4 mb-6">
    <StatCard :value="formatNumber(totalTokens)" label="Total Tokens" :gradient="true" />
    <StatCard :value="formatNumber(totalInputTokens)" label="Input Tokens" color="accent" />
    <StatCard :value="formatNumber(totalOutputTokens)" label="Output Tokens" color="done" />
    <StatCard :value="`${cacheHitRate.toFixed(1)}%`" label="Cache Hit Rate" color="success" />
  </div>
  <div class="grid-4 mb-6">
    <StatCard :value="modelsUsed" label="Models Used" color="accent" />
    <StatCard :value="formatCost(wholesaleCost)" label="Wholesale Cost" color="warning" />
    <StatCard :value="formatCost(copilotCost)" label="Copilot Cost" color="accent" />
  </div>
</template>
