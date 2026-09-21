<script setup lang="ts">
/**
 * Detail drawer for one recorded request.
 *
 * Everything the table drops lands here, plus the values a reader needs to
 * judge the row: the exact recorded charge as a string, the itemised billing
 * behind it, both first-token metrics, the attribution evidence and the
 * session's reconciliation verdict with the scope that verdict used.
 */
import type { SessionCoverageRow, StoredRequest } from "@tracepilot/types";
import { Badge, Drawer } from "@tracepilot/ui";
import { computed } from "vue";
import {
  BILLING_CHECK_LABELS,
  BILLING_STATUS_LABELS,
  billingCheckTone,
  counterCell,
  formatCostPerBatch,
  formatNanoAiu,
  millisecondCell,
  NOT_RECORDED,
  NOT_RECORDED_HINT,
  RECONCILIATION_LABELS,
  textCell,
} from "@/utils/requestLedger";

const props = defineProps<{
  request: StoredRequest | null;
  coverage: SessionCoverageRow | null;
  visible: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  "filter-agent": [agentId: string];
}>();

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
    row("Recorded at", textCell(r.recordedAt)),
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
  { title: "Charge", rows: charge.value, note: null as string | null },
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
const reconciliation = computed(() => {
  const c = props.coverage;
  if (!c?.reconciliationStatus) return null;
  return {
    status: RECONCILIATION_LABELS[c.reconciliationStatus],
    // A status without its scope is not a claim a reader can act on.
    scope: c.reconciliationScope,
    metrics: c.reconciliationMetrics,
    differences: c.reconciliationDifferences,
  };
});

function batchLabel(size: number | null): string {
  return size == null ? NOT_RECORDED : `per ${size.toLocaleString("en-US")}`;
}
</script>

<template>
  <Drawer
    :visible="visible"
    width="520px"
    title="Recorded request"
    @update:visible="emit('update:visible', $event)"
  >
    <div v-if="request" class="ledger-drawer" data-testid="request-ledger-drawer">
      <section v-for="group in groups" :key="group.title">
        <h3 class="ledger-drawer__heading">{{ group.title }}</h3>
        <dl class="ledger-drawer__list">
          <template v-for="entry in group.rows" :key="entry.label">
            <dt :title="entry.hint">{{ entry.label }}</dt>
            <dd v-if="entry.recorded">{{ entry.text }}</dd>
            <dd v-else class="ledger-drawer__missing" :title="NOT_RECORDED_HINT">—</dd>
          </template>
        </dl>
        <p v-if="group.note" class="ledger-drawer__note">{{ group.note }}</p>
      </section>

      <section>
        <h3 class="ledger-drawer__heading">Billing</h3>
        <div class="ledger-drawer__badges">
          <Badge variant="neutral">Items: {{ BILLING_STATUS_LABELS[request.billingItemsStatus] }}</Badge>
          <Badge :variant="billingCheckTone(request.billingCheck)">
            {{ BILLING_CHECK_LABELS[request.billingCheck] }}
          </Badge>
        </div>
        <table v-if="billingItems.length" class="data-table ledger-drawer__billing">
          <thead>
            <tr>
              <th>Token type</th>
              <th style="text-align: right">Count</th>
              <th style="text-align: right">Batch</th>
              <th style="text-align: right">Rate</th>
              <th>Billing model</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in billingItems" :key="item.ordinal">
              <td>{{ item.tokenType }}</td>
              <td style="text-align: right">{{ counterCell(item.tokenCount).text }}</td>
              <td style="text-align: right">{{ batchLabel(item.batchSize) }}</td>
              <td style="text-align: right" class="ledger-drawer__exact">
                {{ formatCostPerBatch(item.costPerBatch) }}
              </td>
              <td>{{ item.billingModel ?? NOT_RECORDED }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="ledger-drawer__note">
          No itemised billing was recorded for this request.
        </p>
        <p class="ledger-drawer__note">
          Rates are the exact recorded per-batch values, shown as recorded.
        </p>
      </section>

      <section v-if="invalidFields.length" data-testid="request-ledger-invalid-fields">
        <h3 class="ledger-drawer__heading">Unusable source values</h3>
        <p class="ledger-drawer__note">
          These columns could not be read on this row, so any total that uses them
          is incomplete: {{ invalidFields.join(", ") }}.
        </p>
      </section>

      <section v-if="reconciliation" data-testid="request-ledger-reconciliation">
        <h3 class="ledger-drawer__heading">Reconciliation</h3>
        <p class="ledger-drawer__note">
          {{ reconciliation.status }}, over
          {{ reconciliation.scope ?? "an unrecorded accounting scope" }}.
          <template v-if="reconciliation.metrics.length">
            Compared: {{ reconciliation.metrics.join(", ") }}.
          </template>
        </p>
        <p v-if="reconciliation.differences" class="ledger-drawer__note">
          Differences: {{ reconciliation.differences }}
        </p>
      </section>

      <section>
        <h3 class="ledger-drawer__heading">Linked work</h3>
        <button
          v-if="request.agentId"
          type="button"
          class="btn btn-secondary btn-sm"
          data-testid="request-ledger-agent-action"
          @click="emit('filter-agent', request.agentId)"
        >
          Show this agent's requests
        </button>
        <p class="ledger-drawer__note">
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
  </Drawer>
</template>

<style scoped>
.ledger-drawer {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px 20px;
}
.ledger-drawer__heading {
  margin: 0 0 8px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}
.ledger-drawer__list {
  display: grid;
  grid-template-columns: minmax(120px, max-content) 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 0.8125rem;
}
.ledger-drawer__list dt {
  color: var(--text-tertiary);
}
.ledger-drawer__list dd {
  margin: 0;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.ledger-drawer__missing {
  color: var(--text-tertiary);
  cursor: help;
}
.ledger-drawer__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.ledger-drawer__billing {
  width: 100%;
}
.ledger-drawer__exact {
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.ledger-drawer__note {
  max-width: 60ch;
  margin: 8px 0 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
</style>
