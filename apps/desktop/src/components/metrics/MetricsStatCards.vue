<script setup lang="ts">
import type { AiCreditUsage, ShutdownMetrics } from "@tracepilot/types";
import {
  Badge,
  formatAiCredits,
  formatAiCreditsUsd,
  formatCost,
  formatNumber,
  StatCard,
} from "@tracepilot/ui";
import { computed } from "vue";
import { usageCheckpointCredits } from "@/composables/useSessionMetrics";
import { DURATION_HINTS, formatRecordedDuration } from "@/utils/sessionDurations";
import { formatSessionCost, type SessionCostEstimate } from "@/utils/sourceCost";

const props = defineProps<{
  metrics: ShutdownMetrics;
  totalRequests: number;
  copilotCost: number;
  totalWholesaleCost: number | null;
  aiCreditUsage: AiCreditUsage;
  totalTokens: number | null;
  /** USD estimate for sources not billed in AI Credits; replaces the credit cards. */
  sourceCost?: SessionCostEstimate | null;
}>();

const checkpoint = computed(() => usageCheckpointCredits(props.metrics));

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
        :value="formatAiCreditsUsd(aiCreditUsage.credits)"
        :label="aiCreditUsage.source === 'observed' || aiCreditUsage.source === 'unavailable' ? 'Cost' : 'Cost (estimate)'"
        color="accent"
        :tooltip="`${sourceLabel(aiCreditUsage.source)}. AI Credits count at $0.01 each.`"
      />
      <StatCard :value="formatAiCredits(aiCreditUsage.credits)" label="AI Credits" :tooltip="sourceLabel(aiCreditUsage.source)" />
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
      <template v-if="checkpoint">
        <span data-testid="usage-checkpoint" title="Session totals from the CLI's latest usage checkpoint, written when the agent last went idle. The per-model rows cover completed runs only."> · Usage checkpoint {{ new Date(checkpoint.timestamp).toLocaleString() }}</span>
        <span v-if="checkpoint.unattributedCredits != null" data-testid="unattributed-credits"> · {{ formatAiCredits(checkpoint.unattributedCredits) }}{{ metrics.sessionSegments?.length ? " since the last shutdown" : "" }} not yet attributed to a model</span>
      </template>
      <span v-else-if="metrics.metricsTimestamp" title="Usage through this shutdown; later activity is not included"> · Shutdown {{ new Date(metrics.metricsTimestamp).toLocaleString() }}</span>
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
