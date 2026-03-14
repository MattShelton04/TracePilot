<script setup lang="ts">
import { computed, ref } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { DataTable, ActionButton, FilterSelect, formatTime, useSessionTabLoader } from "@tracepilot/ui";

const store = useSessionDetailStore();
const filterType = ref<string | null>(null);
const pageSize = 100;
const currentPage = ref(0);

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
  currentPage.value = page;
  await store.loadEvents(page * pageSize, pageSize);
}

function eventTypeColor(type: string): string {
  if (type.startsWith("session.")) return "text-[var(--color-accent-fg)]";
  if (type.startsWith("user.")) return "text-[var(--color-success-fg)]";
  if (type.startsWith("assistant.")) return "text-[var(--color-done-fg)]";
  if (type.startsWith("tool.")) return "text-[var(--color-warning-fg)]";
  if (type.startsWith("context.")) return "text-[var(--color-accent-fg)]";
  if (type.startsWith("subagent.")) return "text-[var(--color-done-fg)]";
  return "text-[var(--color-text-secondary)]";
}

function eventTypeBg(type: string): string {
  if (type.startsWith("session.")) return "bg-[var(--color-accent-muted)]";
  if (type.startsWith("user.")) return "bg-[var(--color-success-muted)]";
  if (type.startsWith("assistant.")) return "bg-[var(--color-done-muted)]";
  if (type.startsWith("tool.")) return "bg-[var(--color-warning-muted)]";
  if (type.startsWith("context.")) return "bg-[var(--color-accent-muted)]";
  if (type.startsWith("subagent.")) return "bg-[var(--color-done-muted)]";
  return "bg-[var(--color-neutral-muted)]";
}
</script>

<template>
  <div class="space-y-4">
    <!-- Filter bar -->
    <div class="flex items-center gap-3">
      <FilterSelect
        v-model="filterType"
        :options="eventTypes"
        placeholder="All event types"
      />
      <span class="text-xs text-[var(--color-text-secondary)]">
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
        <span class="text-xs text-[var(--color-text-tertiary)]">{{ value }}</span>
      </template>
      <template #cell-eventType="{ value }">
        <span
          class="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-xs"
          :class="[eventTypeColor(value as string), eventTypeBg(value as string)]"
        >
          {{ value }}
        </span>
      </template>
      <template #cell-timestamp="{ value }">
        <span class="text-xs text-[var(--color-text-secondary)]">{{ formatTime(value as string) }}</span>
      </template>
      <template #cell-id="{ value }">
        <span class="max-w-[200px] truncate font-mono text-xs text-[var(--color-text-tertiary)] block">
          {{ value || "—" }}
        </span>
      </template>
    </DataTable>

    <!-- Pagination -->
    <div v-if="totalCount > pageSize" class="flex items-center justify-between">
      <ActionButton :disabled="currentPage === 0" size="sm" @click="loadPage(currentPage - 1)">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
        Previous
      </ActionButton>
      <span class="text-xs text-[var(--color-text-secondary)]">
        Page {{ currentPage + 1 }} of {{ Math.ceil(totalCount / pageSize) }}
      </span>
      <ActionButton :disabled="!hasMore" size="sm" @click="loadPage(currentPage + 1)">
        Next
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
      </ActionButton>
    </div>
  </div>
</template>
