<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useSearchStore } from '@/stores/search';
import { useSessionsStore } from '@/stores/sessions';
import { safeListen } from '@/utils/tauriEvents';
import type { SearchContentType } from '@tracepilot/types';
import { CONTENT_TYPE_CONFIG, ALL_CONTENT_TYPES } from '@tracepilot/ui';

const store = useSearchStore();
const sessionsStore = useSessionsStore();

// ÔöÇÔöÇ Main indexing progress (local to this view) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
const indexingProgress = ref<{ current: number; total: number } | null>(null);
const isIndexing = ref(false);
const unlisteners: UnlistenFn[] = [];

// Repo list: prefer search facets if available, fall back to sessions store
const availableRepositories = computed(() => {
  return store.availableRepositories.length > 0 ? store.availableRepositories : sessionsStore.repositories;
});

// ÔöÇÔöÇ Local UI state ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
const searchInputRef = ref<HTMLInputElement | null>(null);
const filtersOpen = ref(true);
const activeDatePreset = ref<string>('all');

// ÔöÇÔöÇ Content type config ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// ── Content type config (shared) ─────────────────────────────
const contentTypeConfig = CONTENT_TYPE_CONFIG;
const allContentTypes = ALL_CONTENT_TYPES;

// ÔöÇÔöÇ Computed helpers ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
const activeFilterCount = computed(() => {
  let count = 0;
  if (store.contentTypes.length > 0) count++;
  if (store.repository) count++;
  if (store.dateFrom || store.dateTo) count++;
  return count;
});

const pageStart = computed(() => (store.page - 1) * store.pageSize + 1);
const pageEnd = computed(() => Math.min(store.page * store.pageSize, store.totalCount));

const visiblePages = computed(() => {
  const total = store.totalPages;
  const current = store.page;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | null)[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push(null);
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push(null);
  pages.push(total);
  return pages;
});

// ÔöÇÔöÇ Content type toggle ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
function toggleContentType(ct: SearchContentType) {
  const idx = store.contentTypes.indexOf(ct);
  if (idx >= 0) {
    store.contentTypes.splice(idx, 1);
  } else {
    store.contentTypes.push(ct);
  }
  // If all types selected, clear array (equivalent to "no filter")
  if (store.contentTypes.length === allContentTypes.length) {
    store.contentTypes.splice(0);
  }
}

function isContentTypeActive(ct: SearchContentType): boolean {
  return store.contentTypes.includes(ct);
}

function toggleAllContentTypes() {
  if (store.contentTypes.length > 0) {
    store.contentTypes.splice(0);
  } else {
    store.contentTypes.splice(0, store.contentTypes.length, ...allContentTypes);
  }
}

function getFacetCount(ct: string): number | null {
  const facets = store.facets?.byContentType;
  if (!facets) return null;
  const entry = facets.find(([type]) => type === ct);
  return entry ? entry[1] : null;
}

// ÔöÇÔöÇ Expandable result cards ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
const expandedResults = ref<Set<number>>(new Set());

function toggleExpand(id: number) {
  if (expandedResults.value.has(id)) {
    expandedResults.value.delete(id);
  } else {
    expandedResults.value.add(id);
  }
}

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
function setDatePreset(preset: string) {
  activeDatePreset.value = preset;
  const now = new Date();
  switch (preset) {
    case 'today': {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      store.dateFrom = today.toISOString();
      store.dateTo = null;
      break;
    }
    case 'week': {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      store.dateFrom = weekAgo.toISOString();
      store.dateTo = null;
      break;
    }
    case 'month': {
      const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      store.dateFrom = monthAgo.toISOString();
      store.dateTo = null;
      break;
    }
    case '3months': {
      const threeMonths = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      store.dateFrom = threeMonths.toISOString();
      store.dateTo = null;
      break;
    }
    default:
      store.dateFrom = null;
      store.dateTo = null;
  }
}

// ÔöÇÔöÇ Clear all filters ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
function handleClearFilters() {
  store.clearFilters();
  activeDatePreset.value = 'all';
}

// ÔöÇÔöÇ Format timestamp ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
function formatTimestamp(unix: number | null): string {
  if (unix == null) return '';
  const d = new Date(unix * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRelativeTime(unix: number | null): string {
  if (unix == null) return '';
  const now = Date.now();
  const diffMs = now - unix * 1000;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return formatTimestamp(unix);
}

// ÔöÇÔöÇ Session link path ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
function sessionLink(sessionId: string, turnNumber: number | null, eventIndex: number | null = null): string {
  const base = `/session/${sessionId}/conversation`;
  const params = new URLSearchParams();
  if (turnNumber != null) params.set('turn', String(turnNumber));
  if (eventIndex != null) params.set('event', String(eventIndex));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// ÔöÇÔöÇ Keyboard shortcut (Ctrl+K) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  }
}

// ÔöÇÔöÇ Lifecycle ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
onMounted(async () => {
  store.fetchStats();
  store.fetchFilterOptions();
  // Fetch initial facets (browse mode gets filter-scoped counts)
  store.fetchFacets();
  window.addEventListener('keydown', handleKeydown);

  // Main indexing events (local — only for showing main index progress)
  unlisteners.push(
    await safeListen<{ current: number; total: number }>('indexing-progress', (event) => {
      indexingProgress.value = event.payload;
    }),
    await safeListen('indexing-started', () => {
      indexingProgress.value = null;
      isIndexing.value = true;
    }),
    await safeListen('indexing-finished', () => {
      indexingProgress.value = null;
      isIndexing.value = false;
    }),
  );
  // Search indexing events are handled globally in the search store
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  for (const unlisten of unlisteners) unlisten();
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
          <span class="search-hint"><code>AND</code> / <code>OR</code> boolean</span>
          <span class="search-hint"><code>NOT</code> exclude terms</span>
          <span class="search-hint">Leave empty to browse by filters</span>
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

      <!-- ÔòÉÔòÉÔòÉ Indexing Progress Banner ÔòÉÔòÉÔòÉ -->
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
        <aside class="filter-sidebar" :class="{ collapsed: !filtersOpen }">
          <!-- Content Types -->
          <div>
            <div class="filter-group-title">
              Content Type
              <button class="filter-select-all-btn" @click="toggleAllContentTypes">
                {{ store.contentTypes.length > 0 ? 'Clear All' : 'Select All' }}
              </button>
            </div>
            <div class="filter-group">
              <label
                v-for="ct in allContentTypes"
                :key="ct"
                class="filter-checkbox-row"
              >
                <input
                  type="checkbox"
                  :checked="isContentTypeActive(ct)"
                  @change="toggleContentType(ct)"
                />
                <span
                  class="filter-color-dot"
                  :style="{ background: contentTypeConfig[ct].color }"
                />
                <span class="filter-label">{{ contentTypeConfig[ct].label }}</span>
                <span v-if="getFacetCount(ct)" class="filter-facet-count">{{ getFacetCount(ct) }}</span>
              </label>
            </div>
          </div>

          <!-- Repository -->
          <div>
            <div class="filter-group-title">Repository</div>
            <select
              class="filter-select-full"
              :value="store.repository ?? ''"
              @change="store.repository = ($event.target as HTMLSelectElement).value || null"
            >
              <option value="">All Repositories</option>
              <option
                v-for="repo in availableRepositories"
                :key="repo"
                :value="repo"
              >
                {{ repo }}
              </option>
            </select>
          </div>

          <!-- Tool Name -->
          <div v-if="store.availableToolNames.length > 0">
            <div class="filter-group-title">Tool</div>
            <select
              class="filter-select-full"
              :value="store.toolName ?? ''"
              @change="store.toolName = ($event.target as HTMLSelectElement).value || null"
            >
              <option value="">All Tools</option>
              <option
                v-for="tool in store.availableToolNames"
                :key="tool"
                :value="tool"
              >
                {{ tool }}
              </option>
            </select>
          </div>

          <!-- Date Range -->
          <div>
            <div class="filter-group-title">Date Range</div>
            <div class="date-preset-group">
              <button
                v-for="preset in [
                  { key: 'today', label: 'Today' },
                  { key: 'week', label: 'This Week' },
                  { key: 'month', label: 'This Month' },
                  { key: '3months', label: 'Last 3 Months' },
                  { key: 'all', label: 'All Time' },
                ]"
                :key="preset.key"
                class="date-preset-btn"
                :class="{ active: activeDatePreset === preset.key }"
                @click="setDatePreset(preset.key)"
              >
                {{ preset.label }}
              </button>
            </div>
          </div>

          <!-- Clear Filters -->
          <div>
            <button class="filter-clear-btn" @click="handleClearFilters">
              ✕ Clear all filters
            </button>
          </div>
        </aside>

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
            <!-- Browse Mode: Quick Presets -->
            <div class="browse-presets">
              <div class="browse-title">Browse your sessions</div>
              <div class="browse-subtitle">
                Use filters or try a quick preset to explore your session content.
              </div>
              <div class="browse-preset-grid">
                <button class="browse-preset-btn browse-preset-errors" @click="store.browseErrors()">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
                    <circle cx="8" cy="8" r="6" /><line x1="8" y1="5" x2="8" y2="9" /><circle cx="8" cy="11" r="0.5" fill="currentColor" />
                  </svg>
                  <span class="preset-label">All Errors</span>
                  <span class="preset-desc">Errors &amp; tool failures</span>
                </button>
                <button class="browse-preset-btn browse-preset-user" @click="store.browseUserMessages()">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
                    <circle cx="8" cy="5" r="3" /><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
                  </svg>
                  <span class="preset-label">User Messages</span>
                  <span class="preset-desc">Your prompts &amp; requests</span>
                </button>
                <button class="browse-preset-btn browse-preset-tools" @click="store.browseToolCalls()">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
                    <path d="M4 2v12M12 2v12M2 6h12M2 10h12" />
                  </svg>
                  <span class="preset-label">Tool Calls</span>
                  <span class="preset-desc">All tool invocations</span>
                </button>
              </div>
              <div v-if="store.stats" class="empty-stats">
                <span class="empty-stat">
                  <strong>{{ store.stats.totalSessions.toLocaleString() }}</strong> sessions indexed
                </span>
                <span class="empty-stat-sep">·</span>
                <span class="empty-stat">
                  <strong>{{ store.stats.totalRows.toLocaleString() }}</strong> content rows
                </span>
              </div>
            </div>
          </div>

          <!-- ÔòÉÔòÉÔòÉ Results ÔòÉÔòÉÔòÉ -->
          <div v-else class="search-main-scroll">

            <!-- Stats Bar -->
            <div class="results-summary">
              <span v-if="store.hasResults" class="results-summary-text">
                {{ store.isBrowseMode ? 'Browsing' : 'Found' }} <strong>{{ store.totalCount.toLocaleString() }}</strong>
                result{{ store.totalCount !== 1 ? 's' : '' }}
                <span class="summary-speed">({{ store.latencyMs.toFixed(2) }}ms)</span>
                <template v-if="store.totalPages > 1">
                  — page {{ store.page }} of {{ store.totalPages }}
                </template>
              </span>
              <span v-else class="results-summary-text">
                No results found
              </span>
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

            <!-- Results List -->
            <div v-else class="results-list">
              <div
                v-for="(result, idx) in store.results"
                :key="result.id"
                class="result-card"
                :class="{ expanded: expandedResults.has(result.id) }"
                :style="{ animationDelay: `${Math.min(idx, 8) * 30}ms` }"
                @click="toggleExpand(result.id)"
              >
                <div class="result-header">
                  <span
                    v-if="result.sessionRepository"
                    class="badge badge-accent"
                    style="font-size: 0.625rem"
                  >
                    {{ result.sessionRepository }}
                  </span>
                  <span
                    v-if="result.sessionBranch"
                    class="badge badge-success"
                    style="font-size: 0.625rem"
                  >
                    {{ result.sessionBranch }}
                  </span>
                  <span v-if="result.timestampUnix != null" class="result-date" :title="formatTimestamp(result.timestampUnix)">
                    {{ formatRelativeTime(result.timestampUnix) }}
                  </span>
                  <span
                    class="ct-badge"
                    :style="{
                      background: contentTypeConfig[result.contentType]?.color + '20',
                      color: contentTypeConfig[result.contentType]?.color,
                    }"
                    style="margin-left: auto"
                  >
                    {{ contentTypeConfig[result.contentType]?.label ?? result.contentType }}
                  </span>
                </div>

                <!-- eslint-disable-next-line vue/no-v-html -- server-controlled highlighted snippet -->
                <div class="result-snippet" v-html="result.snippet" />

                <div class="result-meta">
                  <span v-if="result.sessionSummary" class="result-session-summary" :title="result.sessionSummary">{{ result.sessionSummary.length > 50 ? result.sessionSummary.slice(0, 50) + '…' : result.sessionSummary }}</span>
                  <span v-if="result.sessionSummary" class="result-meta-sep">·</span>
                  <span v-if="result.turnNumber != null">Turn {{ result.turnNumber }}</span>
                  <span v-if="result.turnNumber != null" class="result-meta-sep">·</span>
                  <span>{{ result.contentType.replace(/_/g, ' ') }}</span>
                  <template v-if="result.toolName">
                    <span class="result-meta-sep">·</span>
                    <span class="tool-name-badge">{{ result.toolName }}</span>
                  </template>
                  <router-link
                    :to="sessionLink(result.sessionId, result.turnNumber, result.eventIndex)"
                    class="result-view-btn"
                    @click.stop
                  >
                    View in session
                  </router-link>
                </div>

                <!-- Expanded Details -->
                <div v-if="expandedResults.has(result.id)" class="result-expanded">
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
                      <span class="expanded-value">{{ formatTimestamp(result.timestampUnix) }}</span>
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

            <!-- ÔòÉÔòÉÔòÉ Pagination ÔòÉÔòÉÔòÉ -->
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
  padding: 0 0 28px;
}

/* ÔöÇÔöÇ Filter Sidebar ÔöÇÔöÇ */
.filter-sidebar {
  width: 260px;
  min-width: 260px;
  background: var(--canvas-subtle);
  border-right: 1px solid var(--border-default);
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  transition: width var(--transition-slow), min-width var(--transition-slow),
    padding var(--transition-slow), opacity var(--transition-slow);
}

.filter-sidebar.collapsed {
  width: 0;
  min-width: 0;
  padding: 0;
  opacity: 0;
  overflow: hidden;
  border-right: none;
}

.filter-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 10px;
}

.filter-select-all-btn {
  background: none;
  border: none;
  color: var(--text-link);
  font-size: 0.625rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  text-transform: none;
  letter-spacing: normal;
  padding: 0;
  opacity: 0.8;
  transition: opacity var(--transition-fast);
}

.filter-select-all-btn:hover {
  opacity: 1;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.filter-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  cursor: pointer;
  user-select: none;
  transition: color var(--transition-fast);
}

.filter-checkbox-row:hover {
  color: var(--text-primary);
}

.filter-checkbox-row input[type="checkbox"] {
  appearance: none;
  width: 15px;
  height: 15px;
  border: 1px solid var(--border-default);
  border-radius: 3px;
  background: var(--canvas-default);
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  transition: all var(--transition-fast);
}

.filter-checkbox-row input[type="checkbox"]:checked {
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
}

.filter-checkbox-row input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 5px;
  height: 8px;
  border: solid white;
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.filter-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.filter-label {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  flex: 1;
}

.filter-checkbox-row:hover .filter-label {
  color: var(--text-primary);
}

.filter-checkbox-row input:checked ~ .filter-label {
  color: var(--text-primary);
}

.filter-select-full {
  width: 100%;
  padding: 7px 28px 7px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2371717a'%3E%3Cpath d='M5 7L0.5 2.5h9z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  transition: border-color var(--transition-fast);
}

.filter-select-full:focus {
  border-color: var(--accent-emphasis);
  box-shadow: var(--shadow-glow-accent);
}

.date-preset-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.date-preset-btn {
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.date-preset-btn:hover {
  border-color: var(--border-accent);
  color: var(--text-primary);
}

.date-preset-btn.active {
  background: var(--accent-subtle);
  border-color: var(--border-accent);
  color: var(--accent-fg);
}

.filter-clear-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 0;
  background: none;
  border: none;
  color: var(--text-link);
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  opacity: 0.8;
  transition: opacity var(--transition-fast);
}

.filter-clear-btn:hover {
  opacity: 1;
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
  padding: 14px 0;
  border-bottom: 1px solid var(--border-default);
  margin-bottom: 16px;
  flex-shrink: 0;
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
  color: #fff;
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

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ÔöÇÔöÇ Indexing Progress Banner ÔöÇÔöÇ */
.indexing-banner {
  margin: 0 0 12px 0;
  padding: 12px 16px;
  background: var(--bg-secondary, #1c1c1e);
  border: 1px solid var(--accent-fg, #58a6ff);
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
  color: var(--accent-fg, #58a6ff);
}

.indexing-banner-text {
  font-size: 0.8125rem;
  color: var(--fg-secondary, #8b949e);
  white-space: nowrap;
}

.indexing-banner-bar-container {
  flex: 1;
  min-width: 80px;
  height: 4px;
  background: var(--bg-tertiary, #30363d);
  border-radius: 2px;
  overflow: hidden;
}

.indexing-banner-bar {
  height: 100%;
  background: var(--accent-fg, #58a6ff);
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
  .filter-sidebar {
    display: none;
  }

  .search-hero {
    padding: 16px 0 0;
  }
}

/* -- Browse Presets -- */
.browse-presets {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px 24px;
  text-align: center;
}

.browse-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.browse-subtitle {
  font-size: 0.875rem;
  color: var(--text-secondary);
  max-width: 460px;
  line-height: 1.5;
  margin-bottom: 24px;
}

.browse-preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  max-width: 520px;
  width: 100%;
  margin-bottom: 24px;
}

.browse-preset-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
  text-align: center;
}

.browse-preset-btn:hover {
  border-color: var(--border-accent);
  background: var(--canvas-overlay);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.browse-preset-errors { color: #ef4444; }
.browse-preset-errors:hover { border-color: #ef4444; }
.browse-preset-user { color: #4ade80; }
.browse-preset-user:hover { border-color: #4ade80; }
.browse-preset-tools { color: #f59e0b; }
.browse-preset-tools:hover { border-color: #f59e0b; }

.preset-label {
  font-weight: 600;
  font-size: 0.8125rem;
  color: var(--text-primary);
}

.preset-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

/* -- Filter facet count badges -- */
.filter-facet-count {
  margin-left: auto;
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  background: var(--neutral-subtle);
  padding: 0 5px;
  border-radius: 8px;
  min-width: 18px;
  text-align: center;
}

/* -- Session summary in meta -- */
.result-session-summary {
  font-weight: 500;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
</style>
