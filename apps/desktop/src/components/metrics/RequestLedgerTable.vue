<script setup lang="ts">
/**
 * The recorded-request table.
 *
 * Columns are dropped by viewport width, never values: everything hidden here
 * stays reachable in the row's detail panel. A missing counter renders as a
 * labelled em dash so it never reads as a recorded zero.
 *
 * The rows scroll inside a bounded region under a sticky header, so a long
 * page never pushes the detail panel and pager off screen. A plain table
 * rather than `DataTable`, which neither selects rows nor scrolls its body.
 */
import type { StoredRequest } from "@tracepilot/types";
import { formatDate, formatTime } from "@tracepilot/ui";
import { ChevronDown } from "lucide-vue-next";
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

const props = defineProps<{ requests: StoredRequest[]; selectedKey?: string | null }>();
const emit = defineEmits<{ select: [request: StoredRequest] }>();

/** `md` appears from 1200px, `xl` from 1800px; both live in the detail panel too. */
const COLUMNS = [
  { key: "recorded", label: "Recorded" },
  { key: "model", label: "Model" },
  { key: "agent", label: "Agent", class: "ledger-col--md" },
  { key: "input", label: "Input", numeric: true },
  { key: "output", label: "Output", numeric: true },
  { key: "cacheRead", label: "Cache reads", numeric: true, class: "ledger-col--md" },
  { key: "credits", label: "AI credits", numeric: true },
  { key: "duration", label: "Duration", numeric: true },
  { key: "firstOutput", label: "First output", numeric: true, class: "ledger-col--xl" },
  { key: "finish", label: "Completion", class: "ledger-col--md" },
] as const;

type CellKey = Exclude<(typeof COLUMNS)[number]["key"], "recorded" | "model" | "credits">;

interface LedgerRow {
  key: string;
  request: StoredRequest;
  recorded: string;
  model: string;
  credits: string;
  cells: Record<CellKey, CounterCell>;
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
    credits: formatNanoAiu(request.totalNanoAiu),
    cells: {
      agent: request.agentId ? { text: agentLabel(request), recorded: true } : textCell(null),
      input: counterCell(request.inputTokens),
      output: counterCell(request.outputTokens),
      cacheRead: counterCell(request.cacheReadTokens),
      duration: millisecondCell(request.durationMs),
      firstOutput: millisecondCell(request.outputTtftMs),
      finish: textCell(request.finishReason),
    },
  })),
);

function rowLabel(row: LedgerRow): string {
  return `Details for the ${row.model} request recorded at ${row.recorded || "an unrecorded time"}`;
}
</script>

<template>
  <div
    class="ledger-table"
    data-testid="request-ledger-table"
    tabindex="0"
    role="region"
    aria-label="Recorded requests"
  >
    <table class="data-table">
      <thead>
        <tr>
          <th
            v-for="column in COLUMNS"
            :key="column.key"
            :class="['class' in column ? column.class : '', { 'ledger-num-col': 'numeric' in column }]"
          >
            {{ column.label }}
          </th>
          <th class="ledger-col--action"><span class="ledger-visually-hidden">Details</span></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.key"
          class="ledger-row"
          :class="{ 'ledger-row--selected': row.key === selectedKey }"
          @click="emit('select', row.request)"
        >
          <td><span class="ledger-num">{{ row.recorded || "—" }}</span></td>
          <td>{{ row.model }}</td>
          <template v-for="column in COLUMNS" :key="column.key">
            <td
              v-if="column.key in row.cells"
              :class="['class' in column ? column.class : '', { 'ledger-num-col': 'numeric' in column }]"
            >
              <span v-if="row.cells[column.key as CellKey].recorded" class="ledger-num">
                {{ row.cells[column.key as CellKey].text }}
              </span>
              <span v-else class="ledger-missing" :title="NOT_RECORDED_HINT" aria-label="Not recorded">—</span>
            </td>
            <td v-else-if="column.key === 'credits'" class="ledger-num-col">
              <span class="ledger-num">{{ row.credits }}</span>
            </td>
          </template>
          <td class="ledger-col--action">
            <button
              type="button"
              class="ledger-row-toggle"
              :aria-label="rowLabel(row)"
              :aria-expanded="row.key === selectedKey"
              @click.stop="emit('select', row.request)"
            >
              <ChevronDown :size="14" aria-hidden="true" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.ledger-table {
  max-height: min(60vh, 520px);
  overflow: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
.ledger-table:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
.ledger-table table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}
.ledger-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--canvas-subtle);
}
.ledger-table th,
.ledger-table td {
  padding: 6px 12px;
  font-size: 0.8125rem;
  white-space: nowrap;
}
.ledger-row {
  cursor: pointer;
}
.ledger-row:hover td {
  background: var(--canvas-subtle);
}
.ledger-row--selected td {
  background: var(--accent-subtle);
}
.ledger-num-col {
  text-align: right;
}
.ledger-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.ledger-num {
  font-variant-numeric: tabular-nums;
}
.ledger-missing {
  color: var(--text-tertiary);
  cursor: help;
}
.ledger-col--action {
  width: 1%;
  padding-right: 8px;
}
.ledger-row-toggle {
  display: inline-flex;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: transform 0.15s ease;
}
.ledger-row-toggle:hover,
.ledger-row-toggle:focus-visible {
  border-color: var(--border-default);
  color: var(--text-primary);
}
.ledger-row-toggle[aria-expanded="true"] {
  transform: rotate(180deg);
  color: var(--accent-fg);
}
.ledger-col--md,
.ledger-col--xl {
  display: none;
}
@media (min-width: 1200px) {
  .ledger-col--md {
    display: table-cell;
  }
}
@media (min-width: 1800px) {
  .ledger-col--xl {
    display: table-cell;
  }
}
</style>
