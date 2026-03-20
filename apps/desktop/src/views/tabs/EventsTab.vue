<script setup lang="ts">
import { computed, ref } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { Badge, DataTable, ActionButton, FilterSelect, formatTime, useSessionTabLoader } from "@tracepilot/ui";

const store = useSessionDetailStore();
const filterType = ref<string | null>(null);
const pageSize = 50;
const currentPage = ref(0);
const pageLoading = ref(false);

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadEvents(0, pageSize),
  {
    onClear() {
      filterType.value = null;
      currentPage.value = 0;
    },
  }
);

const eventTypes = computed(() => {
  if (!store.events) return [];
  const types = new Set(store.events.events.map((event) => event.eventType));
  return [...types].sort();
});

const filteredEvents = computed(() => {
  if (!store.events) return [];
  if (!filterType.value) return store.events.events;
  return store.events.events.filter((event) => event.eventType === filterType.value);
});

const totalCount = computed(() => store.events?.totalCount ?? 0);
const hasMore = computed(() => store.events?.hasMore ?? false);

function eventBadgeVariant(type: string): 'accent' | 'success' | 'done' | 'warning' | 'neutral' | 'danger' {
  if (type === 'session.error') return 'danger';
  if (type === 'session.warning') return 'warning';
  if (type.startsWith('session.compaction')) return 'warning';
  if (type === 'session.truncation') return 'warning';
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
  filteredEvents.value.map((e, idx) => ({
    ...e,
    rowNum: currentPage.value * pageSize + idx + 1,
  }))
);

async function loadPage(page: number) {
  if (pageLoading.value) return;
  pageLoading.value = true;
  try {
    currentPage.value = page;
    await store.loadEvents(page * pageSize, pageSize);
  } finally {
    pageLoading.value = false;
  }
}
</script>

<template>
  <div>
    <!-- Header with count -->
    <div class="flex items-center gap-3 mb-4">
      <FilterSelect
        v-model="filterType"
        :options="eventTypes"
        placeholder="All event types"
      />
      <span class="text-xs text-[var(--text-secondary)]">
        <template v-if="filterType">
          {{ filteredEvents.length }} matching on this page · {{ totalCount }} total events
        </template>
        <template v-else>
          {{ filteredEvents.length }} of {{ totalCount }} events
        </template>
      </span>
    </div>

    <!-- Events table -->
    <DataTable :columns="eventColumns" :rows="tableRows" empty-message="No events found.">
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
    <div v-if="totalCount > pageSize" class="flex items-center justify-between mt-4">
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
