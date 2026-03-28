<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSearchStore } from '@/stores/search';

import { useSearchUrlSync } from '@/composables/useSearchUrlSync';
import { useIndexingEvents } from '@/composables/useIndexingEvents';
import { useSearchPagination } from '@/composables/useSearchPagination';
import { useSearchKeyboardNavigation } from '@/composables/useSearchKeyboardNavigation';
import { useSearchResultState } from '@/composables/useSearchResultState';
import { shouldIgnoreGlobalShortcut } from '@/utils/keyboardShortcuts';
import type { IndexingProgressPayload, SearchContentType, SearchResult } from '@tracepilot/types';
import { CONTENT_TYPE_CONFIG, formatRelativeTime, formatDateMedium, formatBytes, useToast } from '@tracepilot/ui';
import { SearchBrowsePresets, SearchFilterSidebar, SearchResultCard, SearchSyntaxHelpModal } from '@/components/search';

const store = useSearchStore();

// Sync search state ↔ URL query params
useSearchUrlSync();


// ── Main indexing progress (local to this view) ──────────────
const indexingProgress = ref<IndexingProgressPayload | null>(null);
const isIndexing = ref(false);
let healthRefreshInterval: number | undefined;

const { setup: setupIndexingEvents } = useIndexingEvents({
  onStarted: () => { indexingProgress.value = null; isIndexing.value = true; },
  onProgress: (p) => { indexingProgress.value = p; },
  onFinished: () => { indexingProgress.value = null; isIndexing.value = false; },
});

// ── Result expansion/collapse state ──────────────────────────
const {
  expandedResults,
  toggleExpand,
  collapsedGroups,
  toggleGroupCollapse,
  filteredSessionNameOverride,
  sessionDisplayName,
  filterBySession,
} = useSearchResultState({
  sessionId: computed({
    get: () => store.sessionId,
    set: (v) => { store.sessionId = v; },
  }),
  results: computed(() => store.results),
  groupedResults: computed(() => store.groupedResults),
  resultViewMode: computed({
    get: () => store.resultViewMode,
    set: (v) => { store.resultViewMode = v; },
  }),
});

// ── Keyboard navigation ─────────────────────────────────────
const searchInputRef = ref<HTMLInputElement | null>(null);

const { focusedResultIndex } = useSearchKeyboardNavigation({
  searchInputRef,
  results: computed(() => store.results),
  hasQuery: computed(() => store.hasQuery),
  onClearAll: () => store.clearAll(),
  onToggleExpand: toggleExpand,
});

// Map result.id → flat index for keyboard nav in grouped view
const resultIndexMap = computed(() => {
  const m = new Map<number, number>();
  store.results.forEach((r, i) => m.set(r.id, i));
  return m;
});

// ── Pagination display ──────────────────────────────────────
const { pageStart, pageEnd, visiblePages } = useSearchPagination({
  page: computed(() => store.page),
  pageSize: computed(() => store.pageSize),
  totalCount: computed(() => store.totalCount),
  totalPages: computed(() => store.totalPages),
});

// ── Local UI state ───────────────────────────────────────────
const filtersOpen = ref(true);
const activeDatePreset = ref<string>('all');
const { success: toastSuccess, error: toastError, dismiss: toastDismiss } = useToast();
let lastCopyToastId: string | null = null;
const showSyntaxHelp = ref(false);

function showCopyToast(ok: boolean, message: string) {
  if (lastCopyToastId) toastDismiss(lastCopyToastId);
  lastCopyToastId = ok
    ? toastSuccess(message, { duration: 2000 })
    : toastError(message, { duration: 2000 });
}

async function handleCopyResult(result: SearchResult) {
  const ok = await store.copySingleResult(result);
  showCopyToast(ok, ok ? 'Copied to clipboard' : 'Copy failed');
}

async function handleCopyAllResults() {
  const ok = await store.copyResultsToClipboard();
  showCopyToast(ok, ok ? `Copied ${store.results.length} results` : 'Copy failed');
}

// ── Content type config (shared) ─────────────────────────────
const contentTypeConfig = CONTENT_TYPE_CONFIG;

// ── Computed helpers ─────────────────────────────────────────
const activeFilterCount = computed(() => {
  let count = 0;
  if (store.contentTypes.length > 0 || store.excludeContentTypes.length > 0) count++;
  if (store.repository) count++;
  if (store.dateFrom || store.dateTo) count++;
  if (store.sessionId) count++;
  return count;
});

// ── Content type tri-state toggle ─────────────────────────────
// States: 'off' (not filtered) → 'include' → 'exclude' → 'off'
function removeContentTypeFilter(ct: SearchContentType) {
  const incIdx = store.contentTypes.indexOf(ct);
  if (incIdx >= 0) store.contentTypes.splice(incIdx, 1);
  const excIdx = store.excludeContentTypes.indexOf(ct);
  if (excIdx >= 0) store.excludeContentTypes.splice(excIdx, 1);
}

// Active filter chips: collect all active include/exclude filters
const activeContentTypeChips = computed(() => {
  const chips: { type: SearchContentType; mode: 'include' | 'exclude' }[] = [];
  for (const ct of store.contentTypes) {
    chips.push({ type: ct, mode: 'include' });
  }
  for (const ct of store.excludeContentTypes) {
    chips.push({ type: ct, mode: 'exclude' });
  }
  return chips;
});

// ÔöÇÔöÇ Friendly error messages ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
const friendlyError = computed(() => {
  const err = store.error;
  if (!err) return null;
  if (err.includes('fts5: syntax error') || err.includes('parse error')) {
    return 'Invalid search syntax. Try simpler terms, or use quotes for exact phrases. Operators like AND, OR, NOT must be between search terms.';
  }
  if (err.includes('ALREADY_INDEXING') || err.includes('already indexing')) {
    return 'Indexing is already in progress. Please wait for the current index to complete.';
  }
  return err;
});

// ÔöÇÔöÇ Stats facets (always visible, from search stats) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
const statsContentTypeFacets = computed(() => {
  const counts = store.stats?.contentTypeCounts ?? [];
  if (counts.length === 0) return [];
  const max = Math.max(1, ...counts.map(([, c]) => c));
  return counts.map(([type, count]) => ({
    type: type as SearchContentType,
    count,
    pct: (count / max) * 100,
  }));
});

// ÔöÇÔöÇ Date presets ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// ÔöÇÔöÇ Clear all filters ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
function handleClearFilters() {
  store.clearFilters();
  activeDatePreset.value = 'all';
  filteredSessionNameOverride.value = null;
}

// ── Session link path ──────────────────────────────────────────────────────────
function sessionLink(sessionId: string, turnNumber: number | null, eventIndex: number | null = null): string {
  const base = `/session/${sessionId}/conversation`;
  const params = new URLSearchParams();
  if (turnNumber != null) params.set('turn', String(turnNumber));
  if (eventIndex != null) params.set('event', String(eventIndex));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// ── Lifecycle ────────────────────────────────────────────────
// Note: keyboard listener is managed by useSearchKeyboardNavigation
onMounted(async () => {
  store.fetchStats();
  store.fetchFilterOptions();
  // Fetch initial facets (browse mode gets filter-scoped counts)
  store.fetchFacets();
  store.fetchHealth();
  // Refresh health every 5s for live progress during indexing
  healthRefreshInterval = window.setInterval(() => store.fetchHealth(), 5_000);

  // Main indexing events (local — only for showing main index progress)
  await setupIndexingEvents();
  // Search indexing events are handled globally in the search store
});

onUnmounted(() => {
  if (healthRefreshInterval) clearInterval(healthRefreshInterval);
});
</script>

<template>
  <div class="search-view">

      <!-- ÔòÉÔòÉÔòÉ Search Hero ÔòÉÔòÉÔòÉ -->
      <div class="search-hero">
        <div class="search-hero-container">
          <svg class="search-hero-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="7" cy="7" r="4.5" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" />
          </svg>
          <input
            ref="searchInputRef"
            v-model="store.query"
            type="text"
            class="search-hero-input"
            placeholder="Search across all sessions…"
            aria-label="Search sessions"
          />
          <kbd class="search-hero-kbd">Ctrl+K</kbd>
        </div>
        <div class="search-hints">
          <span class="search-hint"><code>"phrase"</code> exact match</span>
          <span class="search-hint"><code>prefix*</code> prefix search</span>
          <span class="search-hint"><code>type:error</code> filter by type</span>
          <span class="search-hint"><code>repo:name</code> filter by repo</span>
          <span class="search-hint"><code>tool:grep</code> filter by tool</span>
          <button class="search-hint syntax-help-btn" @click="showSyntaxHelp = true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
              <circle cx="8" cy="8" r="6" /><path d="M6 6a2 2 0 1 1 2 2v1" /><circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
            </svg>
            More syntax
          </button>
        </div>

        <!-- Controls Row -->
        <div class="search-controls">
          <button
            class="filter-toggle-btn"
            :class="{ active: filtersOpen }"
            aria-label="Toggle filters"
            @click="filtersOpen = !filtersOpen"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 4h12M4 8h8M6 12h4" />
            </svg>
            Filters
            <span v-if="activeFilterCount > 0" class="filter-count-badge">{{ activeFilterCount }}</span>
          </button>
          <div style="flex: 1" />
          <select v-model="store.sortBy" class="sort-select" aria-label="Sort results">
            <option value="relevance" :disabled="store.isBrowseMode">Sort: Relevance</option>
            <option value="newest">Sort: Newest</option>
            <option value="oldest">Sort: Oldest</option>
          </select>
        </div>
      </div>

      <!-- ═══ Active Filter Chips ═══ -->
      <div v-if="activeContentTypeChips.length > 0 || store.repository || store.toolName || store.sessionId" class="active-filters-bar">
        <span class="active-filters-label">Active filters:</span>
        <div class="active-filter-chips">
          <span
            v-for="chip in activeContentTypeChips"
            :key="`ct-${chip.mode}-${chip.type}`"
            class="filter-chip"
            :class="chip.mode === 'exclude' ? 'filter-chip-exclude' : 'filter-chip-include'"
          >
            <span
              class="filter-chip-dot"
              :style="{ background: contentTypeConfig[chip.type]?.color }"
            />
            <span v-if="chip.mode === 'exclude'" class="filter-chip-prefix">NOT</span>
            {{ contentTypeConfig[chip.type]?.label ?? chip.type }}
            <button class="filter-chip-remove" @click="removeContentTypeFilter(chip.type)" aria-label="Remove filter">×</button>
          </span>
          <span v-if="store.repository" class="filter-chip filter-chip-neutral">
            Repo: {{ store.repository }}
            <button class="filter-chip-remove" @click="store.repository = null" aria-label="Remove filter">×</button>
          </span>
          <span v-if="store.toolName" class="filter-chip filter-chip-neutral">
            Tool: {{ store.toolName }}
            <button class="filter-chip-remove" @click="store.toolName = null" aria-label="Remove filter">×</button>
          </span>
          <span v-if="store.sessionId" class="filter-chip filter-chip-include">
            Session: {{ sessionDisplayName }}
            <button class="filter-chip-remove" @click="store.sessionId = null; filteredSessionNameOverride = null" aria-label="Remove filter">×</button>
          </span>
          <button v-if="activeFilterCount > 1" class="filter-chip-clear-all" @click="handleClearFilters">
            Clear all
          </button>
        </div>
      </div>

      <!-- ═══ Indexing Progress Banner ═══ -->
      <div v-if="isIndexing || store.searchIndexing || store.rebuilding" class="indexing-banner">
        <div class="indexing-banner-content">
          <svg class="indexing-banner-icon spin-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 8a6 6 0 0 1 10.2-4.3M14 8a6 6 0 0 1-10.2 4.3" />
            <path d="M12.2 1v3h-3M3.8 15v-3h3" />
          </svg>
          <span class="indexing-banner-text">
            <template v-if="store.rebuilding">Rebuilding search index…</template>
            <template v-else-if="store.searchIndexing && store.searchIndexingProgress">
              Building search index… {{ store.searchIndexingProgress.current }} / {{ store.searchIndexingProgress.total }}
            </template>
            <template v-else-if="store.searchIndexing">Building search index…</template>
            <template v-else-if="indexingProgress">
              Indexing sessions… {{ indexingProgress.current }} / {{ indexingProgress.total }}
            </template>
            <template v-else>Indexing sessions…</template>
          </span>
          <div v-if="store.searchIndexingProgress && store.searchIndexingProgress.total > 0" class="indexing-banner-bar-container">
            <div
              class="indexing-banner-bar"
              :style="{ width: (store.searchIndexingProgress.current / store.searchIndexingProgress.total * 100) + '%' }"
            />
          </div>
          <div v-else-if="indexingProgress && indexingProgress.total > 0" class="indexing-banner-bar-container">
            <div
              class="indexing-banner-bar"
              :style="{ width: (indexingProgress.current / indexingProgress.total * 100) + '%' }"
            />
          </div>
        </div>
      </div>

      <!-- ÔòÉÔòÉÔòÉ Main Layout: Filter Sidebar + Results ÔòÉÔòÉÔòÉ -->
      <div class="search-page-layout">

        <!-- Filter Sidebar -->
        <SearchFilterSidebar
          :collapsed="!filtersOpen"
          v-model:active-date-preset="activeDatePreset"
          @clear-filters="handleClearFilters"
        />

        <!-- Results Area -->
        <div class="search-main">

          <!-- ÔòÉÔòÉÔòÉ Error State ÔòÉÔòÉÔòÉ -->
          <div v-if="store.error" class="search-error">
            <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5zM8 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
            </svg>
            <span>{{ friendlyError }}</span>
            <button class="filter-clear-btn" @click="store.error = null">Dismiss</button>
          </div>

          <!-- ÔòÉÔòÉÔòÉ Loading State ÔòÉÔòÉÔòÉ -->
          <div v-if="store.loading" class="search-main-scroll">
            <div class="results-summary">
              <span class="results-summary-text">Searching…</span>
            </div>
            <div class="results-list">
              <div v-for="n in 5" :key="n" class="result-card skeleton-card">
                <div class="skeleton-header">
                  <div class="skeleton skeleton-badge" />
                  <div class="skeleton skeleton-badge-sm" />
                  <div class="skeleton skeleton-badge-sm" style="margin-left: auto" />
                </div>
                <div class="skeleton skeleton-text" />
                <div class="skeleton skeleton-text short" />
                <div class="skeleton-meta">
                  <div class="skeleton skeleton-badge-sm" />
                  <div class="skeleton skeleton-badge-sm" />
                </div>
              </div>
            </div>
          </div>

          <!-- ÔòÉÔòÉÔòÉ Empty State: No Query ÔòÉÔòÉÔòÉ -->
          <div v-else-if="!store.hasQuery && !store.hasResults && !store.hasActiveFilters" class="search-main-scroll">

            <!-- Search index health status -->
            <div v-if="store.healthInfo" class="search-health-bar">
              <span class="health-stat">
                <span class="health-dot" :class="store.healthInfo.inSync ? 'synced' : 'pending'" />
                {{ store.healthInfo.indexedSessions }}/{{ store.healthInfo.totalSessions }} sessions indexed
              </span>
              <span class="health-separator">·</span>
              <span class="health-stat">{{ store.healthInfo.totalContentRows.toLocaleString() }} rows</span>
              <span class="health-separator">·</span>
              <span class="health-stat">{{ formatBytes(store.healthInfo.dbSizeBytes) }}</span>
              <span v-if="store.healthInfo.pendingSessions > 0" class="health-stat health-pending">
                · {{ store.healthInfo.pendingSessions }} pending
              </span>
            </div>

            <!-- First-run: No sessions indexed yet -->
            <div v-if="store.stats && store.stats.totalSessions === 0" class="first-run-state">
              <svg class="first-run-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="20" cy="20" r="14" /><line x1="30" y1="30" x2="44" y2="44" />
                <circle cx="20" cy="20" r="4" stroke-dasharray="3 2" />
              </svg>
              <div class="first-run-title">No sessions indexed yet</div>
              <div class="first-run-subtitle">
                Open a coding session and TracePilot will automatically index it for search.
                You can also rebuild the index manually to pick up existing sessions.
              </div>
              <button class="first-run-rebuild-btn" @click="store.rebuild()">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
                  <path d="M2 8a6 6 0 0 1 10.47-4M14 8a6 6 0 0 1-10.47 4" />
                  <polyline points="12.5 1 12.5 4 9.5 4" /><polyline points="3.5 15 3.5 12 6.5 12" />
                </svg>
                Build Search Index
              </button>
            </div>

            <!-- Browse Mode: Quick Presets -->
            <SearchBrowsePresets v-else />
          </div>

          <!-- ÔòÉÔòÉÔòÉ Results ÔòÉÔòÉÔòÉ -->
          <div v-else class="search-main-scroll">

            <!-- Stats Bar -->
            <div class="results-summary">
              <span v-if="store.hasResults" class="results-summary-text">
                {{ store.isBrowseMode ? 'Browsing' : 'Found' }} <strong>{{ store.totalCount.toLocaleString() }}</strong>
                result{{ store.totalCount !== 1 ? 's' : '' }}
                <span v-if="store.resultViewMode === 'grouped'"> across <strong>{{ store.groupedResults.length }}</strong> session{{ store.groupedResults.length !== 1 ? 's' : '' }}</span>
                <span class="summary-speed">({{ store.latencyMs.toFixed(2) }}ms)</span>
                <template v-if="store.resultViewMode === 'flat' && store.totalPages > 1">
                  — page {{ store.page }} of {{ store.totalPages }}
                </template>
              </span>
              <span v-else class="results-summary-text">
                No results found
              </span>
              <div class="view-mode-toggle">
                <button
                  class="view-mode-btn"
                  title="Clear search"
                  @click="store.clearAll()"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
                    <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                </button>
                <button
                  v-if="store.hasResults"
                  class="view-mode-btn"
                  title="Copy all results"
                  @click="handleCopyAllResults()"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
                    <rect x="5" y="5" width="9" height="9" rx="1" /><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
                  </svg>
                </button>
                <button
                  class="view-mode-btn"
                  :class="{ active: store.resultViewMode === 'flat' }"
                  @click="store.resultViewMode = 'flat'"
                  title="Flat list"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
                    <line x1="2" y1="4" x2="14" y2="4" /><line x1="2" y1="8" x2="14" y2="8" /><line x1="2" y1="12" x2="14" y2="12" />
                  </svg>
                </button>
                <button
                  class="view-mode-btn"
                  :class="{ active: store.resultViewMode === 'grouped' }"
                  @click="store.resultViewMode = 'grouped'"
                  title="Grouped by session"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
                    <rect x="2" y="2" width="12" height="4" rx="1" /><rect x="2" y="10" width="12" height="4" rx="1" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- No Results State -->
            <div v-if="!store.hasResults" class="search-empty-state">
              <svg class="search-empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="20" cy="20" r="14" />
                <line x1="30" y1="30" x2="44" y2="44" />
                <line x1="15" y1="15" x2="25" y2="25" stroke-width="2" />
                <line x1="25" y1="15" x2="15" y2="25" stroke-width="2" />
              </svg>
              <div class="empty-title">No results found</div>
              <div class="empty-subtitle">
                Try adjusting your search query or filters. Use quotes for exact phrases or * for prefix matching.
              </div>
              <button class="clear-search-btn" @click="store.clearAll()">Clear search</button>
            </div>

            <!-- Results: Flat view -->
            <div v-else-if="store.resultViewMode === 'flat'" class="results-list">
              <SearchResultCard
                v-for="(result, idx) in store.results"
                :key="result.id"
                :result="result"
                :index="idx"
                :expanded="expandedResults.has(result.id)"
                :focused="focusedResultIndex === idx"
                :session-link="sessionLink(result.sessionId, result.turnNumber, result.eventIndex)"
                @toggle="toggleExpand(result.id)"
                @copy="handleCopyResult(result)"
              />
            </div>

            <!-- Results: Grouped by session -->
            <div v-else class="results-grouped">
              <div
                v-for="(group, gIdx) in store.groupedResults"
                :key="group.sessionId"
                class="session-group"
                :style="{ animationDelay: `${Math.min(gIdx, 6) * 40}ms` }"
              >
                <div class="session-group-header" @click="toggleGroupCollapse(group.sessionId)">
                  <span class="session-group-chevron" :class="{ collapsed: collapsedGroups.has(group.sessionId) }">▾</span>
                  <div class="session-group-title">
                    {{ group.sessionSummary || group.sessionId.slice(0, 12) + '…' }}
                  </div>
                  <div v-if="group.sessionRepository || group.sessionBranch" class="session-group-badges">
                    <span v-if="group.sessionRepository" class="badge badge-accent" style="font-size: 0.5625rem">{{ group.sessionRepository }}</span>
                    <span v-if="group.sessionBranch" class="badge badge-success" style="font-size: 0.5625rem">{{ group.sessionBranch }}</span>
                  </div>
                  <div class="session-group-actions">
                    <span class="session-group-count">{{ group.results.length }}{{ store.hasMore ? '+' : '' }} match{{ group.results.length !== 1 ? 'es' : '' }}</span>
                    <button
                      class="session-group-filter-btn"
                      title="Filter search to this session"
                      @click.stop="filterBySession(group.sessionId, group.sessionSummary)"
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
                        <path d="M2 4h12M4 8h8M6 12h4" />
                      </svg>
                    </button>
                    <router-link
                      :to="`/session/${group.sessionId}/conversation`"
                      class="session-group-goto-btn"
                      title="Go to session"
                      @click.stop
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
                        <path d="M6 3l5 5-5 5" />
                      </svg>
                    </router-link>
                  </div>
                </div>
                <div v-if="!collapsedGroups.has(group.sessionId)" class="session-group-results">
                  <div
                    v-for="result in group.results"
                    :key="result.id"
                    class="session-group-result"
                    :class="{ expanded: expandedResults.has(result.id), 'result-focused': resultIndexMap.get(result.id) === focusedResultIndex }"
                    :data-result-index="resultIndexMap.get(result.id)"
                    @click="toggleExpand(result.id)"
                  >
                    <div class="session-group-result-row">
                      <span
                        class="ct-badge"
                        :style="{
                          background: contentTypeConfig[result.contentType]?.color + '20',
                          color: contentTypeConfig[result.contentType]?.color,
                        }"
                      >
                        {{ contentTypeConfig[result.contentType]?.label ?? result.contentType }}
                      </span>
                      <!-- eslint-disable-next-line vue/no-v-html -- server-controlled highlighted snippet -->
                      <span class="session-group-snippet" v-html="result.snippet" />
                      <span class="session-group-result-meta">
                        <span v-if="result.timestampUnix != null" class="session-group-timestamp" :title="formatDateMedium(result.timestampUnix)">
                          {{ formatRelativeTime(result.timestampUnix) }}
                        </span>
                        <span v-if="result.turnNumber != null">T{{ result.turnNumber }}</span>
                        <span v-if="result.toolName" class="tool-name-badge">{{ result.toolName }}</span>
                      </span>
                      <router-link
                        :to="sessionLink(result.sessionId, result.turnNumber, result.eventIndex)"
                        class="session-group-view-btn"
                        @click.stop
                      >→</router-link>
                    </div>
                    <!-- Expanded details -->
                    <div v-if="expandedResults.has(result.id)" class="session-group-expanded">
                      <!-- Full snippet (un-truncated) -->
                      <!-- eslint-disable-next-line vue/no-v-html -- server-controlled highlighted snippet -->
                      <div class="result-snippet" v-html="result.snippet" />
                      <div class="expanded-grid">
                        <div v-if="result.sessionSummary" class="expanded-item">
                          <span class="expanded-label">Session</span>
                          <span class="expanded-value">{{ result.sessionSummary }}</span>
                        </div>
                        <div class="expanded-item">
                          <span class="expanded-label">Session ID</span>
                          <span class="expanded-value expanded-mono">{{ result.sessionId }}</span>
                        </div>
                        <div v-if="result.turnNumber != null" class="expanded-item">
                          <span class="expanded-label">Turn</span>
                          <span class="expanded-value">{{ result.turnNumber }}</span>
                        </div>
                        <div v-if="result.toolName" class="expanded-item">
                          <span class="expanded-label">Tool</span>
                          <span class="expanded-value expanded-mono">{{ result.toolName }}</span>
                        </div>
                        <div v-if="result.eventIndex != null" class="expanded-item">
                          <span class="expanded-label">Event Index</span>
                          <span class="expanded-value">{{ result.eventIndex }}</span>
                        </div>
                        <div v-if="result.timestampUnix != null" class="expanded-item">
                          <span class="expanded-label">Timestamp</span>
                          <span class="expanded-value">{{ formatDateMedium(result.timestampUnix) }}</span>
                        </div>
                      </div>
                      <router-link
                        :to="sessionLink(result.sessionId, result.turnNumber, result.eventIndex)"
                        class="expanded-view-btn"
                        @click.stop
                      >
                        Open in Session Viewer →
                      </router-link>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- ═══ Pagination (both views) ═══ -->
            <div v-if="store.totalPages > 1" class="pagination">
              <button
                class="pagination-btn"
                :disabled="store.page <= 1"
                @click="store.prevPage()"
              >
                ‹ Prev
              </button>
              <template v-for="(p, idx) in visiblePages" :key="idx">
                <span v-if="p === null" class="pagination-ellipsis">…</span>
                <button
                  v-else
                  class="pagination-btn"
                  :class="{ active: p === store.page }"
                  @click="store.setPage(p)"
                >
                  {{ p }}
                </button>
              </template>
              <button
                class="pagination-btn"
                :disabled="!store.hasMore"
                @click="store.nextPage()"
              >
                Next ›
              </button>
              <span class="pagination-info">
                {{ pageStart }}–{{ pageEnd }} of {{ store.totalCount.toLocaleString() }}
              </span>
            </div>

          </div>
        </div>

      </div>

      <!-- Keyboard hints (shown when results are visible) -->
      <div v-if="store.hasResults && !store.loading" class="keyboard-hints">
        <kbd>↑↓</kbd> navigate
        <kbd>Enter</kbd> expand
        <kbd>Esc</kbd> back to search
      </div>

      <!-- Syntax Help Modal -->
      <SearchSyntaxHelpModal :visible="showSyntaxHelp" @close="showSyntaxHelp = false" />
    </div>
</template>

<style scoped src="./SessionSearchView.css"></style>
