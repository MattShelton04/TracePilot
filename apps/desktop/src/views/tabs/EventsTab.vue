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
    if (!id) {
      return;
    }

    void store.loadEvents(0, pageSize);
  },
  { immediate: true }
);

const eventTypes = computed(() => {
  if (!store.events) {
    return [];
  }

  const types = new Set(store.events.events.map((event) => event.eventType));
  return [...types].sort();
});

const filteredEvents = computed(() => {
  if (!store.events) {
    return [];
  }

  if (!filterType.value) {
    return store.events.events;
  }

  return store.events.events.filter((event) => event.eventType === filterType.value);
});

const totalCount = computed(() => store.events?.totalCount ?? 0);
const hasMore = computed(() => store.events?.hasMore ?? false);

async function loadPage(page: number) {
  currentPage.value = page;
  await store.loadEvents(page * pageSize, pageSize);
}

function formatTimestamp(ts?: string): string {
  if (!ts) {
    return "—";
  }

  return new Date(ts).toLocaleTimeString();
}

function eventTypeColor(type: string): string {
  if (type.startsWith("session.")) {
    return "text-[var(--accent)]";
  }

  if (type.startsWith("user.")) {
    return "text-green-400";
  }

  if (type.startsWith("assistant.")) {
    return "text-purple-400";
  }

  if (type.startsWith("tool.")) {
    return "text-[var(--warning)]";
  }

  if (type.startsWith("context.")) {
    return "text-cyan-400";
  }

  return "text-[var(--text-muted)]";
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <select
        v-model="filterType"
        class="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
      >
        <option :value="null">All event types</option>
        <option v-for="type in eventTypes" :key="type" :value="type">{{ type }}</option>
      </select>
      <span class="text-xs text-[var(--text-muted)]">
        <template v-if="filterType">
          {{ filteredEvents.length }} matching on this page · {{ totalCount }} total events
        </template>
        <template v-else>
          {{ filteredEvents.length }} of {{ totalCount }} events
        </template>
      </span>
    </div>

    <div class="overflow-hidden rounded-lg border border-[var(--border)]">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-[var(--surface)] text-xs uppercase tracking-wider text-[var(--text-muted)]">
            <th class="w-12 px-4 py-2 text-left">#</th>
            <th class="px-4 py-2 text-left">Type</th>
            <th class="w-24 px-4 py-2 text-left">Time</th>
            <th class="px-4 py-2 text-left">ID</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(event, idx) in filteredEvents"
            :key="`${event.id ?? event.eventType}-${idx}`"
            class="border-t border-[var(--border)] transition-colors hover:bg-[var(--surface)]/50"
          >
            <td class="px-4 py-2 text-xs text-[var(--text-muted)]">{{ currentPage * pageSize + idx + 1 }}</td>
            <td class="px-4 py-2">
              <span :class="eventTypeColor(event.eventType)" class="font-mono text-xs">
                {{ event.eventType }}
              </span>
            </td>
            <td class="px-4 py-2 text-xs text-[var(--text-muted)]">{{ formatTimestamp(event.timestamp) }}</td>
            <td class="max-w-[200px] truncate px-4 py-2 font-mono text-xs text-[var(--text-muted)]">
              {{ event.id || "—" }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="totalCount > pageSize" class="flex items-center justify-between">
      <button
        :disabled="currentPage === 0"
        class="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
        @click="loadPage(currentPage - 1)"
      >
        ← Previous
      </button>
      <span class="text-xs text-[var(--text-muted)]">
        Page {{ currentPage + 1 }} of {{ Math.ceil(totalCount / pageSize) }}
      </span>
      <button
        :disabled="!hasMore"
        class="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
        @click="loadPage(currentPage + 1)"
      >
        Next →
      </button>
    </div>
  </div>
</template>
