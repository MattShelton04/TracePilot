<script setup lang="ts">
/**
 * "Model requests" — the request ledger read from the Copilot CLI's own
 * session store.
 *
 * These figures are observations of recorded requests and stay named apart
 * from the session's shutdown totals: the two count different things, and
 * with no shutdown written yet there is no session total to infer. The
 * section is collapsed until asked for, and only then does it read the store.
 */
import type { StoredRequest } from "@tracepilot/types";
import {
  ActionButton,
  Badge,
  Banner,
  ErrorAlert,
  ExpandChevron,
  formatDate,
  formatRelativeTime,
  StatCard,
} from "@tracepilot/ui";
import { computed, ref, useId, watch } from "vue";
import RequestLedgerDrawer from "@/components/metrics/RequestLedgerDrawer.vue";
import RequestLedgerFilters from "@/components/metrics/RequestLedgerFilters.vue";
import RequestLedgerTable from "@/components/metrics/RequestLedgerTable.vue";
import type { RequestLedgerFilterState } from "@/composables/session/useRequestLedger";
import { useRequestLedger } from "@/composables/session/useRequestLedger";
import {
  AVAILABILITY_LABELS,
  accountingScopeLabel,
  formatExactCredits,
  RECONCILIATION_LABELS,
  reconciliationMetricLabel,
} from "@/utils/requestLedger";

const props = defineProps<{
  sessionId: string | null;
  /** Whether shutdown totals are on screen, so this section can name itself apart. */
  hasShutdownTotals?: boolean;
}>();

const expanded = ref(false);
const bodyId = useId();
const selected = ref<StoredRequest | null>(null);
const drawerOpen = ref(false);

const ledger = useRequestLedger(
  () => props.sessionId,
  () => expanded.value,
);
watch(
  () => props.sessionId,
  () => {
    selected.value = null;
    drawerOpen.value = false;
  },
);

/** With no shutdown there is no final total — only what has been recorded. */
const requestCountLabel = computed(() =>
  props.hasShutdownTotals ? "Recorded requests" : "Recorded requests so far",
);

const coverageSummary = computed(() => {
  const coverage = ledger.coverage.value;
  if (!coverage) return null;
  return {
    rows: coverage.requestRows,
    rejected: coverage.requestRowsRejected,
    billingInvalid: coverage.billingInvalid,
    billingPartial: coverage.billingPartial,
    billingAbsent: coverage.billingAbsent,
    missingColumns: coverage.missingColumns,
    readAt: coverage.readAt,
    freshness: coverage.freshness,
    availability: coverage.availability,
    reconciliation: coverage.reconciliationStatus
      ? {
          label: RECONCILIATION_LABELS[coverage.reconciliationStatus],
          scope: accountingScopeLabel(coverage.reconciliationScope),
          metrics: coverage.reconciliationMetrics.map(reconciliationMetricLabel),
        }
      : null,
  };
});

const creditSummary = computed(() => {
  const sum = ledger.pageCredits.value;
  const parts = [
    `${sum.counted} of ${ledger.requests.value.length} rows on this page recorded a charge`,
  ];
  if (sum.unparsed > 0)
    parts.push(`${sum.unparsed} recorded an unreadable charge and are excluded`);
  if (ledger.hasNextPage.value || ledger.hasPreviousPage.value) {
    parts.push("later pages are not included");
  }
  return { text: formatExactCredits(sum.total), detail: `${parts.join("; ")}.` };
});

/** The store may be bound and readable while this session has no rows in it. */
const unavailableDetail = computed(() => {
  const availability = ledger.source.value?.availability ?? ledger.coverage.value?.availability;
  const path = ledger.source.value?.dbPath;
  const label = availability ? AVAILABILITY_LABELS[availability] : null;
  return [label, path].filter(Boolean).join(" · ") || null;
});

function openDetails(request: StoredRequest): void {
  selected.value = request;
  drawerOpen.value = true;
}

function updateFilters(patch: Partial<RequestLedgerFilterState>): void {
  Object.assign(ledger.filters, patch);
  void ledger.applyFilters();
}

function filterToAgent(agentId: string): void {
  drawerOpen.value = false;
  void ledger.setAgentFilter(agentId);
}
</script>

<template>
  <section class="ledger" data-testid="request-ledger-section">
    <button
      type="button"
      class="ledger__toggle"
      :aria-expanded="expanded"
      :aria-controls="bodyId"
      @click="expanded = !expanded"
    >
      <ExpandChevron :expanded="expanded" />
      <span class="ledger__title">Model requests</span>
      <Badge v-if="ledger.activeFilterCount.value > 0" variant="accent">
        {{ ledger.activeFilterCount.value }} filtered
      </Badge>
    </button>

    <div v-if="expanded" :id="bodyId" class="ledger__body">
      <ErrorAlert
        v-if="ledger.error.value"
        :message="ledger.error.value"
        variant="inline"
        retryable
        class="mb-4"
        @retry="ledger.load()"
      />

      <Banner
        v-if="ledger.cursorReset.value"
        tone="warning"
        class="mb-4"
        data-testid="request-ledger-cursor-reset"
      >
        The session store was replaced while paging, so these pages would have come
        from two different versions of it. The ledger restarted at the first page.
      </Banner>

      <p v-if="ledger.loading.value && !ledger.loaded.value" class="ledger__note">
        Reading the session store…
      </p>

      <template v-if="ledger.loaded.value">
        <p
          v-if="!ledger.available.value"
          class="ledger__note"
          data-testid="request-ledger-unavailable"
        >
          No Copilot session store available, so no requests can be listed for this
          session. This is not the same as a session that recorded none.
          <template v-if="unavailableDetail"> ({{ unavailableDetail }})</template>
        </p>

        <template v-else>
          <div class="ledger__stats">
            <StatCard
              :value="coverageSummary ? coverageSummary.rows : ledger.requests.value.length"
              :label="requestCountLabel"
              tooltip="Requests recorded in the session store. Shutdown totals are a separate figure and count different work."
              mini
            />
            <StatCard
              :value="creditSummary.text"
              label="Credits on this page"
              :tooltip="creditSummary.detail"
              mini
            />
            <StatCard
              v-if="coverageSummary"
              :value="formatRelativeTime(coverageSummary.readAt)"
              label="Last synchronized"
              :tooltip="formatDate(coverageSummary.readAt)"
              mini
            />
            <StatCard
              v-if="coverageSummary"
              :value="`${coverageSummary.rows} kept · ${coverageSummary.rejected} rejected`"
              label="Row coverage"
              tooltip="Rows read from the store against rows that could not be used."
              mini
            />
          </div>

          <p v-if="hasShutdownTotals" class="ledger__note">
            These are observed requests from the session store. The session totals
            above come from the shutdown record and are not the same figure.
          </p>

          <Banner
            v-if="coverageSummary && (coverageSummary.rejected > 0 || coverageSummary.billingInvalid > 0 || coverageSummary.missingColumns.length > 0)"
            tone="warning"
            class="mb-4"
            data-testid="request-ledger-partial-coverage"
          >
            This ledger is incomplete, so any sum below is partial:
            <template v-if="coverageSummary.rejected > 0">
              {{ coverageSummary.rejected }} request rows were rejected.
            </template>
            <template v-if="coverageSummary.billingInvalid > 0">
              {{ coverageSummary.billingInvalid }} requests had invalid billing items.
            </template>
            <template v-if="coverageSummary.billingPartial > 0">
              {{ coverageSummary.billingPartial }} had partial billing items.
            </template>
            <template v-if="coverageSummary.missingColumns.length > 0">
              Missing source columns: {{ coverageSummary.missingColumns.join(", ") }}.
            </template>
          </Banner>

          <p
            v-if="coverageSummary?.reconciliation"
            class="ledger__note"
            data-testid="request-ledger-reconciliation-summary"
          >
            Against the shutdown totals: {{ coverageSummary.reconciliation.label }},
            over {{ coverageSummary.reconciliation.scope ?? "an unrecorded accounting scope" }}.
            <template v-if="coverageSummary.reconciliation.metrics.length">
              Compared: {{ coverageSummary.reconciliation.metrics.join(", ") }}.
            </template>
          </p>

          <RequestLedgerFilters
            :filters="ledger.filters"
            :options="ledger.filterOptions.value"
            :active-count="ledger.activeFilterCount.value"
            :disabled="ledger.loading.value"
            @update="updateFilters"
            @clear="ledger.clearFilters()"
          />

          <p
            v-if="ledger.isEmpty.value"
            class="ledger__note"
            data-testid="request-ledger-empty"
          >
            <template v-if="ledger.activeFilterCount.value > 0">
              No recorded requests match these filters.
            </template>
            <template v-else>No requests recorded for this session.</template>
          </p>

          <template v-else>
            <RequestLedgerTable :requests="ledger.requests.value" @select="openDetails" />

            <div class="ledger__pager">
              <ActionButton
                size="sm"
                :disabled="!ledger.hasPreviousPage.value || ledger.loading.value"
                @click="ledger.previousPage()"
              >
                Previous
              </ActionButton>
              <span class="ledger__note">Page {{ ledger.pageNumber.value }}</span>
              <ActionButton
                size="sm"
                :disabled="!ledger.hasNextPage.value || ledger.loading.value"
                @click="ledger.nextPage()"
              >
                Next
              </ActionButton>
            </div>
          </template>
        </template>
      </template>
    </div>

    <RequestLedgerDrawer
      v-model:visible="drawerOpen"
      :request="selected"
      :coverage="ledger.coverage.value"
      @filter-agent="filterToAgent"
    />
  </section>
</template>

<style scoped>
.ledger {
  margin-bottom: 1.5rem;
}
.ledger__toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.ledger__toggle:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
.ledger__title {
  color: var(--text-tertiary);
}
.ledger__body {
  margin-top: 12px;
}
.ledger__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.ledger__note {
  max-width: 72ch;
  margin: 0 0 12px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
.ledger__pager {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.ledger__pager .ledger__note {
  margin: 0;
}
</style>
