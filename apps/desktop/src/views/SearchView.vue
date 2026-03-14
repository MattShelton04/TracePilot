<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { searchSessions, reindexSessions } from "@tracepilot/client";
import { SearchInput, SessionList } from "@tracepilot/ui";
import type { SessionListItem } from "@tracepilot/types";

const router = useRouter();
const query = ref("");
const results = ref<SessionListItem[]>([]);
const loading = ref(false);
const hasSearched = ref(false);
const isReindexing = ref(false);

async function doSearch() {
  if (!query.value.trim()) return;
  loading.value = true;
  hasSearched.value = true;
  try {
    results.value = await searchSessions(query.value);
  } catch (e) {
    console.error("Search failed:", e);
    results.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleReindex() {
  isReindexing.value = true;
  try {
    await reindexSessions();
    if (query.value.trim()) await doSearch();
  } finally {
    isReindexing.value = false;
  }
}

function onSelect(sessionId: string) {
  router.push({ name: "session-detail", params: { id: sessionId } });
}
</script>

<template>
  <div class="space-y-4">
    <h2 class="text-xl font-semibold">Search Sessions</h2>
    <form @submit.prevent="doSearch" class="flex gap-2">
      <div class="flex-1">
        <SearchInput v-model="query" placeholder="Search by summary, repo, branch..." />
      </div>
      <button
        type="submit"
        :disabled="loading"
        class="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {{ loading ? 'Searching...' : 'Search' }}
      </button>
    </form>
    <div v-if="hasSearched && !loading" class="flex items-center gap-3">
      <span class="text-xs text-[var(--text-muted)]">
        {{ results.length }} result{{ results.length !== 1 ? 's' : '' }}
      </span>
      <button
        v-if="results.length === 0"
        class="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
        :disabled="isReindexing"
        @click="handleReindex"
      >
        {{ isReindexing ? 'Reindexing...' : 'No results — try reindexing?' }}
      </button>
    </div>
    <SessionList v-if="hasSearched" :sessions="results" @select="onSelect" />
  </div>
</template>
