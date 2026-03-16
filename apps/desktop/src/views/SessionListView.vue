<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useRouter } from "vue-router";
import { useSessionsStore, type SortOption } from "@/stores/sessions";
import { formatRelativeTime } from "@tracepilot/ui";
import { SearchInput, FilterSelect, Badge, ErrorAlert, SkeletonLoader, EmptyState, ProgressBar } from "@tracepilot/ui";
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { IndexingProgressPayload } from '@tracepilot/types';

const router = useRouter();
const store = useSessionsStore();

const indexingProgress = ref<IndexingProgressPayload | null>(null);
const unlisteners: UnlistenFn[] = [];

const repoOptions= computed(() => store.repositories as string[]);
const branchOptions = computed(() => store.branches as string[]);
const sortOptions = [
  { label: "Newest first", value: "updated" },
  { label: "Oldest first", value: "oldest" },
  { label: "Most events", value: "events" },
  { label: "Most turns", value: "turns" },
];

function onSelect(sessionId: string) {
  router.push({ name: "session-overview", params: { id: sessionId } });
}

onMounted(async () => {
  unlisteners.push(
    await listen<IndexingProgressPayload>('indexing-progress', (event) => {
      indexingProgress.value = event.payload;
    }),
    await listen('indexing-started', () => {
      indexingProgress.value = null;
    }),
    await listen('indexing-finished', () => {
      indexingProgress.value = null;
    }),
  );

  if (store.sessions.length === 0) {
    await store.fetchSessions();
    // If fetch returned empty (no index yet and no sessions on disk), show indexing UI
    if (store.sessions.length === 0 && !store.error) {
      await store.reindex();
      return;
    }
  }
  // Always ensure index is fresh in the background (non-blocking).
  // This handles: first launch (populates index from disk scan), subsequent launches
  // (picks up new sessions), and pruning deleted sessions.
  store.ensureIndex();
});

onUnmounted(() => {
  for (const unlisten of unlisteners) unlisten();
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">

      <!-- Toolbar -->
      <div class="toolbar" style="display: flex; gap: 12px; align-items: center; margin-bottom: 20px;">
        <SearchInput v-model="store.searchQuery" placeholder="Search sessions…" shortcut-hint="⌘K" />
        <FilterSelect v-model="store.filterRepo" :options="repoOptions" placeholder="All Repos" />
        <FilterSelect v-model="store.filterBranch" :options="branchOptions" placeholder="All Branches" />
        <select
          :value="store.sortBy"
          class="filter-select"
          aria-label="Sort sessions"
          @change="store.sortBy = ($event.target as HTMLSelectElement).value as SortOption"
        >
          <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <span class="session-count-label">
          {{ store.filteredSessions.length }} session{{ store.filteredSessions.length !== 1 ? 's' : '' }}
        </span>
      </div>

      <!-- Error state -->
      <ErrorAlert v-if="store.error" :message="store.error" />

      <!-- Indexing state -->
      <div v-if="store.indexing" class="loading-state">
        <div class="loading-state-inner">
          <div class="loading-spinner" />
          <div class="loading-text">
            <div class="text-sm font-medium text-[var(--text-primary)]">Indexing sessions…</div>
            <div class="text-xs text-[var(--text-tertiary)] mt-1">Building search index for faster loading. This only happens once.</div>
          </div>
        </div>
        <ProgressBar 
          :percent="indexingProgress ? (indexingProgress.current / indexingProgress.total * 100) : 0" 
          color="accent" 
          class="mt-4" 
          style="max-width: 400px; margin-inline: auto;" 
        />
        <div v-if="indexingProgress" class="text-xs text-[var(--text-tertiary)] mt-1" style="text-align: center;">
          {{ indexingProgress.current }} / {{ indexingProgress.total }} sessions
        </div>
      </div>

      <!-- Loading state -->
      <div v-else-if="store.loading" class="loading-state">
        <div class="loading-state-inner">
          <div class="loading-spinner" />
          <div class="loading-text">
            <div class="text-sm font-medium text-[var(--text-primary)]">Loading sessions…</div>
            <div class="text-xs text-[var(--text-tertiary)] mt-1">Fetching your recent Copilot sessions.</div>
          </div>
        </div>
      </div>

      <!-- Session cards grid -->
      <div v-else-if="store.filteredSessions.length > 0" class="grid-cards">
        <router-link
          v-for="session in store.filteredSessions"
          :key="session.id"
          :to="{ name: 'session-overview', params: { id: session.id } }"
          class="card card-interactive"
          style="text-decoration: none; color: inherit;"
        >
          <div class="session-card-title">{{ session.summary || 'Untitled Session' }}</div>
          <div class="session-card-badges">
            <Badge v-if="session.repository" variant="accent">{{ session.repository }}</Badge>
            <Badge v-if="session.branch" variant="success">{{ session.branch }}</Badge>
            <Badge v-if="session.currentModel" variant="done">{{ session.currentModel }}</Badge>
            <Badge variant="neutral">{{ session.hostType || 'cli' }}</Badge>
          </div>
          <div class="session-card-footer">
            <div class="session-card-stats">
              <span class="session-card-stat">{{ session.eventCount ?? 0 }} events</span>
              <span class="session-card-stat">{{ session.turnCount ?? 0 }} turns</span>
            </div>
            <span>{{ formatRelativeTime(session.updatedAt) }}</span>
          </div>
        </router-link>
      </div>

      <!-- Empty state -->
      <EmptyState
        v-else-if="!store.loading"
        icon="🔍"
        title="No sessions found"
        message="Try adjusting your search or filters."
      />

    </div>
  </div>
</template>

<style scoped>
.session-count-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-left: auto;
  white-space: nowrap;
}
.session-card-stats {
  display: flex;
  gap: 12px;
}
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
}
.loading-state-inner {
  display: flex;
  align-items: center;
  gap: 16px;
}
.loading-text {
  text-align: left;
}
.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-default);
  border-top-color: var(--accent-fg);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
