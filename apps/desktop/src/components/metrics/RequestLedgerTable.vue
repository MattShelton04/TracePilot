<script setup lang="ts">
/**
 * The recorded-request table.
 *
 * Columns are dropped by viewport width, never values: everything hidden here
 * stays reachable in the row's detail drawer. A missing counter renders as a
 * labelled em dash so it never reads as a recorded zero.
 */
import type { StoredRequest } from "@tracepilot/types";
import { DataTable, formatDate, formatTime } from "@tracepilot/ui";
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

const props = defineProps<{ requests: StoredRequest[] }>();
const emit = defineEmits<{ select: [request: StoredRequest] }>();

/** `md` appears from 1200px, `xl` from 1800px; both live in the drawer too. */
const COLUMNS = [
  { key: "recorded", label: "Recorded" },
  { key: "model", label: "Model" },
  { key: "agent", label: "Agent", class: "ledger-col--md" },
  { key: "input", label: "Input", align: "right" as const },
  { key: "output", label: "Output", align: "right" as const },
  { key: "cacheRead", label: "Cache reads", align: "right" as const, class: "ledger-col--md" },
  { key: "credits", label: "AI credits", align: "right" as const },
  { key: "duration", label: "Duration", align: "right" as const },
  { key: "firstOutput", label: "First output", align: "right" as const, class: "ledger-col--xl" },
  { key: "finish", label: "Completion", class: "ledger-col--md" },
  { key: "details", label: "Details", class: "ledger-col--action" },
];

interface LedgerRow extends Record<string, unknown> {
  key: string;
  request: StoredRequest;
  recorded: string;
  model: string;
  agent: CounterCell;
  input: CounterCell;
  output: CounterCell;
  cacheRead: CounterCell;
  credits: string;
  duration: CounterCell;
  firstOutput: CounterCell;
  finish: CounterCell;
}

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

const rows = computed<LedgerRow[]>(() =>
  props.requests.map((request) => ({
    key: requestKey(request),
    request,
    recorded: request.recordedAt
      ? (spansDays.value ? formatDate : formatTime)(request.recordedAt)
      : "",
    model: request.model,
    agent: request.agentId ? { text: agentLabel(request), recorded: true } : textCell(null),
    input: counterCell(request.inputTokens),
    output: counterCell(request.outputTokens),
    cacheRead: counterCell(request.cacheReadTokens),
    credits: formatNanoAiu(request.totalNanoAiu),
    duration: millisecondCell(request.durationMs),
    firstOutput: millisecondCell(request.outputTtftMs),
    finish: textCell(request.finishReason),
  })),
);

const CELL_KEYS = [
  "agent",
  "input",
  "output",
  "cacheRead",
  "duration",
  "firstOutput",
  "finish",
] as const;

function rowLabel(row: LedgerRow): string {
  return `Details for the ${row.model} request recorded at ${row.recorded || "an unrecorded time"}`;
}
</script>

<template>
  <div class="ledger-table" data-testid="request-ledger-table">
    <DataTable :columns="COLUMNS" :rows="rows" empty-message="No requests recorded for this session.">
      <template #cell-recorded="{ row }">
        <span class="ledger-num">{{ (row as LedgerRow).recorded || "—" }}</span>
      </template>
      <template v-for="key in CELL_KEYS" :key="key" #[`cell-${key}`]="{ value }">
        <span v-if="(value as CounterCell).recorded" class="ledger-num">
          {{ (value as CounterCell).text }}
        </span>
        <span v-else class="ledger-missing" :title="NOT_RECORDED_HINT" aria-label="Not recorded">—</span>
      </template>
      <template #cell-credits="{ value }">
        <span class="ledger-num">{{ value }}</span>
      </template>
      <template #cell-details="{ row }">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :aria-label="rowLabel(row as LedgerRow)"
          @click="emit('select', (row as LedgerRow).request)"
        >
          Details
        </button>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.ledger-table {
  overflow-x: auto;
}
.ledger-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ledger-missing {
  color: var(--text-tertiary);
  cursor: help;
}
.ledger-table :deep(.ledger-col--action) {
  width: 1%;
  white-space: nowrap;
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
