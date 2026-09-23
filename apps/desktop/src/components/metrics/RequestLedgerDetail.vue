<script setup lang="ts">
/**
 * Detail panel for one recorded request, shown inside the ledger under the
 * table rather than as an overlay, so the row it explains stays in view.
 *
 * Everything the table drops lands here, plus the values a reader needs to
 * judge the row: the exact recorded charge as a string, the itemised billing
 * behind it, both first-token metrics, the attribution evidence and the
 * session's reconciliation verdict with the scope that verdict used.
 */
import type { SessionCoverageRow, StoredRequest } from "@tracepilot/types";
import { Badge, DataTable, type DataTableColumn, formatDate } from "@tracepilot/ui";
import { computed } from "vue";
import {
  BILLING_CHECK_LABELS,
  BILLING_STATUS_LABELS,
  billingCheckTone,
  counterCell,
  formatCostPerBatch,
  formatExactCredits,
  formatNanoAiu,
  itemChargeNanoAiu,
  millisecondCell,
  NOT_RECORDED,
  NOT_RECORDED_HINT,
  reconciliationSentence,
  textCell,
} from "@/utils/requestLedger";

const props = defineProps<{
  request: StoredRequest;
  coverage: SessionCoverageRow | null;
}>();

const emit = defineEmits<{ "filter-agent": [agentId: string] }>();

interface DetailRow {
  label: string;
  text: string;
  recorded: boolean;
  hint?: string;
}

function row(label: string, cell: { text: string; recorded: boolean }, hint?: string): DetailRow {
  return { label, text: cell.text, recorded: cell.recorded, hint };
}

const identity = computed<DetailRow[]>(() => {
  const r = props.request;
  if (!r) return [];
  return [
    row(
      "Recorded at",
      textCell(r.recordedAt ? formatDate(r.recordedAt) : null),
      r.recordedAt ?? undefined,
    ),
    row("Model", textCell(r.model)),
    row(
      "Initiator",
      textCell(r.initiator),
      "A missing initiator is a historical absence, not a user.",
    ),
    row("Reasoning effort", textCell(r.reasoningEffort)),
    row("Completion reason", textCell(r.finishReason)),
    row("API endpoint", textCell(r.apiEndpoint)),
    row("Usage model", textCell(r.copilotUsageModel)),
    row(
      "Content filter",
      r.contentFilterTriggered == null
        ? textCell(null)
        : { text: r.contentFilterTriggered ? "Triggered" : "Not triggered", recorded: true },
    ),
  ];
});

const tokens = computed<DetailRow[]>(() => {
  const r = props.request;
  if (!r) return [];
  return [
    row(
      "Input",
      counterCell(r.inputTokens),
      "Includes the cache categories; not a fresh-token figure.",
    ),
    row("Output", counterCell(r.outputTokens), "Already includes reasoning tokens."),
    row("Reasoning", counterCell(r.reasoningTokens)),
    row("Cache reads", counterCell(r.cacheReadTokens)),
    row("Cache writes", counterCell(r.cacheWriteTokens)),
  ];
});

const timings = computed<DetailRow[]>(() => {
  const r = props.request;
  if (!r) return [];
  return [
    row(
      "Request duration",
      millisecondCell(r.durationMs),
      "The whole API call; excludes unrelated tool runtime.",
    ),
    row("Time to first token", millisecondCell(r.timeToFirstTokenMs)),
    row(
      "First observable output",
      millisecondCell(r.outputTtftMs),
      "Includes reasoning and tool-call output. Not time to the first answer, and its gap from time to first token is not reasoning duration.",
    ),
    row(
      "Inter-token latency",
      millisecondCell(r.interTokenLatencyMs),
      "A reported average. Its reciprocal is not a visible-text token rate.",
    ),
  ];
});

const charge = computed<DetailRow[]>(() => {
  const r = props.request;
  if (!r) return [];
  return [
    row("AI credits", { text: formatNanoAiu(r.totalNanoAiu), recorded: r.totalNanoAiu != null }),
    row(
      "Recorded nano AIU",
      textCell(r.totalNanoAiu),
      "The exact value as recorded. Credits above are this divided by one billion.",
    ),
    row("Request multiplier", textCell(r.requestMultiplier)),
  ];
});

const attribution = computed<DetailRow[]>(() => {
  const r = props.request;
  if (!r) return [];
  return [
    row("Agent", textCell(r.agentId)),
    row("Parent tool call", textCell(r.parentToolCallId)),
    row(
      "Source turn index",
      r.sourceTurnIndex == null
        ? textCell(null)
        : { text: String(r.sourceTurnIndex), recorded: true },
      "The source's own interaction counter. It is not a TracePilot turn index and cannot be used to jump to a turn.",
    ),
    row("Source row", { text: String(r.sourceRowId), recorded: true }),
    row("Source generation", textCell(r.generation)),
    row("Row fingerprint", textCell(r.rowFingerprint)),
  ];
});

const groups = computed(() => [
  { title: "Request", rows: identity.value, note: null as string | null },
  { title: "Tokens", rows: tokens.value, note: null as string | null },
  {
    title: "Timing",
    rows: timings.value,
    note: "First observable output includes reasoning and tool-call output, so its gap from time to first token is not reasoning duration.",
  },
  {
    title: "Attribution",
    rows: attribution.value,
    // The counter reads like a turn number and is not one; saying so in the
    // body rather than a tooltip keeps it in front of the reader.
    note:
      props.request?.sourceTurnIndex == null
        ? null
        : "The source turn index is the source's own interaction counter: it is not a TracePilot turn index and cannot be used to jump to a turn.",
  },
]);

const billingItems = computed(() => props.request?.billingItems ?? []);
const invalidFields = computed(() => props.request?.invalidFields ?? []);
/** The session's verdict; the figures behind it only when they disagree. */
const reconciliation = computed(() => {
  const sentence = reconciliationSentence(props.coverage);
  if (!sentence) return null;
  const status = props.coverage?.reconciliationStatus;
  const disagrees = status === "mismatch" || status === "partial";
  return {
    sentence,
    differences: disagrees ? (props.coverage?.reconciliationDifferences ?? null) : null,
  };
});

const billingColumns = computed<DataTableColumn[]>(() => [
  { key: "tokenType", label: "Token type" },
  { key: "count", label: "Count", align: "right" },
  { key: "rate", label: "Rate", align: "right" },
  { key: "charge", label: "Charge", align: "right" },
  ...(billingItems.value.some((item) => item.billingModel)
    ? [{ key: "billingModel", label: "Billing model" }]
    : []),
]);

const billingRows = computed(() =>
  billingItems.value.map((item) => ({
    key: item.ordinal,
    tokenType: item.tokenType,
    count: counterCell(item.tokenCount).text,
    rate: formatNanoAiu(item.costPerBatch),
    batch: batchLabel(item.batchSize),
    rateTitle: `${formatCostPerBatch(item.costPerBatch)} nano AIU ${batchLabel(item.batchSize)} tokens, exactly as recorded`,
    charge: formatExactCredits(itemChargeNanoAiu(item)),
    billingModel: item.billingModel ?? NOT_RECORDED,
  })),
);

function batchLabel(size: number | null): string {
  if (size == null) return NOT_RECORDED;
  if (size >= 1_000_000 && size % 1_000_000 === 0) return `per ${size / 1_000_000}M`;
  if (size >= 1_000 && size % 1_000 === 0) return `per ${size / 1_000}K`;
  return `per ${size.toLocaleString("en-US")}`;
}
</script>

<template>
  <section
    class="ledger-detail"
    data-testid="request-ledger-detail"
    aria-label="Recorded request details"
  >
    <div class="ledger-detail__body">
      <section class="ledger-detail__billing-col">
        <h4 class="ledger-detail__heading">Recorded charge</h4>
        <dl class="ledger-detail__list ledger-detail__charge">
          <template v-for="entry in charge" :key="entry.label">
            <dt :title="entry.hint">{{ entry.label }}</dt>
            <dd>{{ entry.text }}</dd>
          </template>
        </dl>
        <div class="ledger-detail__badges">
          <Badge variant="neutral">Items: {{ BILLING_STATUS_LABELS[request.billingItemsStatus] }}</Badge>
          <Badge :variant="billingCheckTone(request.billingCheck)">
            {{ BILLING_CHECK_LABELS[request.billingCheck] }}
          </Badge>
        </div>
        <DataTable
          v-if="billingItems.length"
          class="ledger-detail__billing"
          :columns="billingColumns"
          :rows="billingRows"
          row-key="key"
        >
          <template #cell-rate="{ row }">
            <span :title="row.rateTitle as string">{{ row.rate }}</span>
            <span class="ledger-detail__batch">{{ row.batch }}</span>
          </template>
        </DataTable>
        <p v-else class="ledger-detail__note">
          No itemised billing was recorded for this request.
        </p>
        <p class="ledger-detail__note">
          Each entry charges count × rate ÷ batch size. The request multiplier is already included in the recorded charge.
        </p>
      </section>

      <div class="ledger-detail__facts">
      <component :is="group.title === 'Attribution' ? 'details' : 'section'" v-for="group in groups" :key="group.title">
        <summary v-if="group.title === 'Attribution'" class="ledger-detail__heading">Source details</summary>
        <h4 v-else class="ledger-detail__heading">{{ group.title }}</h4>
        <dl class="ledger-detail__list">
          <template v-for="entry in group.rows" :key="entry.label">
            <dt :title="entry.hint">{{ entry.label }}</dt>
            <dd v-if="entry.recorded">{{ entry.text }}</dd>
            <dd v-else class="ledger-detail__missing" :title="NOT_RECORDED_HINT">—</dd>
          </template>
        </dl>
        <p v-if="group.note" class="ledger-detail__note">{{ group.note }}</p>
      </component>

      <section v-if="invalidFields.length" data-testid="request-ledger-invalid-fields">
        <h4 class="ledger-detail__heading">Unusable source values</h4>
        <p class="ledger-detail__note">
          These columns could not be read on this row, so any total that uses them
          is incomplete: {{ invalidFields.join(", ") }}.
        </p>
      </section>

      <section v-if="reconciliation" data-testid="request-ledger-reconciliation">
        <h4 class="ledger-detail__heading">Session reconciliation</h4>
        <p class="ledger-detail__note">{{ reconciliation.sentence }}</p>
        <p v-if="reconciliation.differences" class="ledger-detail__note">
          Differences: {{ reconciliation.differences }}
        </p>
      </section>

      <section>
        <h4 class="ledger-detail__heading">Linked work</h4>
        <button
          v-if="request.agentId"
          type="button"
          class="btn btn-secondary btn-sm"
          data-testid="request-ledger-agent-action"
          @click="emit('filter-agent', request.agentId)"
        >
          Show this agent's requests
        </button>
        <p class="ledger-detail__note">
          <template v-if="request.agentId">
            This request is attached to agent {{ request.agentId }}. No mapping to a
            TracePilot turn is recorded, so there is no turn to jump to.
          </template>
          <template v-else>
            No agent or turn mapping is recorded for this request.
          </template>
        </p>
      </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ledger-detail {
  padding: 4px 0;
  white-space: normal;
}
/* Charge and billing on the left, the request's facts on the right; one
   column when the ledger is narrow. */
.ledger-detail__body {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 24px;
}
.ledger-detail__facts {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
@media (max-width: 1199px) {
  .ledger-detail__body {
    grid-template-columns: minmax(0, 1fr);
  }
}
.ledger-detail__heading {
  margin: 0 0 8px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}
.ledger-detail__list {
  display: grid;
  /* One label width for every group, so the values line up down the panel. */
  grid-template-columns: 11rem minmax(0, 1fr);
  gap: 4px 12px;
  margin: 0;
  font-size: 0.8125rem;
}
.ledger-detail__list dt {
  color: var(--text-tertiary);
}
.ledger-detail__list dd {
  margin: 0;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.ledger-detail__missing {
  color: var(--text-tertiary);
  cursor: help;
}
.ledger-detail__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.ledger-detail__billing :deep(td) {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ledger-detail__charge {
  margin: 12px 0;
}
.ledger-detail__batch {
  margin-left: 4px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.ledger-detail__note {
  max-width: 60ch;
  margin: 8px 0 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
</style>
