<script setup lang="ts">
/**
 * "Model requests" — the request ledger read from the Copilot CLI's own
 * session store.
 *
 * These figures are observations of recorded requests and stay named apart
 * from the session's shutdown totals: the two count different things, and
 * with no shutdown written yet there is no session total to infer. The
 * section is collapsed until asked for, and only then does it read the store.
 *
 * The header answers the session-level questions — how many requests, what
 * they were charged, how long they took, how much input the cache served —
 * over every recorded request, not the page on screen.
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
import { REQUEST_LEDGER_PAGE_SIZE, useRequestLedger } from "@/composables/session/useRequestLedger";
import {
  AVAILABILITY_LABELS,
  formatNanoAiu,
  NOT_RECORDED,
  reconciliationSentence,
  staleNote,
} from "@/utils/requestLedger";
import { buildCacheReuse, buildLatencyMetrics } from "@/utils/requestPerformance";

const props = defineProps<{
  sessionId: string | null;
  /** Whether shutdown totals are on screen, so this section can name itself apart. */
  hasShutdownTotals?: boolean;
  /**
   * Open without being asked, once: when there are no shutdown metrics the
   * recorded requests are the only figures the session has.
   */
  defaultExpanded?: boolean;
}>();

const expanded = ref(false);
const toggledByUser = ref(false);
watch(
  () => props.defaultExpanded,
  (open) => {
    if (open && !toggledByUser.value) expanded.value = true;
  },
  { immediate: true },
);
function toggle(): void {
  toggledByUser.value = true;
  expanded.value = !expanded.value;
}
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

const filtered = computed(() => ledger.activeFilterCount.value > 0);

/** With no shutdown there is no final total — only what has been recorded. */
const requestCountLabel = computed(() =>
  props.hasShutdownTotals ? "Recorded requests" : "Recorded requests so far",
);

const requestCount = computed(() => {
  const total = ledger.coverage.value?.requestRows ?? null;
  const matched = ledger.summary.value?.requestCount ?? null;
  if (filtered.value && matched != null && total != null) return `${matched} of ${total}`;
  return total ?? matched ?? ledger.requests.value.length;
});

const pageCount = computed(() => {
  const matched = ledger.summary.value?.requestCount;
  return matched ? Math.ceil(matched / REQUEST_LEDGER_PAGE_SIZE) : null;
});

/** The exact recorded charge over every matching request, flagged if partial. */
const credits = computed(() => {
  const summary = ledger.summary.value;
  if (!summary) return { text: NOT_RECORDED, label: "Recorded credits", detail: "" };
  const excluded = summary.unchargedRequests + summary.unreadableCharges;
  const parts = [
    `${summary.chargedRequests} of ${summary.requestCount} requests recorded a charge`,
  ];
  if (summary.unchargedRequests > 0) parts.push(`${summary.unchargedRequests} recorded none`);
  if (summary.unreadableCharges > 0) {
    parts.push(`${summary.unreadableCharges} recorded an unreadable charge and are excluded`);
  }
  const scope = filtered.value ? "Requests matching the filters" : "Every recorded request";
  return {
    text: formatNanoAiu(summary.totalNanoAiu),
    label: excluded > 0 ? "Recorded credits (partial)" : "Recorded credits",
    detail: `${scope}: ${parts.join("; ")}. The recorded charge, not a repricing.`,
  };
});

/** Whole-session timing and reuse; they do not follow the filters. */
const timing = computed(() => {
  const performance = ledger.performance.value;
  if (!performance || performance.durationMs.coverage.valid === 0) return null;
  const metric = buildLatencyMetrics(performance).find((entry) => entry.key === "durationMs");
  if (!metric) return null;
  const p95 = metric.p95Absence ? "p95 needs 20 samples" : `p95 ${metric.p95}`;
  return {
    text: metric.median,
    detail: `${p95} · ${metric.coverageText}. ${metric.note} Whole session; filters do not apply.`,
  };
});

const reuse = computed(() => {
  const performance = ledger.performance.value;
  if (!performance || performance.cache.requestsWithCounter === 0) return null;
  const view = buildCacheReuse(performance.cache);
  return {
    text: view.tokenWeighted.value,
    detail: `${view.tokenWeighted.detail} ${view.requestWeighted.value} of requests recorded any reuse. Whole session; filters do not apply.`,
  };
});

const coverage = computed(() => ledger.coverage.value);

/**
 * Only said when there is something to compare against: a running session
 * with no shutdown yet would otherwise read "not compared" on every visit.
 */
const reconciliation = computed(() =>
  props.hasShutdownTotals ? reconciliationSentence(coverage.value) : null,
);

const stale = computed(() => staleNote(coverage.value, ledger.source.value?.availability ?? null));

const incomplete = computed(() => {
  const c = coverage.value;
  return (
    c !== null && (c.requestRowsRejected > 0 || c.billingInvalid > 0 || c.missingColumns.length > 0)
  );
});

/** The store may be bound and readable while this session has no rows in it. */
const unavailableDetail = computed(() => {
  const availability = ledger.source.value?.availability ?? coverage.value?.availability;
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
      @click="toggle"
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
        dismissible
        class="mb-4"
        data-testid="request-ledger-cursor-reset"
        @dismiss="ledger.dismissCursorReset()"
      >
        This session's recorded requests changed while paging, so the ledger restarted at
        the first page rather than mixing two versions of them.
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
              :value="requestCount"
              :label="requestCountLabel"
              tooltip="Requests recorded in the session store. Shutdown totals are a separate figure and count different work."
              mini
            />
            <StatCard
              :value="credits.text"
              :label="credits.label"
              :tooltip="credits.detail"
              mini
              data-testid="request-ledger-credits"
            />
            <StatCard
              v-if="timing"
              :value="timing.text"
              label="Median duration"
              :tooltip="timing.detail"
              mini
            />
            <StatCard
              v-if="reuse"
              :value="reuse.text"
              label="Cache reads / input"
              :tooltip="reuse.detail"
              mini
            />
          </div>

          <p v-if="coverage" class="ledger__meta" data-testid="request-ledger-sync">
            Read from the session store
            <time :datetime="coverage.readAt" :title="formatDate(coverage.readAt)">
              {{ formatRelativeTime(coverage.readAt) }}
            </time>
            <span v-if="stale" :class="{ ledger__stale: stale.attention }">
              · {{ stale.text }}
            </span>
          </p>

          <p v-if="hasShutdownTotals" class="ledger__note">
            These are observed requests from the session store. The session totals
            above come from the shutdown record and are not the same figure.
            <span v-if="reconciliation" data-testid="request-ledger-reconciliation-summary">
              {{ reconciliation }}
            </span>
          </p>

          <Banner
            v-if="incomplete && coverage"
            tone="warning"
            class="mb-4"
            data-testid="request-ledger-partial-coverage"
          >
            This ledger is incomplete, so any sum below is partial:
            <template v-if="coverage.requestRowsRejected > 0">
              {{ coverage.requestRowsRejected }} request rows were rejected.
            </template>
            <template v-if="coverage.billingInvalid > 0">
              {{ coverage.billingInvalid }} requests had invalid billing items.
            </template>
            <template v-if="coverage.billingPartial > 0">
              {{ coverage.billingPartial }} had partial billing items.
            </template>
            <template v-if="coverage.missingColumns.length > 0">
              Missing source columns: {{ coverage.missingColumns.join(", ") }}.
            </template>
          </Banner>

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

            <div
              v-if="ledger.hasNextPage.value || ledger.hasPreviousPage.value"
              class="ledger__pager"
            >
              <ActionButton
                size="sm"
                :disabled="!ledger.hasPreviousPage.value || ledger.loading.value"
                @click="ledger.previousPage()"
              >
                Previous
              </ActionButton>
              <span class="ledger__note">
                Page {{ ledger.pageNumber.value
                }}<template v-if="pageCount"> of {{ pageCount }}</template>
              </span>
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
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 8px;
}
.ledger__meta {
  margin: 0 0 12px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.ledger__stale {
  color: var(--attention-fg);
}
.ledger__note {
  max-width: 80ch;
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
