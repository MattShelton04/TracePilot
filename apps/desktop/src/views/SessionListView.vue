<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useRouter } from "vue-router";
import { useSessionsStore, type SortOption } from "@/stores/sessions";
import { usePreferencesStore } from "@/stores/preferences";
import { useAutoRefresh } from "@/composables/useAutoRefresh";
import RefreshToolbar from "@/components/RefreshToolbar.vue";
import { formatRelativeTime } from "@tracepilot/ui";
import { SearchInput, FilterSelect, Badge, ErrorAlert, SkeletonLoader, EmptyState, ProgressBar } from "@tracepilot/ui";
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { IndexingProgressPayload } from '@tracepilot/types';
import { safeListen } from '@/utils/tauriEvents';

const router = useRouter();
const store = useSessionsStore();
const prefs = usePreferencesStore();

const { refreshing, refresh } = useAutoRefresh({
  onRefresh: () => store.refreshSessions(),
  enabled: computed(() => prefs.autoRefreshEnabled),
  intervalSeconds: computed(() => prefs.autoRefreshIntervalSeconds),
});

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
    await safeListen<IndexingProgressPayload>('indexing-progress', (event) => {
      indexingProgress.value = event.payload;
    }),
    await safeListen('indexing-started', () => {
      indexingProgress.value = null;
    }),
    await safeListen('indexing-finished', () => {
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
      <div class="toolbar session-toolbar">
        <SearchInput v-model="store.searchQuery" placeholder="Search sessions…" />
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
        <RefreshToolbar
          :refreshing="refreshing"
          :auto-refresh-enabled="prefs.autoRefreshEnabled"
          :interval-seconds="prefs.autoRefreshIntervalSeconds"
          @refresh="refresh"
          @update:auto-refresh-enabled="prefs.autoRefreshEnabled = $event"
          @update:interval-seconds="prefs.autoRefreshIntervalSeconds = $event"
        />
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
          class="card card-interactive session-card"
          :class="{ 'card--active': session.isRunning }"
          style="text-decoration: none; color: inherit;"
        >
          <Transition name="active-pop">
            <span v-if="session.isRunning" class="active-pop-wrapper active-badge-topright">
              <Badge variant="success" class="active-badge">Active</Badge>
            </span>
          </Transition>
          <div class="session-card-title">
            <Transition name="active-pop">
              <span v-if="session.isRunning" class="active-pop-wrapper">
                <span class="active-dot" title="Session is currently active" />
              </span>
            </Transition>
            {{ session.summary || 'Untitled Session' }}
          </div>
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
.session-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 20px;
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--canvas-default);
  padding: 8px 12px;
  border-radius: var(--radius-md, 8px);
}

.session-count-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-left: auto;
  white-space: nowrap;
}
.session-card {
  position: relative;
}
.active-badge-topright {
  position: absolute;
  top: 8px;
  right: 8px;
}
.session-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.card--active {
  border-color: var(--success-muted, rgba(52, 211, 153, 0.3));
  box-shadow: 0 0 0 1px var(--success-muted, rgba(52, 211, 153, 0.15));
  animation: card-active-pulse 2s ease-in-out infinite;
}
@keyframes card-active-pulse {
  0%, 100% {
    border-color: var(--success-muted, rgba(52, 211, 153, 0.3));
    box-shadow: 0 0 0 1px var(--success-muted, rgba(52, 211, 153, 0.15));
  }
  50% {
    border-color: var(--success-fg, rgba(52, 211, 153, 0.6));
    box-shadow: 0 0 0 2px var(--success-muted, rgba(52, 211, 153, 0.25));
  }
}
/* Animate active indicator in/out */
.active-pop-wrapper {
  display: inline-flex;
  align-items: center;
}
.active-pop-enter-active,
.active-pop-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.active-pop-enter-from { opacity: 0; transform: scale(0); }
.active-pop-leave-to { opacity: 0; transform: scale(0); }
.active-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-fg);
  flex-shrink: 0;
  margin-left: 2px;
  overflow: visible;
  position: relative;
  /* Sync with card border: same duration, timing, and phase */
  animation: dot-sync-pulse 2s ease-in-out infinite;
}
@keyframes dot-sync-pulse {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.15); opacity: 1; }
}
.active-badge {
  flex-shrink: 0;
  font-size: 0.625rem;
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
