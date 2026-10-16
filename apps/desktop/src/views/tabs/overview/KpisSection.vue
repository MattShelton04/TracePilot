<script setup lang="ts">
/** Overview: the headline KPI row — turns, duration, changes, calls and cost. */
import { formatAiCredits, formatAiCreditsUsd } from "@tracepilot/ui";
import { computed } from "vue";
import SessionOverviewKpis, {
  type OverviewCost,
} from "@/components/overview/SessionOverviewKpis.vue";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { allowsAiCreditEstimate, usageCheckpointCredits } from "@/composables/useSessionMetrics";
import { usePreferencesStore } from "@/stores/preferences";
import { formatSessionCost, formatUsd, sessionCostEstimate } from "@/utils/sourceCost";
import { useOverviewModel } from "./overviewModel";

const {
  store,
  detail,
  metrics,
  codeChanges,
  source,
  capabilities,
  activeNow,
  spanMs,
  turnCount,
  outcomeStatus,
} = useOverviewModel();
const prefs = usePreferencesStore();
const { aiCreditUsage } = useMetricsTabData(
  metrics,
  prefs,
  () => !allowsAiCreditEstimate(source.value),
);

const cost = computed<OverviewCost>(() => {
  const turns = turnCount.value;
  if (!capabilities.value.hasAic) {
    const estimate = sessionCostEstimate(source.value, metrics.value);
    return {
      label: "Est. cost",
      value: formatSessionCost(estimate),
      basis: estimate.basisLabel,
      partial: estimate.partial,
      perTurn: estimate.amount != null && turns > 0 ? formatUsd(estimate.amount / turns) : null,
      tooltip: estimate.coverage,
    };
  }
  const { credits, source: creditSource } = aiCreditUsage.value;
  // A running session's totals come from its latest usage checkpoint.
  const checkpoint = creditSource === "observed" && usageCheckpointCredits(metrics.value);
  return {
    label: creditSource === "observed" || credits == null ? "Cost" : "Est. cost",
    value: formatAiCreditsUsd(credits),
    basis:
      credits == null
        ? "Not recorded"
        : creditSource === "observed"
          ? "Observed billing"
          : "Estimated",
    partial: false,
    perTurn: credits != null && turns > 0 ? formatAiCreditsUsd(credits / turns) : null,
    tooltip: `${
      creditSource === "observed"
        ? "Observed Copilot billing telemetry"
        : "Estimated for historical session data"
    }${checkpoint ? " through the latest usage checkpoint" : ""}${
      credits == null ? "" : `: ${formatAiCredits(credits)} at $0.01 each`
    }.`,
  };
});
</script>

<template>
  <SessionOverviewKpis
    v-if="detail"
    class="mb-4"
    :turn-count="turnCount"
    :event-count="detail.eventCount ?? 0"
    :span-ms="spanMs"
    :api-ms="metrics?.totalApiDurationMs"
    :tool-ms="metrics?.totalToolDurationMs"
    :running="activeNow"
    :code-changes="codeChanges"
    :calls="metrics?.coverage?.recordedCalls ?? null"
    :checkpoints="capabilities.hasCheckpoints ? (detail.checkpointCount ?? 0) : null"
    :file-snapshots="store.fileHistory.length"
    :cost="cost"
    :metrics-status="outcomeStatus.metrics"
  />
</template>
