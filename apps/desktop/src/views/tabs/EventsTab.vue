<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";

const store = useSessionDetailStore();
const filterType = ref<string | null>(null);
const pageSize = 100;
const currentPage = ref(0);

watch(
  () => store.sessionId,
  (id) => {
    filterType.value = null;
    currentPage.value = 0;
    if (!id) return;
    void store.loadEvents(0, pageSize);
  },
  { immediate: true }
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

async function loadPage(page: number) {
  currentPage.value = page;
  await store.loadEvents(page * pageSize, pageSize);
}

function formatTimestamp(ts?: string): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString();
}

function eventTypeColor(type: string): string {
  if (type.startsWith("session.")) return "text-[var(--color-accent-fg)]";
  if (type.startsWith("user.")) return "text-[var(--color-success-fg)]";
  if (type.startsWith("assistant.")) return "text-[var(--color-done-fg)]";
  if (type.startsWith("tool.")) return "text-[var(--color-warning-fg)]";
  if (type.startsWith("context.")) return "text-cyan-400";
  if (type.startsWith("subagent.")) return "text-[var(--color-accent-fg)]";
  return "text-[var(--color-text-secondary)]";
}

function eventTypeBg(type: string): string {
  if (type.startsWith("session.")) return "bg-[var(--color-accent-muted)]";
  if (type.startsWith("user.")) return "bg-[var(--color-success-muted)]";
  if (type.startsWith("assistant.")) return "bg-[var(--color-done-muted)]";
  if (type.startsWith("tool.")) return "bg-[var(--color-warning-muted)]";
  return "bg-[var(--color-neutral-muted)]";
}
</script>

<template>
  <div class="space-y-4">
    <!-- Filter bar -->
    <div class="flex items-center gap-3">
      <select
        v-model="filterType"
        class="rounded-md border border-[var(--color-border-default)] bg-[var(--color-canvas-default)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent-fg)] focus:outline-none transition-colors cursor-pointer"
      >
        <option :value="null">All event types</option>
        <option v-for="type in eventTypes" :key="type" :value="type">{{ type }}</option>
      </select>
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
    <div class="overflow-hidden rounded-lg border border-[var(--color-border-default)]">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-[var(--color-canvas-subtle)] text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">
            <th class="w-12 px-4 py-2.5 text-left font-medium">#</th>
            <th class="px-4 py-2.5 text-left font-medium">Type</th>
            <th class="w-24 px-4 py-2.5 text-left font-medium">Time</th>
            <th class="px-4 py-2.5 text-left font-medium">ID</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(event, idx) in filteredEvents"
            :key="`${event.id ?? event.eventType}-${idx}`"
            class="border-t border-[var(--color-border-muted)] transition-colors hover:bg-[var(--color-canvas-subtle)]"
          >
            <td class="px-4 py-2 text-xs text-[var(--color-text-tertiary)]">{{ currentPage * pageSize + idx + 1 }}</td>
            <td class="px-4 py-2">
              <span
                class="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-xs"
                :class="[eventTypeColor(event.eventType), eventTypeBg(event.eventType)]"
              >
                {{ event.eventType }}
              </span>
            </td>
            <td class="px-4 py-2 text-xs text-[var(--color-text-secondary)]">{{ formatTimestamp(event.timestamp) }}</td>
            <td class="max-w-[200px] truncate px-4 py-2 font-mono text-xs text-[var(--color-text-tertiary)]">
              {{ event.id || "—" }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="totalCount > pageSize" class="flex items-center justify-between">
      <button
        :disabled="currentPage === 0"
        class="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-sidebar-hover)] disabled:opacity-50"
        @click="loadPage(currentPage - 1)"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
        Previous
      </button>
      <span class="text-xs text-[var(--color-text-secondary)]">
        Page {{ currentPage + 1 }} of {{ Math.ceil(totalCount / pageSize) }}
      </span>
      <button
        :disabled="!hasMore"
        class="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-sidebar-hover)] disabled:opacity-50"
        @click="loadPage(currentPage + 1)"
      >
        Next
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  </div>
</template>
