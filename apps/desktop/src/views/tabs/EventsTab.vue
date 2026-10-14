<script setup lang="ts">
import {
  ActionButton,
  Badge,
  ErrorAlert,
  ExpandChevron,
  FilterSelect,
  formatTime,
  useSessionTabLoader,
} from "@tracepilot/ui";
import { computed, ref, useId, watch } from "vue";
import EventPayload from "@/components/events/EventPayload.vue";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";

const store = useSessionDetailContext();
const filterType = ref<string | null>(null);
const pageSize = 50;
// The page and filter the shown rows belong to; they move only after a load succeeds.
const currentPage = ref(0);
const shownFilter = ref<string | null>(null);
const pageLoading = ref(false);
let loadSeq = 0;
// The last page asked for, which is what Retry asks for again.
let requestedPage = 0;

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadEvents(0, pageSize),
  {
    onClear() {
      filterType.value = null;
      shownFilter.value = null;
      currentPage.value = 0;
      requestedPage = 0;
    },
  },
);

// Derive event types from the full unfiltered set returned by the backend
const eventTypes = computed(() => {
  if (!store.events) return [];
  return store.events.allEventTypes ?? [];
});

// Events are unknown, not absent, until a page has loaded: while loading, or
// when the first load fails, there is no count and no "none found".
const eventsKnown = computed(() => store.events != null && store.loaded.has("events"));
const eventsPending = computed(() => !eventsKnown.value && !store.eventsError);

/**
 * Load a page for the current filter; the latest call wins. A quiet load (a
 * refresh) leaves paging enabled, and any newer page request supersedes it.
 */
async function fetchPage(page: number, quiet = false) {
  const seq = ++loadSeq;
  const id = store.sessionId;
  const filter = filterType.value;
  requestedPage = page;
  if (!quiet) pageLoading.value = true;
  try {
    await store.loadEvents(page * pageSize, pageSize, filter ?? undefined);
    // loadEvents reports failure through eventsError rather than throwing.
    if (seq !== loadSeq || store.sessionId !== id || store.eventsError) return;
    currentPage.value = page;
    shownFilter.value = filter;
  } finally {
    if (seq === loadSeq) pageLoading.value = false;
  }
}

// When filter changes, reload from page 0 with filter
watch(filterType, () => fetchPage(0));

// The session was refreshed (Refresh, auto-refresh, the running-session poll
// or a live update): reload the page and filter in view. The rows stay on
// screen until the new ones arrive.
watch(
  () => store.eventsRefreshVersion,
  () => {
    if (store.loaded.has("events")) void fetchPage(requestedPage, true);
  },
);

const totalCount = computed(() => store.events?.totalCount ?? 0);
const hasMore = computed(() => store.events?.hasMore ?? false);
const displayEvents = computed(() => store.events?.events ?? []);

function eventBadgeVariant(
  type: string,
): "accent" | "success" | "done" | "warning" | "neutral" | "danger" {
  if (type === "session.error") return "danger";
  if (type === "session.warning") return "warning";
  if (type.startsWith("session.compaction")) return "warning";
  if (type === "session.truncation") return "warning";
  if (type.startsWith("session.")) return "accent";
  if (type.startsWith("user.")) return "success";
  if (type.startsWith("assistant.")) return "done";
  if (type.startsWith("tool.")) return "warning";
  if (type.startsWith("context.")) return "accent";
  if (type.startsWith("subagent.")) return "done";
  return "neutral";
}

const tableRows = computed(() =>
  displayEvents.value.map((e, idx) => {
    const rowNum = currentPage.value * pageSize + idx + 1;
    // Stable across a refresh of the same page, since events only append.
    return { ...e, rowNum, key: `${rowNum}:${e.id ?? ""}` };
  }),
);

// Rows whose payload is open. A refresh keeps them; another page or filter clears them.
const expanded = ref(new Set<string>());
watch([currentPage, shownFilter], () => expanded.value.clear());

function toggleRow(key: string) {
  if (expanded.value.has(key)) expanded.value.delete(key);
  else expanded.value.add(key);
}

function onRowClick(key: string) {
  // Selecting text in a row (an ID, say) is not a click on it.
  if (window.getSelection()?.toString()) return;
  toggleRow(key);
}

const idBase = useId();
function payloadId(rowNum: number) {
  return `${idBase}-payload-${rowNum}`;
}

function loadPage(page: number) {
  if (pageLoading.value) return;
  void fetchPage(page);
}

function retryLoadEvents() {
  void fetchPage(requestedPage);
}
</script>

<template>
  <div>
    <!-- Error alert for failed event loading -->
    <ErrorAlert
      v-if="store.eventsError"
      :message="store.eventsError"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadEvents"
    />

    <!-- Header with count -->
    <div class="flex items-center gap-3 mb-4">
      <FilterSelect
        v-model="filterType"
        :options="eventTypes"
        placeholder="All event types"
      />
      <span v-if="eventsKnown" class="text-xs text-[var(--text-secondary)]">
        <template v-if="shownFilter">
          {{ totalCount }} matching event{{ totalCount !== 1 ? 's' : '' }}
        </template>
        <template v-else>
          {{ totalCount }} total event{{ totalCount !== 1 ? 's' : '' }}
        </template>
      </span>
    </div>

    <p v-if="eventsPending" role="status" class="text-sm text-[var(--text-tertiary)]">
      Loading events…
    </p>

    <!-- Events table: each row opens to show its data payload. -->
    <div v-else-if="eventsKnown" class="data-table-wrapper events-table">
      <table class="data-table">
        <thead>
          <tr>
            <th class="events-table__toggle"><span class="sr-only">Payload</span></th>
            <th>#</th>
            <th>Type</th>
            <th>Time</th>
            <th>ID</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in tableRows" :key="row.key">
            <tr
              class="events-table__row"
              :class="{ 'events-table__row--open': expanded.has(row.key) }"
              @click="onRowClick(row.key)"
            >
              <td class="events-table__toggle">
                <button
                  type="button"
                  class="events-table__toggle-button"
                  :aria-expanded="expanded.has(row.key)"
                  :aria-controls="expanded.has(row.key) ? payloadId(row.rowNum) : undefined"
                  :aria-label="`${expanded.has(row.key) ? 'Hide' : 'Show'} payload of event ${row.rowNum}`"
                  @click.stop="toggleRow(row.key)"
                >
                  <ExpandChevron :expanded="expanded.has(row.key)" />
                </button>
              </td>
              <td><span class="text-xs text-[var(--text-tertiary)]">{{ row.rowNum }}</span></td>
              <td><Badge :variant="eventBadgeVariant(row.eventType)">{{ row.eventType }}</Badge></td>
              <td>
                <span class="text-xs text-[var(--text-secondary)]">{{ formatTime(row.timestamp) }}</span>
              </td>
              <td>
                <span class="max-w-[200px] truncate font-mono text-xs text-[var(--text-tertiary)] block">
                  {{ row.id || "—" }}
                </span>
              </td>
            </tr>
            <tr v-if="expanded.has(row.key)" :id="payloadId(row.rowNum)" class="events-table__payload">
              <td colspan="5">
                <EventPayload :data="row.data" />
              </td>
            </tr>
          </template>
          <tr v-if="tableRows.length === 0">
            <td colspan="5" class="px-5 py-8 text-center text-[var(--text-secondary)]">No events found.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="eventsKnown && totalCount > pageSize" class="flex items-center justify-between mt-4">
      <ActionButton :disabled="currentPage === 0 || pageLoading" size="sm" @click="loadPage(currentPage - 1)">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
        Previous
      </ActionButton>
      <span class="text-xs text-[var(--text-secondary)]">
        Page {{ currentPage + 1 }} of {{ Math.ceil(totalCount / pageSize) }}
      </span>
      <ActionButton :disabled="!hasMore || pageLoading" size="sm" @click="loadPage(currentPage + 1)">
        Next
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
      </ActionButton>
    </div>
  </div>
</template>

<style scoped>
.events-table {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.events-table__row {
  cursor: pointer;
}
.events-table__row--open,
.events-table__row--open:hover {
  background: var(--surface-secondary);
}
.data-table .events-table__toggle {
  width: 40px;
  padding-right: 0;
}
.events-table__toggle-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
}
.events-table__toggle-button:hover {
  background: var(--neutral-muted);
}
.data-table .events-table__payload td {
  padding: 4px 14px 12px;
  background: var(--surface-secondary);
}
.data-table tbody .events-table__payload:hover {
  background: transparent;
}
</style>
