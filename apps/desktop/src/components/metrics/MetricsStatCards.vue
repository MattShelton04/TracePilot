<script setup lang="ts">
import type { AiCreditUsage, ShutdownMetrics } from "@tracepilot/types";
import { Badge, formatAiCredits, formatCost, formatNumber, StatCard } from "@tracepilot/ui";
import { DURATION_HINTS, formatRecordedDuration } from "@/utils/sessionDurations";
import { formatSessionCost, type SessionCostEstimate } from "@/utils/sourceCost";

defineProps<{
  metrics: ShutdownMetrics;
  totalRequests: number;
  copilotCost: number;
  totalWholesaleCost: number | null;
  aiCreditUsage: AiCreditUsage;
  totalTokens: number | null;
  /** USD estimate for sources not billed in AI Credits; replaces the credit cards. */
  sourceCost?: SessionCostEstimate | null;
}>();

function sourceLabel(source: AiCreditUsage["source"]): string {
  if (source === "observed") return "Observed by Copilot CLI";
  if (source === "estimated-token-usage") return "Estimated from GitHub token rates";
  if (source === "estimated-direct-api") return "Estimated from local token rates";
  return "Unavailable";
}
</script>

<template>
  <template v-if="sourceCost">
    <div class="grid-4 mb-6">
      <StatCard
        :value="formatSessionCost(sourceCost)"
        label="Est. Cost (USD)"
        color="accent"
        :trend="sourceCost.basisLabel"
        :tooltip="sourceCost.coverage"
      />
      <StatCard :value="totalTokens == null ? '—' : formatNumber(totalTokens)" label="Total Tokens" :gradient="true" tooltip="Input + output, including cache and reasoning tokens" />
      <StatCard :value="totalRequests" label="Recorded Requests" color="done" tooltip="Model calls recorded in the transcript" />
      <StatCard :value="formatRecordedDuration(metrics.totalApiDurationMs)" label="API Time" color="done" :tooltip="`${DURATION_HINTS.apiTime} ${metrics.coverage?.snapshotLine == null ? 'Estimated from transcript timestamps.' : 'Reported with the last cost snapshot.'}`" />
    </div>
    <p class="cost-legend mb-6" data-testid="source-cost-legend">
      <Badge v-if="sourceCost.partial" variant="warning">Partial</Badge>
      {{ sourceCost.coverage }}
    </p>
  </template>

  <template v-else>
    <div class="grid-4 mb-6">
      <StatCard
        :value="formatAiCredits(aiCreditUsage.credits)"
        :label="aiCreditUsage.source === 'observed' || aiCreditUsage.source === 'unavailable' ? 'AI Credits' : 'AI Credits (estimate)'"
        color="accent"
        :tooltip="sourceLabel(aiCreditUsage.source)"
      />
      <StatCard :value="aiCreditUsage.usdEquivalent != null ? formatCost(aiCreditUsage.usdEquivalent) : '—'" label="AIC USD equivalent" :tooltip="sourceLabel(aiCreditUsage.source)" />
      <StatCard :value="totalTokens == null ? '—' : formatNumber(totalTokens)" label="Total Tokens" :gradient="true" tooltip="Input + output, including cache and reasoning tokens" />
      <StatCard :value="formatRecordedDuration(metrics.totalApiDurationMs)" label="API Time" color="done" :tooltip="DURATION_HINTS.apiTime" />
    </div>

    <div v-if="aiCreditUsage.source === 'unavailable'" class="grid-4 mb-6">
      <StatCard :value="totalRequests" label="Total Requests" color="accent" />
      <StatCard :value="metrics.totalPremiumRequests?.toFixed(1) ?? '—'" label="Legacy Premium Requests" color="warning" />
      <StatCard :value="formatCost(copilotCost)" label="Legacy Cost Estimate" color="warning" />
      <StatCard :value="totalWholesaleCost != null ? formatCost(totalWholesaleCost) : '—'" label="Direct API Estimate" color="done" />
    </div>

    <p class="cost-legend mb-6">
      {{ sourceLabel(aiCreditUsage.source) }}
      <span v-if="metrics.metricsTimestamp" title="Usage through this shutdown; later activity is not included"> · Shutdown {{ new Date(metrics.metricsTimestamp).toLocaleString() }}</span>
    </p>
  </template>
</template>

<style scoped>
.cost-legend {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.4;
}
</style>
