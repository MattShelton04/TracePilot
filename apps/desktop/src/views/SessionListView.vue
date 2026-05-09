<script setup lang="ts">
import type { IndexingProgressPayload } from "@tracepilot/types";
import {
  Badge,
  EmptyState,
  ErrorAlert,
  FilterSelect,
  formatRelativeTime,
  LoadingSpinner,
  ProgressBar,
  SearchInput,
  SessionCard,
  SkeletonLoader,
  useAutoRefresh,
} from "@tracepilot/ui";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import RefreshToolbar from "@/components/RefreshToolbar.vue";
import { useIndexingEvents } from "@/composables/useIndexingEvents";
import { usePerfMonitor } from "@/composables/usePerfMonitor";
import { useRenderBudget } from "@/composables/useRenderBudget";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { type SortOption, useSessionsStore } from "@/stores/sessions";
import { useSessionTabsStore } from "@/stores/sessionTabs";

const router = useRouter();
const store = useSessionsStore();
usePerfMonitor("SessionListView");
useRenderBudget({ key: "render.sessionListViewMs", budgetMs: 120, label: "SessionListView" });
const detailStore = useSessionDetailStore();
const prefs = usePreferencesStore();
const tabStore = useSessionTabsStore();
const { refreshing, refresh } = useAutoRefresh({
  // Auto-refresh bypasses the ensureIndex throttle so new sessions that land
  // on disk between navigations are picked up without requiring Ctrl+R.
  onRefresh: () => store.ensureIndex({ force: true }),
  enabled: computed(() => prefs.autoRefreshEnabled),
  intervalSeconds: computed(() => prefs.autoRefreshIntervalSeconds),
});

const indexingProgress = ref<IndexingProgressPayload | null>(null);

const { setup: setupIndexingEvents } = useIndexingEvents({
  onStarted: () => {
    indexingProgress.value = null;
  },
  onProgress: (p) => {
    indexingProgress.value = p;
  },
  onFinished: () => {
    indexingProgress.value = null;
  },
});

function prefetchTopSessions() {
  // NOTE: Prefetch populates the Pinia singleton's cache. Per-tab instances
  // (via createSessionDetailInstance) have their own cache and won't benefit
  // from this prefetch. This is acceptable — tabs do their own data loading
  // on open, and this optimization still speeds up route-based navigation.
  // Single-user deployment: prefetch generously to maximise cache hits on
  // navigation. The backend now skips sessions whose events.jsonl is missing,
  // and the typed-event cache is keyed by (size, mtime) so re-prefetch is cheap.
  const PREFETCH_LIMIT = 25;
  const top = store.sessions
    .slice()
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, PREFETCH_LIMIT);
  for (const session of top) {
    detailStore.prefetchSession(session.id);
  }
}

const repoOptions = computed(() => store.repositories as string[]);
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

watch(
  () => store.searchQuery,
  (val) => {
    if (val === "67" && pageRef.value) {
      if (driftTimeout) clearTimeout(driftTimeout);
      // Force reflow to restart animation if already playing
      pageRef.value.classList.remove("drift-active");
      void pageRef.value.offsetWidth;
      pageRef.value.classList.add("drift-active");
      driftTimeout = setTimeout(() => {
        pageRef.value?.classList.remove("drift-active");
        driftTimeout = null;
      }, 1800);
    }
  },
);

/**
 * Open a session via route (default click) or in a tab (Ctrl/Meta+click).
 */
function openSession(event: MouseEvent, sessionId: string, label: string) {
  if (event.ctrlKey || event.metaKey) {
    // Ctrl/Meta+click → open in tab
    tabStore.openTab(sessionId, label);
    return;
  }
  // Default click → route-based navigation (legacy)
  pushRoute(router, ROUTE_NAMES.sessionOverview, { params: { id: sessionId } });
}
</script>

<template>
  <div ref="pageRef" class="page-content">
    <ErrorBoundary>
    <div class="page-content-inner">

      <!-- Toolbar -->
      <div class="enhanced-toolbar" data-testid="session-toolbar">
        <div class="toolbar-search">
          <SearchInput v-model="store.searchQuery" placeholder="Search sessions…" data-testid="session-search" />
        </div>
        <div class="toolbar-filters">
          <FilterSelect v-model="store.filterRepo" :options="repoOptions" placeholder="All Repos" />
          <FilterSelect v-model="store.filterBranch" :options="branchOptions" placeholder="All Branches" />
          <select
            :value="store.sortBy"
            class="filter-select"
            aria-label="Sort sessions"
            @change="store.setSortBy(($event.target as HTMLSelectElement).value as SortOption)"
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
      <div v-else-if="store.filteredSessions.length > 0" class="grid-cards" data-testid="session-grid">
        <SessionCard
          v-for="session in store.filteredSessions"
          :key="session.id"
          data-testid="session-card"
          :session="session"
          @select="openSession($event, session.id, session.summary || 'Untitled Session')"
        />
      </div>

      <!-- Empty state -->
      <EmptyState
        v-else-if="!store.loading"
        icon="🔍"
        title="No sessions found"
        message="Try adjusting your search or filters."
      />

    </div>
    </ErrorBoundary>
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