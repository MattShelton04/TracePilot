<script setup lang="ts">
import type { IndexingProgressPayload, SearchContentType, SearchResult } from "@tracepilot/types";
import {
  CONTENT_TYPE_CONFIG,
  formatBytes,
  formatDateMedium,
  formatRelativeTime,
  useToast,
} from "@tracepilot/ui";
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  SearchActiveFilters,
  SearchBrowsePresets,
  SearchFilterSidebar,
  SearchGroupedResults,
  SearchResultCard,
  SearchSyntaxHelpModal,
} from "@/components/search";
import { useIndexingEvents } from "@/composables/useIndexingEvents";
import { useSearchKeyboardNavigation } from "@/composables/useSearchKeyboardNavigation";
import { useSearchPagination } from "@/composables/useSearchPagination";
import { useSearchResultState } from "@/composables/useSearchResultState";
import { useSearchUrlSync } from "@/composables/useSearchUrlSync";
import { useSearchStore } from "@/stores/search";
import { toFriendlyErrorMessage } from "@/utils/backendErrors";
import { hasMeaningfulDateValue } from "@/utils/dateValidation";
import { shouldIgnoreGlobalShortcut } from "@/utils/keyboardShortcuts";

const store = useSearchStore();

// Sync search state ↔ URL query params
useSearchUrlSync();

// ── Main indexing progress (local to this view) ──────────────
const indexingProgress = ref<IndexingProgressPayload | null>(null);
const isIndexing = ref(false);
let healthRefreshInterval: number | undefined;

const { setup: setupIndexingEvents } = useIndexingEvents({
  onStarted: () => {
    indexingProgress.value = null;
    isIndexing.value = true;
  },
  onProgress: (p) => {
    indexingProgress.value = p;
  },
  onFinished: () => {
    indexingProgress.value = null;
    isIndexing.value = false;
  },
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
    set: (v) => {
      store.sessionId = v;
    },
  }),
  results: computed(() => store.results),
  groupedResults: computed(() => store.groupedResults),
  resultViewMode: computed({
    get: () => store.resultViewMode,
    set: (v) => {
      store.resultViewMode = v;
    },
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
  store.results.forEach((r, i) => {
    m.set(r.id, i);
  });
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
const activeDatePreset = ref<string>("all");
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
  showCopyToast(ok, ok ? "Copied to clipboard" : "Copy failed");
}

async function handleCopyAllResults() {
  const ok = await store.copyResultsToClipboard();
  showCopyToast(ok, ok ? `Copied ${store.results.length} results` : "Copy failed");
}

// ── Content type config (shared) ─────────────────────────────
const contentTypeConfig = CONTENT_TYPE_CONFIG;

// ── Computed helpers ─────────────────────────────────────────
const activeFilterCount = computed(() => {
  let count = 0;
  if (store.contentTypes.length > 0 || store.excludeContentTypes.length > 0) count++;
  if (store.repository) count++;
  if (hasMeaningfulDateValue(store.dateFrom) || hasMeaningfulDateValue(store.dateTo)) count++;
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
  const chips: { type: SearchContentType; mode: "include" | "exclude" }[] = [];
  for (const ct of store.contentTypes) {
    chips.push({ type: ct, mode: "include" });
  }
  for (const ct of store.excludeContentTypes) {
    chips.push({ type: ct, mode: "exclude" });
  }
  return chips;
});

// ÔöÇÔöÇ Friendly error messages ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
const friendlyError = computed(() => toFriendlyErrorMessage(store.error));

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
  activeDatePreset.value = "all";
  filteredSessionNameOverride.value = null;
}

// ── Session link path ──────────────────────────────────────────────────────────
function sessionLink(
  sessionId: string,
  turnNumber: number | null,
  eventIndex: number | null = null,
): string {
  const base = `/session/${sessionId}/conversation`;
  const params = new URLSearchParams();
  if (turnNumber != null) params.set("turn", String(turnNumber));
  if (eventIndex != null) params.set("event", String(eventIndex));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// ── Lifecycle ────────────────────────────────────────────────
// Note: keyboard listener is managed by useSearchKeyboardNavigation
onMounted(async () => {
  // Notify store that search view is mounted (enables background operations)
  store.setViewMounted(true);

  store.fetchStats();
  store.fetchFilterOptions();
  // Fetch initial facets (browse mode gets filter-scoped counts)
  store.fetchFacets();
  // Defer initial health check — it drives a non-blocking indicator,
  // so it shouldn't delay search readiness.
  setTimeout(() => store.fetchHealth(), 0);
  // Refresh health every 5s for live progress during indexing
  healthRefreshInterval = window.setInterval(() => store.fetchHealth(), 5_000);

  // Main indexing events (local — only for showing main index progress)
  await setupIndexingEvents();
  // Search indexing events are handled globally in the search store
});

onUnmounted(() => {
  // Notify store that search view is unmounted (disables background operations)
  store.setViewMounted(false);
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
            data-testid="search-input"
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
      <SearchActiveFilters
        :active-content-type-chips="activeContentTypeChips"
        :repository="store.repository"
        :tool-name="store.toolName"
        :session-id="store.sessionId"
        :session-display-name="sessionDisplayName"
        :active-filter-count="activeFilterCount"
        :content-type-config="contentTypeConfig"
        @remove-content-type="removeContentTypeFilter"
        @clear-repository="store.repository = null"
        @clear-tool-name="store.toolName = null"
        @clear-session-id="store.sessionId = null; filteredSessionNameOverride = null"
        @clear-all="handleClearFilters"
      />

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
            <SearchGroupedResults
              v-else
              :grouped-results="store.groupedResults"
              :collapsed-groups="collapsedGroups"
              :expanded-results="expandedResults"
              :result-index-map="resultIndexMap"
              :focused-result-index="focusedResultIndex"
              :has-more="store.hasMore"
              :content-type-config="contentTypeConfig"
              @toggle-group-collapse="toggleGroupCollapse"
              @filter-by-session="filterBySession"
              @toggle-expand="toggleExpand"
              :session-link="sessionLink"
            />

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

<style scoped>
/* ÔöÇÔöÇ Full-width view shell ÔöÇÔöÇ */
.search-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 28px;
  overflow-y: auto;
}

/* ÔöÇÔöÇ Search Hero ÔöÇÔöÇ */
.search-hero {
  padding: 24px 0 0;
  flex-shrink: 0;
}

.search-hero-container {
  position: relative;
}

.search-hero-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-placeholder);
  width: 20px;
  height: 20px;
  pointer-events: none;
}

.search-hero-input {
  width: 100%;
  padding: 14px 100px 14px 48px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  color: var(--text-primary);
  font-size: 1rem;
  font-family: inherit;
  outline: none;
  transition: all var(--transition-normal);
}

.search-hero-input::placeholder {
  color: var(--text-placeholder);
}

.search-hero-input:focus {
  border-color: var(--accent-emphasis);
  box-shadow: var(--shadow-glow-accent);
  background: var(--canvas-overlay);
}

.search-hero-kbd {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: var(--canvas-default);
  font-size: 0.6875rem;
  color: var(--text-placeholder);
  font-family: inherit;
  pointer-events: none;
}

/* ÔöÇÔöÇ Search Hints ÔöÇÔöÇ */
.search-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.search-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--neutral-subtle);
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  cursor: default;
  user-select: none;
  transition: background var(--transition-fast);
}

.search-hint:hover {
  background: var(--neutral-muted);
  color: var(--text-secondary);
}

.search-hint code {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.625rem;
  color: var(--accent-fg);
  background: var(--accent-subtle);
  padding: 0 4px;
  border-radius: 3px;
}

.syntax-help-btn {
  cursor: pointer;
  border: none;
  font-family: inherit;
  color: var(--accent-fg);
}

.syntax-help-btn:hover {
  color: var(--accent-emphasis);
  background: var(--accent-subtle);
}

/* ÔöÇÔöÇ Controls Row ÔöÇÔöÇ */
.search-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0 0;
  flex-shrink: 0;
}

.filter-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.filter-toggle-btn:hover {
  border-color: var(--border-accent);
  color: var(--text-primary);
}

.filter-toggle-btn.active {
  background: var(--accent-subtle);
  border-color: var(--border-accent);
  color: var(--accent-fg);
}

.filter-toggle-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.filter-toggle-btn svg {
  width: 14px;
  height: 14px;
}

.filter-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--radius-full);
  background: var(--accent-emphasis);
  color: white;
  font-size: 0.625rem;
  font-weight: 600;
}

.sort-select {
  appearance: none;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  padding: 6px 24px 6px 10px;
  cursor: pointer;
  outline: none;
  transition: border-color var(--transition-fast);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2371717a'%3E%3Cpath d='M5 7L0.5 2.5h9z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
}

.sort-select:hover {
  border-color: var(--accent-emphasis);
}

.sort-select:focus {
  border-color: var(--accent-emphasis);
  box-shadow: var(--shadow-glow-accent);
}

/* ÔöÇÔöÇ Page Layout ÔöÇÔöÇ */
.search-page-layout {
  display: flex;
  gap: 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  margin-top: 16px;
}

.search-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.search-main-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 28px;
}

/* ÔöÇÔöÇ Error ÔöÇÔöÇ */
.search-error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--danger-subtle);
  border: 1px solid var(--danger-muted);
  border-radius: var(--radius-md);
  color: var(--danger-fg);
  font-size: 0.8125rem;
  margin-bottom: 12px;
}

.search-error svg {
  flex-shrink: 0;
}

/* ÔöÇÔöÇ Results Summary ÔöÇÔöÇ */
.results-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 16px;
  border: 1px solid var(--border-default);
  margin: 0 0 16px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  background: var(--canvas-default);
  z-index: 10;
  border-radius: var(--radius-md);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.results-summary-text {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.results-summary-text strong {
  color: var(--text-primary);
  font-weight: 600;
}

.summary-speed {
  color: var(--success-fg);
}

/* ── First-run state (no sessions indexed) ── */
.first-run-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  color: var(--text-tertiary);
  text-align: center;
}

.first-run-icon {
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  opacity: 0.35;
}

.first-run-title {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.first-run-subtitle {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  max-width: 380px;
  margin-bottom: 20px;
  line-height: 1.5;
}

.first-run-rebuild-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--accent-emphasis);
  color: var(--text-on-emphasis);
  border: none;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}

.first-run-rebuild-btn:hover {
  background: var(--accent-fg);
}

.first-run-rebuild-btn svg {
  opacity: 0.8;
}

/* ÔöÇÔöÇ Empty State ÔöÇÔöÇ */
.search-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  color: var(--text-tertiary);
  text-align: center;
}

.search-empty-icon {
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  opacity: 0.35;
}

.empty-title {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.empty-subtitle {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  max-width: 380px;
}

.empty-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.empty-stat strong {
  color: var(--accent-fg);
}

.empty-stat-sep {
  opacity: 0.3;
}

.clear-search-btn {
  margin-top: 16px;
  padding: 8px 16px;
  border-radius: var(--radius-md);
  background: var(--accent-subtle);
  border: 1px solid var(--border-accent);
  color: var(--accent-fg);
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.clear-search-btn:hover {
  background: var(--accent-muted);
}

/* ÔöÇÔöÇ Result Cards ÔöÇÔöÇ */
.results-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.result-card {
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
  cursor: pointer;
  transition: all var(--transition-normal);
  animation: fadeSlideIn 0.25s ease both;
}

.result-card:hover {
  border-color: var(--border-accent);
  box-shadow: var(--shadow-md), 0 0 0 1px var(--border-glow);
}

.result-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.result-date {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.ct-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  font-weight: 500;
  white-space: nowrap;
}

.result-snippet {
  font-size: 0.8125rem;
  line-height: 1.65;
  color: var(--text-secondary);
  margin-bottom: 10px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.result-snippet :deep(mark) {
  background: rgba(251, 191, 36, 0.22);
  color: var(--warning-fg);
  border-radius: 2px;
  padding: 0 2px;
}

.result-snippet :deep(code) {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.75rem;
  background: var(--neutral-subtle);
  padding: 1px 4px;
  border-radius: 3px;
}

.result-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.result-meta-sep {
  opacity: 0.3;
}

.tool-name-badge {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.625rem;
  background: var(--neutral-subtle);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.result-view-btn {
  margin-left: auto;
  color: var(--accent-fg);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.6875rem;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: var(--radius-md);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-emphasis);
  transition: all var(--transition-fast);
  white-space: nowrap;
  flex-shrink: 0;
}

.result-view-btn:hover {
  background: var(--accent-emphasis);
  color: var(--text-on-emphasis, #fff);
}

/* ÔöÇÔöÇ Pagination ÔöÇÔöÇ */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 24px 0 8px;
  flex-wrap: wrap;
}

.pagination-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.pagination-btn:hover:not(:disabled) {
  border-color: var(--border-accent);
  color: var(--text-primary);
}

.pagination-btn.active {
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
  color: white;
}

.pagination-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.pagination-ellipsis {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

.pagination-info {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-left: 12px;
}

/* ÔöÇÔöÇ Skeleton Loading ÔöÇÔöÇ */
.skeleton-card {
  pointer-events: none;
}

.skeleton-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--neutral-subtle) 25%,
    var(--neutral-muted) 50%,
    var(--neutral-subtle) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}

.skeleton-badge {
  width: 100px;
  height: 20px;
}

.skeleton-badge-sm {
  width: 64px;
  height: 20px;
}

.skeleton-text {
  height: 14px;
  margin-bottom: 8px;
  width: 100%;
}

.skeleton-text.short {
  width: 65%;
}

.skeleton-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

/* ÔöÇÔöÇ Animations ÔöÇÔöÇ */
@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.spin-icon {
  animation: spin 0.8s linear infinite;
}

/* ÔöÇÔöÇ Indexing Progress Banner ÔöÇÔöÇ */
.indexing-banner {
  margin: 0 0 12px 0;
  padding: 12px 16px;
  background: var(--surface-secondary);
  border: 1px solid var(--accent-fg);
  border-radius: 8px;
  animation: fadeSlideIn 0.3s ease both;
}

.indexing-banner-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

.indexing-banner-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--accent-fg);
}

.indexing-banner-text {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.indexing-banner-bar-container {
  flex: 1;
  min-width: 80px;
  height: 4px;
  background: var(--surface-tertiary);
  border-radius: 2px;
  overflow: hidden;
}

.indexing-banner-bar {
  height: 100%;
  background: var(--accent-fg);
  border-radius: 2px;
  transition: width 0.3s ease-out;
}

/* ÔöÇÔöÇ Expanded Result Details ÔöÇÔöÇ */
.result-expanded {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-default);
  animation: fadeSlideIn 0.2s ease both;
}

.expanded-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
  margin-bottom: 12px;
}

.expanded-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.expanded-label {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.expanded-value {
  font-size: 0.75rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expanded-mono {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.6875rem;
}

.expanded-view-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  background: var(--accent-subtle);
  border: 1px solid var(--border-accent);
  color: var(--accent-fg);
  font-size: 0.75rem;
  font-weight: 500;
  text-decoration: none;
  font-family: inherit;
  transition: all var(--transition-fast);
}

.expanded-view-btn:hover {
  background: var(--accent-muted);
}

.result-card.expanded .result-snippet {
  -webkit-line-clamp: unset;
  display: block;
}

/* ÔöÇÔöÇ Facets Sidebar (right) ÔöÇÔöÇ */
.facets-sidebar {
  width: 240px;
  min-width: 240px;
  background: var(--canvas-subtle);
  border-left: 1px solid var(--border-default);
  border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.facet-section {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.facet-title {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 10px;
}

.facet-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.facet-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: background var(--transition-fast);
}

.facet-row:hover {
  background: var(--neutral-subtle);
}

.facet-row-active {
  background: var(--neutral-subtle);
}

.facet-row-active .facet-label {
  color: var(--text-primary);
  font-weight: 600;
}

.facet-empty {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  padding: 4px 6px;
  font-style: italic;
}

.facet-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  opacity: 0.08;
  border-radius: var(--radius-sm);
  pointer-events: none;
  transition: width var(--transition-normal);
}

.facet-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.facet-label {
  flex: 1;
  font-size: 0.6875rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  position: relative;
  z-index: 1;
}

.facet-label-mono {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.625rem;
}

.facet-count {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  min-width: 20px;
  text-align: right;
  position: relative;
  z-index: 1;
}

/* ÔöÇÔöÇ Responsive ÔöÇÔöÇ */
@media (max-width: 1100px) {
  .facets-sidebar {
    display: none;
  }
}

/* ÔöÇÔöÇ Responsive ÔöÇÔöÇ */
@media (max-width: 900px) {
  .search-hero {
    padding: 16px 0 0;
  }
}

/* -- Browse Presets (moved to SearchBrowsePresets component) -- */

/* -- Filter facet count badges (moved to SearchFilterSidebar) -- */

/* -- Session summary in meta (moved to SearchResultCard) -- */
.result-session-summary {
  font-weight: 500;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

/* -- Tri-state filter, filter sidebar, filter clear moved to SearchFilterSidebar -- */

/* -- Active filter chips bar -- */
.active-filters-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  flex-shrink: 0;
}

.active-filters-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
  white-space: nowrap;
}

.active-filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 6px;
  border-radius: var(--radius-full);
  font-size: 0.6875rem;
  font-weight: 500;
  white-space: nowrap;
  transition: all var(--transition-fast);
}

.filter-chip-include {
  background: var(--accent-subtle);
  color: var(--accent-fg);
  border: 1px solid var(--accent-emphasis);
}

.filter-chip-exclude {
  background: var(--danger-subtle);
  color: var(--danger-fg);
  border: 1px solid var(--danger-fg);
}

.filter-chip-neutral {
  background: var(--neutral-subtle);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
}

.filter-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.filter-chip-prefix {
  font-weight: 700;
  font-size: 0.5625rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.filter-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
  margin-left: 2px;
  opacity: 0.6;
  transition: opacity var(--transition-fast), background var(--transition-fast);
}

.filter-chip-remove:hover {
  opacity: 1;
  background: var(--state-hover-overlay);
}

.filter-chip-clear-all {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-family: inherit;
  transition: color var(--transition-fast);
}

.filter-chip-clear-all:hover {
  color: var(--accent-fg);
}

/* -- View mode toggle -- */
.view-mode-toggle {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  background: var(--canvas-subtle);
  border-radius: var(--radius-md);
  padding: 2px;
  border: 1px solid var(--border-default);
}

.view-mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.view-mode-btn:hover {
  color: var(--text-primary);
}

.view-mode-btn.active {
  background: var(--canvas-default);
  color: var(--accent-fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* ── Keyboard focus indicator ────────────────────────────── */
.result-focused {
  outline: 2px solid var(--accent-fg);
  outline-offset: -2px;
}

/* ── Copy button ─────────────────────────────────────────── */
.result-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  background: transparent;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.675rem;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.result-copy-btn:hover {
  color: var(--accent-fg);
  background: var(--accent-subtle);
  border-color: var(--accent-fg);
}

/* ── Keyboard hints ──────────────────────────────────────── */
.keyboard-hints {
  position: fixed;
  bottom: 16px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  opacity: 0.85;
  pointer-events: none;
  background: var(--canvas-subtle);
  padding: 6px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-muted);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.keyboard-hints kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  padding: 2px 7px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.4;
}

/* ── Recent searches (moved to SearchBrowsePresets) ──────── */

/* ── Preset colors, syntax help, modal, first-run moved to child components ── */

/* ── Health status bar ──────────────────────────────────────── */
.search-health-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  padding: 10px 16px;
  margin-top: 4px;
}

.health-separator {
  color: var(--border-muted);
}

.health-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.health-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.health-dot.synced {
  background: var(--success-fg, #3fb950);
}

.health-dot.pending {
  background: var(--attention-fg, #d29922);
}

.health-pending {
  color: var(--attention-fg, #d29922);
}
</style>
