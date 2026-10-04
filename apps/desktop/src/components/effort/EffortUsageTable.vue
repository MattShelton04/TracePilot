<script setup lang="ts">
import type { EffortUsageEntry } from "@tracepilot/types";
import { Badge, DataTable, formatAiCredits, formatDuration, formatNumber } from "@tracepilot/ui";
import { computed } from "vue";
import { effortCoverage, effortRows } from "@/utils/effortUsage";

const props = defineProps<{
  entries: readonly EffortUsageEntry[];
  /** Show how many sessions each row draws on (cross-session views). */
  showSessions?: boolean;
}>();

const rows = computed(() => effortRows(props.entries));
const coverage = computed(() => effortCoverage(props.entries));

const columns = computed(() => [
  { key: "model", label: "Model" },
  { key: "effort", label: "Effort" },
  ...(props.showSessions ? [{ key: "sessions", label: "Sessions", align: "right" as const }] : []),
  { key: "userTurns", label: "User turns", align: "right" as const },
  { key: "requestsPerTurn", label: "Requests / turn", align: "right" as const },
  { key: "toolCallsPerTurn", label: "Tool calls / turn", align: "right" as const },
  { key: "wallMsPerTurn", label: "Time / turn", align: "right" as const },
  { key: "reasoningTokensPerTurn", label: "Reasoning tokens / turn", align: "right" as const },
  { key: "apiMsPerTurn", label: "API time / turn", align: "right" as const },
  { key: "creditsPerTurn", label: "AI Credits / turn", align: "right" as const },
]);

function decimal(value: unknown): string {
  return typeof value === "number" ? value.toFixed(1) : "—";
}
</script>

<template>
  <div class="effort-usage">
    <DataTable :columns="columns" :rows="rows as unknown as Record<string, unknown>[]" style="overflow-x: auto;">
      <template #cell-model="{ value }"><Badge variant="done">{{ value }}</Badge></template>
      <template #cell-effort="{ value }"><Badge variant="neutral">{{ value }}</Badge></template>
      <template #cell-sessions="{ value }">{{ formatNumber(value as number) }}</template>
      <template #cell-userTurns="{ value }">{{ formatNumber(value as number) }}</template>
      <template #cell-requestsPerTurn="{ value }">{{ decimal(value) }}</template>
      <template #cell-toolCallsPerTurn="{ value }">{{ decimal(value) }}</template>
      <template #cell-wallMsPerTurn="{ value }">{{ formatDuration(value as number) }}</template>
      <template #cell-reasoningTokensPerTurn="{ value }">
        {{ value == null ? "—" : formatNumber(Math.round(value as number)) }}
      </template>
      <template #cell-apiMsPerTurn="{ value }">
        {{ value == null ? "—" : formatDuration(value as number) }}
      </template>
      <template #cell-creditsPerTurn="{ value }">
        {{ value == null ? "—" : formatAiCredits(value as number) }}
      </template>
    </DataTable>
    <p class="effort-usage-note">
      A user turn is everything from one message you typed until the next. Steering
      messages, tool iterations and system notifications stay in the turn they belong to.
      <template v-if="coverage.observed > 0">
        Reasoning tokens, API time and AI Credits are the main agent's recorded requests
        (subagents excluded), from Copilot CLI's session store, covering
        {{ formatNumber(coverage.observed) }} of {{ formatNumber(coverage.total) }} user turns.
      </template>
      <template v-else>
        Reasoning tokens, API time and AI Credits need request records from Copilot CLI's
        session store (CLI 1.0.69+), which none of these user turns have.
      </template>
    </p>
  </div>
</template>

<style scoped>
.effort-usage :deep(td) {
  white-space: nowrap;
}

.effort-usage-note {
  margin-top: 8px;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-tertiary);
}
</style>
