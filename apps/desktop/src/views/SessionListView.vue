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
let searchSequence = 0;

const displayedSessions = computed(() => {
  let sessions = searchResults.value !== null
    ? [...searchResults.value]
    : [...store.filteredSessions];

  if (store.searchQuery && searchResults.value === null) {
    const q = store.searchQuery.toLowerCase();
    sessions = sessions.filter(s =>
      (s.summary?.toLowerCase().includes(q)) ||
      (s.repository?.toLowerCase().includes(q)) ||
      (s.branch?.toLowerCase().includes(q)) ||
      s.id.toLowerCase().includes(q)
    );
  }

  if (searchResults.value !== null) {
    if (store.filterRepo) {
      sessions = sessions.filter(s => s.repository === store.filterRepo);
    }
    if (store.filterBranch) {
      sessions = sessions.filter(s => s.branch === store.filterBranch);
    }
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

  // Increment sequence on every change (including clear) to invalidate in-flight requests
  const seq = ++searchSequence;

  if (!query.trim()) {
    searchResults.value = null;
    isSearching.value = false;
    return;
  }

  searchTimeout.value = setTimeout(async () => {
    isSearching.value = true;
    try {
      const results = await searchSessions(query);
      if (seq !== searchSequence) return;
      searchResults.value = results;
    } catch {
      if (seq !== searchSequence) return;
      searchResults.value = null;
    } finally {
      if (seq === searchSequence) isSearching.value = false;
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
  router.push({ name: "session-overview", params: { id: sessionId } });
}

onMounted(() => {
  if (store.sessions.length === 0) {
    store.fetchSessions();
  }
});
</script>

<template>
  <div class="space-y-5">
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">Sessions</h1>
        <p class="text-sm text-[var(--color-text-secondary)] mt-0.5">
          Browse and inspect your Copilot CLI sessions
        </p>
      </div>
      <button
        class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-sidebar-hover)] transition-colors disabled:opacity-50"
        :disabled="isReindexing"
        @click="handleReindex"
      >
        <svg class="h-4 w-4" :class="{ 'animate-spin': isReindexing }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {{ isReindexing ? 'Indexing...' : 'Reindex' }}
      </button>
    </div>

    <!-- Search + filters bar -->
    <div class="flex flex-col sm:flex-row gap-3">
      <div class="flex-1">
        <SearchInput
          :model-value="store.searchQuery"
          placeholder="Search sessions by name, repo, branch..."
          @update:model-value="onSearchInput"
        />
      </div>
      <div class="flex gap-2">
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
          class="rounded-md border border-[var(--color-border-default)] bg-[var(--color-canvas-default)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent-fg)] focus:outline-none transition-colors cursor-pointer"
        >
          <option value="updated">Recently updated</option>
          <option value="created">Recently created</option>
          <option value="events">Most events</option>
        </select>
      </div>
    </div>

    <!-- Status bar -->
    <div class="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
      <span v-if="isSearching" class="flex items-center gap-1.5">
        <svg class="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        Searching...
      </span>
      <span v-else-if="store.loading">Loading sessions...</span>
      <span v-else>
        {{ displayedSessions.length }} session{{ displayedSessions.length !== 1 ? 's' : '' }}
        <span v-if="store.searchQuery"> matching "{{ store.searchQuery }}"</span>
      </span>
    </div>

    <!-- Error state -->
    <div v-if="store.error" class="rounded-lg bg-[var(--color-danger-muted)] border border-[var(--color-danger-fg)]/20 p-4 text-sm text-[var(--color-danger-fg)]">
      {{ store.error }}
    </div>

    <!-- Session grid -->
    <SessionList
      v-if="!store.loading"
      :sessions="displayedSessions"
      @select="onSelect"
    />

    <!-- Loading skeleton -->
    <div v-if="store.loading" class="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="i in 6" :key="i" class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] p-4 animate-pulse">
        <div class="h-4 bg-[var(--color-border-muted)] rounded w-3/4 mb-3" />
        <div class="flex gap-2 mb-3">
          <div class="h-5 bg-[var(--color-border-muted)] rounded-full w-20" />
          <div class="h-5 bg-[var(--color-border-muted)] rounded-full w-16" />
        </div>
        <div class="h-3 bg-[var(--color-border-muted)] rounded w-1/2" />
      </div>
    </div>
  </div>
</template>
