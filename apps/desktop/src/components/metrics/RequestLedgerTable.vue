<script setup lang="ts">
/**
 * The recorded-request table, on the shared `DataTable`.
 *
 * Columns are dropped by viewport width, never values: everything hidden here
 * stays reachable in the row's expanded detail. A missing counter renders as
 * a labelled em dash so it never reads as a recorded zero.
 */
import type { StoredRequest } from "@tracepilot/types";
import { DataTable, type DataTableColumn, formatDate, formatTime } from "@tracepilot/ui";
import { computed } from "vue";
import {
  agentLabel,
  type CounterCell,
  counterCell,
  formatNanoAiu,
  millisecondCell,
  NOT_RECORDED_HINT,
  requestKey,
  textCell,
} from "@/utils/requestLedger";

const props = defineProps<{ requests: StoredRequest[]; expandedKeys: readonly string[] }>();
const emit = defineEmits<{ toggle: [key: string] }>();
defineSlots<{ expanded(props: { request: StoredRequest }): unknown }>();

/** `md` columns appear from 1200px, `xl` from 1800px; both are in the detail too. */
const COLUMNS: DataTableColumn[] = [
  { key: "recorded", label: "Recorded" },
  { key: "model", label: "Model" },
  { key: "agent", label: "Agent", class: "ledger-col--md" },
  { key: "input", label: "Input", align: "right" },
  { key: "output", label: "Output", align: "right" },
  { key: "cacheRead", label: "Cache reads", align: "right", class: "ledger-col--md" },
  { key: "credits", label: "AI credits", align: "right" },
  { key: "duration", label: "Duration", align: "right" },
  { key: "firstOutput", label: "First output", align: "right", class: "ledger-col--xl" },
  { key: "finish", label: "Completion", class: "ledger-col--md" },
];

/** Columns whose value may be absent, rendered through `CounterCell`. */
const CELL_KEYS = ["agent", "input", "output", "cacheRead", "duration", "firstOutput", "finish"];

/**
 * A resumed session can span days; bare times would then appear to run
 * backwards across midnight, so the date joins them whenever the page spans
 * more than one day.
 */
const spansDays = computed(
  () =>
    new Set(
      props.requests
        .filter((request) => request.recordedAt)
        .map((request) => new Date(request.recordedAt as string).toDateString()),
    ).size > 1,
);

const rows = computed(() =>
  props.requests.map((request) => ({
    key: requestKey(request),
    request,
    recorded: request.recordedAt
      ? (spansDays.value ? formatDate : formatTime)(request.recordedAt)
      : "—",
    model: request.model,
    credits: formatNanoAiu(request.totalNanoAiu),
    agent: request.agentId ? { text: agentLabel(request), recorded: true } : textCell(null),
    input: counterCell(request.inputTokens),
    output: counterCell(request.outputTokens),
    cacheRead: counterCell(request.cacheReadTokens),
    duration: millisecondCell(request.durationMs),
    firstOutput: millisecondCell(request.outputTtftMs),
    finish: textCell(request.finishReason),
  })),
);

function expandLabel(row: Record<string, unknown>): string {
  return `Details for the ${row.model} request recorded at ${row.recorded}`;
}
</script>

<template>
  <DataTable
    class="ledger-table"
    data-testid="request-ledger-table"
    :columns="COLUMNS"
    :rows="rows"
    row-key="key"
    :expanded-keys="expandedKeys"
    :expand-label="expandLabel"
    style="overflow-x: auto"
    @toggle="emit('toggle', $event)"
  >
    <template v-for="key in CELL_KEYS" :key="key" #[`cell-${key}`]="{ value }">
      <span v-if="(value as CounterCell).recorded">{{ (value as CounterCell).text }}</span>
      <span v-else class="ledger-missing" :title="NOT_RECORDED_HINT" aria-label="Not recorded">—</span>
    </template>
    <template #expanded="{ row }">
      <slot name="expanded" :request="row.request as StoredRequest" />
    </template>
  </DataTable>
</template>

<style scoped>
.ledger-table :deep(td) {
  font-variant-numeric: tabular-nums;
}
.ledger-missing {
  color: var(--text-tertiary);
  cursor: help;
}
.ledger-table :deep(.ledger-col--md),
.ledger-table :deep(.ledger-col--xl) {
  display: none;
}
@media (min-width: 1200px) {
  .ledger-table :deep(.ledger-col--md) {
    display: table-cell;
  }
}
@media (min-width: 1800px) {
  .ledger-table :deep(.ledger-col--xl) {
    display: table-cell;
  }
}
</style>
