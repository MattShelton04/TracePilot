<script setup lang="ts">
import { onMounted, computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useSessionsStore } from "@/stores/sessions";
import { searchSessions, reindexSessions } from "@tracepilot/client";
import { SessionList, SearchInput, FilterSelect } from "@tracepilot/ui";
import type { SessionListItem } from "@tracepilot/types";

const router = useRouter();
const store = useSessionsStore();
const searchResults = ref<SessionListItem[] | null>(null);
const isSearching = ref(false);
const isReindexing = ref(false);
const searchTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

const displayedSessions = computed(() => {
  if (searchResults.value !== null) return searchResults.value;

  let sessions = [...store.filteredSessions];

  if (store.searchQuery && !searchResults.value) {
    const q = store.searchQuery.toLowerCase();
    sessions = sessions.filter(s =>
      (s.summary?.toLowerCase().includes(q)) ||
      (s.repository?.toLowerCase().includes(q)) ||
      (s.branch?.toLowerCase().includes(q)) ||
      s.id.toLowerCase().includes(q)
    );
  }

  sessions.sort((a, b) => {
    switch (store.sortBy) {
      case 'created':
        return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
      case 'events':
        return (b.eventCount ?? 0) - (a.eventCount ?? 0);
      case 'updated':
      default:
        return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    }
  });

  return sessions;
});

function onSearchInput(query: string) {
  store.searchQuery = query;

  if (searchTimeout.value) clearTimeout(searchTimeout.value);

  if (!query.trim()) {
    searchResults.value = null;
    return;
  }

  searchTimeout.value = setTimeout(async () => {
    isSearching.value = true;
    try {
      searchResults.value = await searchSessions(query);
    } catch {
      searchResults.value = null;
    } finally {
      isSearching.value = false;
    }
  }, 300);
}

async function handleReindex() {
  isReindexing.value = true;
  try {
    await reindexSessions();
    await store.fetchSessions();
  } finally {
    isReindexing.value = false;
  }
}

function onSelect(sessionId: string) {
  router.push({ name: "session-detail", params: { id: sessionId } });
}

onMounted(() => {
  store.fetchSessions();
});
</script>

<template>
  <div class="space-y-4">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex-1 min-w-[200px]">
        <SearchInput
          :model-value="store.searchQuery"
          placeholder="Search sessions..."
          @update:model-value="onSearchInput"
        />
      </div>
      <FilterSelect
        v-model="store.filterRepo"
        :options="store.repositories as string[]"
        placeholder="All repos"
      />
      <FilterSelect
        v-model="store.filterBranch"
        :options="store.branches as string[]"
        placeholder="All branches"
      />
      <select
        v-model="store.sortBy"
        class="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
      >
        <option value="updated">Recently updated</option>
        <option value="created">Recently created</option>
        <option value="events">Most events</option>
      </select>
      <button
        class="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
        :disabled="isReindexing"
        @click="handleReindex"
      >
        {{ isReindexing ? 'Indexing...' : '↻ Reindex' }}
      </button>
    </div>

    <!-- Status -->
    <div v-if="isSearching" class="text-sm text-[var(--text-muted)]">Searching...</div>
    <div v-if="store.loading" class="text-sm text-[var(--text-muted)]">Loading sessions...</div>
    <div v-else-if="store.error" class="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-[var(--error)]">
      {{ store.error }}
    </div>

    <!-- Session count -->
    <div v-if="!store.loading && !store.error" class="text-xs text-[var(--text-muted)]">
      {{ displayedSessions.length }} session{{ displayedSessions.length !== 1 ? 's' : '' }}
      <span v-if="store.searchQuery"> matching "{{ store.searchQuery }}"</span>
    </div>

    <!-- Session grid -->
    <SessionList
      v-if="!store.loading"
      :sessions="displayedSessions"
      @select="onSelect"
    />
  </div>
</template>
