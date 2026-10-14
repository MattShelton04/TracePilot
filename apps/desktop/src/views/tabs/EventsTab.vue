<script setup lang="ts">
import {
  ActionButton,
  Badge,
  DataTable,
  ErrorAlert,
  FilterSelect,
  formatTime,
  useSessionTabLoader,
} from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
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

async function fetchPage(page: number) {
  const seq = ++loadSeq;
  const id = store.sessionId;
  const filter = filterType.value;
  requestedPage = page;
  pageLoading.value = true;
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

const eventColumns = [
  { key: "rowNum", label: "#", align: "left" as const },
  { key: "eventType", label: "Type", align: "left" as const },
  { key: "timestamp", label: "Time", align: "left" as const },
  { key: "id", label: "ID", align: "left" as const },
];

const tableRows = computed(() =>
  displayEvents.value.map((e, idx) => ({
    ...e,
    rowNum: currentPage.value * pageSize + idx + 1,
  })),
);

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

    <!-- Events table -->
    <DataTable
      v-else-if="eventsKnown"
      :columns="eventColumns"
      :rows="tableRows"
      empty-message="No events found."
    >
      <template #cell-rowNum="{ value }">
        <span class="text-xs text-[var(--text-tertiary)]">{{ value }}</span>
      </template>
      <template #cell-eventType="{ value }">
        <Badge :variant="eventBadgeVariant(value as string)">{{ value }}</Badge>
      </template>
      <template #cell-timestamp="{ value }">
        <span class="text-xs text-[var(--text-secondary)]">{{ formatTime(value as string) }}</span>
      </template>
      <template #cell-id="{ value }">
        <span class="max-w-[200px] truncate font-mono text-xs text-[var(--text-tertiary)] block">
          {{ value || "—" }}
        </span>
      </template>
    </DataTable>

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
