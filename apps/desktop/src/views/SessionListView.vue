<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { useSessionsStore, type SortOption } from "@/stores/sessions";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import { useAutoRefresh } from "@/composables/useAutoRefresh";
import { useIndexingEvents } from "@/composables/useIndexingEvents";
import RefreshToolbar from "@/components/RefreshToolbar.vue";
import { formatRelativeTime } from "@tracepilot/ui";
import { SearchInput, FilterSelect, Badge, ErrorAlert, SkeletonLoader, EmptyState, ProgressBar, LoadingSpinner } from "@tracepilot/ui";
import type { IndexingProgressPayload } from '@tracepilot/types';

const router = useRouter();
const store = useSessionsStore();
const detailStore = useSessionDetailStore();
const prefs = usePreferencesStore();
const { refreshing, refresh } = useAutoRefresh({
  onRefresh: () => store.ensureIndex(),
  enabled: computed(() => prefs.autoRefreshEnabled),
  intervalSeconds: computed(() => prefs.autoRefreshIntervalSeconds),
});

const indexingProgress = ref<IndexingProgressPayload | null>(null);

const { setup: setupIndexingEvents } = useIndexingEvents({
  onStarted: () => { indexingProgress.value = null; },
  onProgress: (p) => { indexingProgress.value = p; },
  onFinished: () => { indexingProgress.value = null; },
});

function prefetchTopSessions() {
  const PREFETCH_LIMIT = 5;
  const MAX_TURN_COUNT = 500;
  const top = store.sessions
    .slice()
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .filter((s) => !s.turnCount || s.turnCount <= MAX_TURN_COUNT)
    .slice(0, PREFETCH_LIMIT);
  for (const session of top) {
    detailStore.prefetchSession(session.id);
  }
}

const repoOptions= computed(() => store.repositories as string[]);
const branchOptions = computed(() => store.branches as string[]);
const sortOptions = [
  { label: "Newest first", value: "updated" },
  { label: "Oldest first", value: "oldest" },
  { label: "Most events", value: "events" },
  { label: "Most turns", value: "turns" },
];

onMounted(async () => {
  await setupIndexingEvents();

  if (store.sessions.length === 0) {
    await store.fetchSessions();
    // If fetch returned empty (no index yet and no sessions on disk), show indexing UI
    if (store.sessions.length === 0 && !store.error) {
      await store.reindex();
      return;
    }
  }
  // Prefetch top sessions for instant navigation (fire-and-forget)
  if (store.sessions.length > 0) {
    prefetchTopSessions();
  }
  // Ensure index is fresh — may add new sessions in background
  store.ensureIndex().then(() => {
    if (store.sessions.length > 0) {
      prefetchTopSessions();
    }
  });
});

const pageRef = ref<HTMLElement | null>(null);
let driftTimeout: ReturnType<typeof setTimeout> | null = null;

watch(() => store.searchQuery, (val) => {
  if (val === '67' && pageRef.value) {
    if (driftTimeout) clearTimeout(driftTimeout);
    // Force reflow to restart animation if already playing
    pageRef.value.classList.remove('drift-active');
    void pageRef.value.offsetWidth;
    pageRef.value.classList.add('drift-active');
    driftTimeout = setTimeout(() => {
      pageRef.value?.classList.remove('drift-active');
      driftTimeout = null;
    }, 1800);
  }
});
</script>

<template>
  <div ref="pageRef" class="page-content">
    <div class="page-content-inner">

      <!-- Toolbar -->
      <div class="enhanced-toolbar">
        <div class="toolbar-search">
          <SearchInput v-model="store.searchQuery" placeholder="Search sessions…" />
        </div>
        <div class="toolbar-filters">
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
        </div>
        <div class="toolbar-actions">
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
      </div>

      <!-- Error state -->
      <ErrorAlert v-if="store.error" :message="store.error" class="mb-6" />

      <!-- Indexing state -->
      <div v-if="store.indexing" class="loading-state">
        <div class="loading-state-inner">
          <LoadingSpinner size="lg" />
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
          <LoadingSpinner size="lg" />
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
          class="card card-interactive session-card-new"
          :class="{ 'card--active': session.isRunning }"
          style="text-decoration: none; color: inherit;"
        >
          <Transition name="active-pop">
            <span v-if="session.isRunning" class="active-pop-wrapper active-badge-topright">
              <Badge variant="success" class="active-badge">Active</Badge>
            </span>
          </Transition>
          
          <div class="card-header-new">
            <Transition name="active-pop">
              <span v-if="session.isRunning" class="active-pop-wrapper">
                <span class="active-dot" title="Session is currently active" />
              </span>
            </Transition>
            <h3 class="card-title-new">{{ session.summary || 'Untitled Session' }}</h3>
          </div>

          <div class="card-badges-new">
            <Badge v-if="session.repository" variant="accent">{{ session.repository }}</Badge>
            <Badge v-if="session.branch" variant="success">{{ session.branch }}</Badge>
            <Badge v-if="session.currentModel" variant="done">{{ session.currentModel }}</Badge>
            <Badge variant="neutral">{{ session.hostType || 'cli' }}</Badge>
          </div>

          <div class="card-footer-new">
            <div class="card-stats-new">
              <span class="stat-item-inline" title="Total Events">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                {{ session.eventCount ?? 0 }}
              </span>
              <span class="stat-item-inline" title="Conversation Turns">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                {{ session.turnCount ?? 0 }}
              </span>
              <span v-if="session.errorCount" class="stat-item-inline error" :title="`${session.errorCount} error${session.errorCount !== 1 ? 's' : ''} encountered`">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {{ session.errorCount }}
              </span>
              <span v-if="session.compactionCount" class="stat-item-inline warning" :title="`${session.compactionCount} context compaction${session.compactionCount !== 1 ? 's' : ''} performed`">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                {{ session.compactionCount }}
              </span>
            </div>
            <span class="card-time-new" :title="session.updatedAt">{{ formatRelativeTime(session.updatedAt) }}</span>
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
/* --- Enhanced Toolbar --- */
.enhanced-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(24, 24, 27, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  margin-top: 4px;
}

:root[data-theme="light"] .enhanced-toolbar {
  background: rgba(255, 255, 255, 0.75);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.05);
}

.toolbar-search {
  flex: 1;
  max-width: 320px;
}

.toolbar-filters {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.session-count-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
  white-space: nowrap;
}

@media (max-width: 900px) {
  .enhanced-toolbar {
    flex-direction: column;
    align-items: stretch;
    padding: 12px;
    gap: 12px;
  }
  .toolbar-search, .toolbar-filters, .toolbar-actions {
    max-width: none;
    width: 100%;
  }
  .toolbar-filters {
    flex-wrap: wrap;
  }
  .toolbar-actions {
    justify-content: space-between;
  }
}

/* --- New Session Card Design --- */
.session-card-new {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  position: relative;
}

.card-header-new {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
  padding-right: 48px; /* space for active badge */
}

.card-title-new {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.card-badges-new {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 24px;
}

.card-footer-new {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.card-stats-new {
  display: flex;
  align-items: center;
  gap: 14px;
}

.stat-item-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.stat-item-inline svg {
  color: var(--text-tertiary);
}

.stat-item-inline.error {
  color: var(--danger-fg);
}
.stat-item-inline.error svg {
  color: var(--danger-fg);
}

.stat-item-inline.warning {
  color: var(--warning-fg);
}
.stat-item-inline.warning svg {
  color: var(--warning-fg);
}

.card-time-new {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
}

/* --- Active State Animations --- */
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

.active-badge-topright {
  position: absolute;
  top: 16px;
  right: 16px;
}

.active-pop-wrapper {
  display: inline-flex;
  align-items: center;
  margin-top: 4px; /* align dot with first line of title */
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
  overflow: visible;
  position: relative;
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

/* --- Loading States --- */
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

/* Subtle motion effect */
.drift-active {
  transform-origin: center center;
  animation: drift-motion 1.8s cubic-bezier(0.6, 0.43, 0.68, 1.11) 1;
}

@keyframes drift-motion {
  0% { transform: skewY(0deg); }
  10% { transform: skewY(10deg); }
  25% { transform: skewY(-10deg); }
  40% { transform: skewY(10deg); }
  55% { transform: skewY(-10deg); }
  70% { transform: skewY(10deg); }
  85% { transform: skewY(-10deg); }
  100% { transform: skewY(0deg); }
}
</style>