import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type {
  SearchResult,
  SearchContentType,
  SearchFacetsResponse,
  SearchStatsResponse,
  SearchIndexingProgress,
} from '@tracepilot/types';
import {
  searchContent,
  getSearchStats,
  getSearchFacets,
  getSearchRepositories,
  getSearchToolNames,
  rebuildSearchIndex,
} from '@tracepilot/client';
import { safeListen } from '@/utils/tauriEvents';
import type { UnlistenFn } from '@tauri-apps/api/event';

export const useSearchStore = defineStore('search', () => {
  // ── Query state ──────────────────────────────────────────────
  const query = ref('');
  const contentTypes = ref<SearchContentType[]>([]);
  const repository = ref<string | null>(null);
  const toolName = ref<string | null>(null);
  const dateFrom = ref<string | null>(null);
  const dateTo = ref<string | null>(null);
  const sessionId = ref<string | null>(null);
  const sortBy = ref<'relevance' | 'newest' | 'oldest'>('relevance');
  const page = ref(1);
  const pageSize = ref(50);

  // ── Results state ────────────────────────────────────────────
  const results = ref<SearchResult[]>([]);
  const totalCount = ref(0);
  const hasMore = ref(false);
  const latencyMs = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // ── Facets & stats ───────────────────────────────────────────
  const stats = ref<SearchStatsResponse | null>(null);
  const facets = ref<SearchFacetsResponse | null>(null);
  const statsLoading = ref(false);

  // ── Available filter options ─────────────────────────────────
  const availableRepositories = ref<string[]>([]);
  const availableToolNames = ref<string[]>([]);

  // ── Rebuild / search-indexing state ──────────────────────────
  const rebuilding = ref(false);
  const searchIndexing = ref(false);
  const searchIndexingProgress = ref<SearchIndexingProgress | null>(null);

  // Global event listeners — initialized once, persist across route navigation
  let listenersInitialized = false;
  const unlisteners: UnlistenFn[] = [];

  async function initEventListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    try {
      unlisteners.push(
        await safeListen('search-indexing-started', () => {
          searchIndexing.value = true;
          searchIndexingProgress.value = null;
        }),
        await safeListen<SearchIndexingProgress>('search-indexing-progress', (event) => {
          searchIndexingProgress.value = event.payload;
        }),
        await safeListen('search-indexing-finished', () => {
          searchIndexing.value = false;
          searchIndexingProgress.value = null;
          // Auto-refresh stats and facets after search indexing completes
          fetchStats();
          fetchFacets();
          fetchFilterOptions();
        }),
      );
    } catch {
      // not in Tauri environment
    }
  }

  // Initialize listeners eagerly when the store is first created
  initEventListeners();

  // ── Debounce ─────────────────────────────────────────────────
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 150;

  // ── Computed ─────────────────────────────────────────────────
  const hasResults = computed(() => results.value.length > 0);
  const hasQuery = computed(() => query.value.trim().length > 0);
  const totalPages = computed(() => Math.ceil(totalCount.value / pageSize.value));

  const resultsBySession = computed(() => {
    const groups = new Map<string, { results: SearchResult[]; summary: string | null; repository: string | null }>();
    for (const result of results.value) {
      if (!groups.has(result.sessionId)) {
        groups.set(result.sessionId, {
          results: [],
          summary: result.sessionSummary,
          repository: result.sessionRepository,
        });
      }
      groups.get(result.sessionId)!.results.push(result);
    }
    return groups;
  });

  // ── Core search ──────────────────────────────────────────────
  let searchGeneration = 0;

  async function executeSearch() {
    if (!query.value.trim()) {
      ++searchGeneration;
      results.value = [];
      totalCount.value = 0;
      hasMore.value = false;
      latencyMs.value = 0;
      return;
    }

    const gen = ++searchGeneration;
    loading.value = true;
    error.value = null;

    try {
      // Convert frontend filter state to backend SearchFilters
      let dateFromUnix: number | undefined;
      let dateToUnix: number | undefined;
      if (dateFrom.value) {
        dateFromUnix = Math.floor(new Date(dateFrom.value).getTime() / 1000);
      }
      if (dateTo.value) {
        dateToUnix = Math.floor(new Date(dateTo.value).getTime() / 1000);
      }

      const response = await searchContent(query.value, {
        contentTypes: contentTypes.value.length > 0 ? contentTypes.value : undefined,
        repositories: repository.value ? [repository.value] : undefined,
        toolNames: toolName.value ? [toolName.value] : undefined,
        sessionId: sessionId.value ?? undefined,
        dateFromUnix,
        dateToUnix,
        limit: pageSize.value,
        offset: (page.value - 1) * pageSize.value,
        sortBy: sortBy.value !== 'relevance' ? sortBy.value : undefined,
      });

      // Discard stale results from superseded requests
      if (gen !== searchGeneration) return;

      results.value = response.results;
      totalCount.value = response.totalCount;
      hasMore.value = response.hasMore;
      latencyMs.value = response.latencyMs;

      // Refresh facets with the current query for query-scoped counts
      fetchFacets(query.value);
    } catch (e) {
      if (gen !== searchGeneration) return;
      error.value = String(e);
      results.value = [];
      totalCount.value = 0;
      hasMore.value = false;
      latencyMs.value = 0;
    } finally {
      if (gen === searchGeneration) loading.value = false;
    }
  }

  function debouncedSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      page.value = 1;
      executeSearch();
    }, DEBOUNCE_MS);
  }

  // Watch query changes for debounced search
  watch(query, () => {
    debouncedSearch();
  });

  // Watch filter changes for immediate search
  watch([contentTypes, repository, toolName, dateFrom, dateTo, sessionId, sortBy], () => {
    if (hasQuery.value) {
      page.value = 1;
      executeSearch();
    }
  }, { deep: true });

  // Watch page changes
  watch(page, () => {
    if (hasQuery.value) {
      executeSearch();
    }
  });

  // ── Facets & stats ───────────────────────────────────────────
  async function fetchFacets(forQuery?: string) {
    try {
      // When a query is active, pass it + filters to get query-scoped facets
      if (forQuery && forQuery.trim()) {
        let dateFromUnix: number | undefined;
        let dateToUnix: number | undefined;
        if (dateFrom.value) dateFromUnix = Math.floor(new Date(dateFrom.value).getTime() / 1000);
        if (dateTo.value) dateToUnix = Math.floor(new Date(dateTo.value).getTime() / 1000);
        facets.value = await getSearchFacets(forQuery, {
          contentTypes: contentTypes.value.length > 0 ? contentTypes.value : undefined,
          repositories: repository.value ? [repository.value] : undefined,
          toolNames: toolName.value ? [toolName.value] : undefined,
          sessionId: sessionId.value ?? undefined,
          dateFromUnix,
          dateToUnix,
        });
      } else {
        facets.value = await getSearchFacets();
      }
    } catch (e) {
      console.warn('Failed to fetch search facets:', e);
    }
  }

  async function fetchStats() {
    statsLoading.value = true;
    try {
      stats.value = await getSearchStats();
    } catch (e) {
      console.warn('Failed to fetch search stats:', e);
    } finally {
      statsLoading.value = false;
    }
  }

  async function fetchFilterOptions() {
    try {
      const [repos, tools] = await Promise.all([
        getSearchRepositories(),
        getSearchToolNames(),
      ]);
      availableRepositories.value = repos;
      availableToolNames.value = tools;
    } catch {
      // non-fatal
    }
  }

  // ── Rebuild ──────────────────────────────────────────────────
  async function rebuild() {
    if (rebuilding.value || searchIndexing.value) return;
    rebuilding.value = true;
    error.value = null;
    try {
      await rebuildSearchIndex();
      await Promise.all([fetchStats(), fetchFacets(), fetchFilterOptions()]);
      if (hasQuery.value) {
        await executeSearch();
      }
    } catch (e) {
      error.value = String(e);
    } finally {
      rebuilding.value = false;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────
  function clearFilters() {
    contentTypes.value = [];
    repository.value = null;
    toolName.value = null;
    dateFrom.value = null;
    dateTo.value = null;
    sessionId.value = null;
    sortBy.value = 'relevance';
    page.value = 1;
  }

  function clearAll() {
    query.value = '';
    clearFilters();
    results.value = [];
    totalCount.value = 0;
    hasMore.value = false;
    latencyMs.value = 0;
    error.value = null;
  }

  function setPage(p: number) {
    page.value = Math.max(1, Math.min(p, totalPages.value || 1));
  }

  function nextPage() {
    if (hasMore.value) setPage(page.value + 1);
  }

  function prevPage() {
    if (page.value > 1) setPage(page.value - 1);
  }

  return {
    // Query state
    query,
    contentTypes,
    repository,
    toolName,
    dateFrom,
    dateTo,
    sessionId,
    sortBy,
    page,
    pageSize,
    // Results state
    results,
    totalCount,
    hasMore,
    latencyMs,
    loading,
    error,
    // Facets & stats
    stats,
    facets,
    statsLoading,
    availableRepositories,
    availableToolNames,
    // Rebuild
    rebuilding,
    searchIndexing,
    searchIndexingProgress,
    // Computed
    hasResults,
    hasQuery,
    totalPages,
    resultsBySession,
    // Actions
    executeSearch,
    debouncedSearch,
    fetchFacets,
    fetchStats,
    fetchFilterOptions,
    rebuild,
    clearFilters,
    clearAll,
    setPage,
    nextPage,
    prevPage,
    initEventListeners,
  };
});
