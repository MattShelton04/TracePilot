import { defineStore } from 'pinia';
import { ref, computed, watch, nextTick } from 'vue';
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
import { toErrorMessage } from '@tracepilot/ui';

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
          fetchStats();
          fetchFilterOptions();
          // Re-run current search if results are showing
          if (hasQuery.value || hasActiveFilters.value || hasResults.value) {
            scheduleSearch(false);
          } else {
            fetchFacets();
          }
        }),
      );
    } catch {
      // not in Tauri environment
    }
  }

  // Initialize listeners eagerly when the store is first created
  initEventListeners();

  // ── Computed ─────────────────────────────────────────────────
  const hasResults = computed(() => results.value.length > 0);
  const hasQuery = computed(() => query.value.trim().length > 0);
  const isBrowseMode = computed(() => !hasQuery.value);
  const totalPages = computed(() => Math.ceil(totalCount.value / pageSize.value));
  const hasActiveFilters = computed(() => {
    return contentTypes.value.length > 0
      || repository.value !== null
      || toolName.value !== null
      || dateFrom.value !== null
      || dateTo.value !== null
      || sessionId.value !== null;
  });

  // ── Single search scheduler (replaces multiple watchers) ────
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchGeneration = 0;
  const DEBOUNCE_MS = 150;

  /**
   * Schedule a search. All state changes funnel through here.
   * - resetPage: reset to page 1 (true for query/filter changes, false for page changes)
   * - debounce: add delay (true for typing, false for filter clicks)
   */
  function scheduleSearch(resetPage: boolean, debounce = false) {
    if (searchTimer) clearTimeout(searchTimer);
    if (resetPage) page.value = 1;

    if (debounce) {
      searchTimer = setTimeout(executeSearch, DEBOUNCE_MS);
    } else {
      // Use nextTick to coalesce synchronous state changes (e.g. presets)
      nextTick(executeSearch);
    }
  }

  async function executeSearch() {
    // In browse mode, default to newest sort since relevance is meaningless
    const effectiveSort = isBrowseMode.value && sortBy.value === 'relevance'
      ? 'newest'
      : sortBy.value;

    const gen = ++searchGeneration;
    loading.value = true;
    error.value = null;

    try {
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
        sortBy: effectiveSort !== 'relevance' ? effectiveSort : undefined,
      });

      if (gen !== searchGeneration) return;

      results.value = response.results;
      totalCount.value = response.totalCount;
      hasMore.value = response.hasMore;
      latencyMs.value = response.latencyMs;

      // Fetch facets alongside results
      const facetQuery = hasQuery.value ? query.value : undefined;
      fetchFacets(facetQuery);
    } catch (e) {
      if (gen !== searchGeneration) return;
      error.value = toErrorMessage(e);
      results.value = [];
      totalCount.value = 0;
      hasMore.value = false;
      latencyMs.value = 0;
    } finally {
      if (gen === searchGeneration) loading.value = false;
    }
  }

  // Query changes → debounced search (resets page)
  watch(query, () => scheduleSearch(true, true));

  // Filter changes → immediate search (resets page)
  watch(
    [contentTypes, repository, toolName, dateFrom, dateTo, sessionId, sortBy],
    () => scheduleSearch(true),
    { deep: true },
  );

  // Page changes → immediate search (no page reset)
  watch(page, () => scheduleSearch(false));

  // ── Quick browse presets ─────────────────────────────────────
  // These set multiple refs synchronously. nextTick in scheduleSearch
  // coalesces them into a single executeSearch call.
  function browseErrors() {
    query.value = '';
    contentTypes.value = ['error', 'tool_error'];
    repository.value = null;
    toolName.value = null;
    dateFrom.value = null;
    dateTo.value = null;
    sessionId.value = null;
    sortBy.value = 'newest';
  }

  function browseUserMessages() {
    query.value = '';
    contentTypes.value = ['user_message'];
    repository.value = null;
    toolName.value = null;
    dateFrom.value = null;
    dateTo.value = null;
    sessionId.value = null;
    sortBy.value = 'newest';
  }

  function browseToolCalls() {
    query.value = '';
    contentTypes.value = ['tool_call'];
    repository.value = null;
    toolName.value = null;
    dateFrom.value = null;
    dateTo.value = null;
    sessionId.value = null;
    sortBy.value = 'newest';
  }

  // ── Facets & stats ───────────────────────────────────────────
  let facetGeneration = 0;

  async function fetchFacets(forQuery?: string) {
    const gen = ++facetGeneration;
    try {
      let dateFromUnix: number | undefined;
      let dateToUnix: number | undefined;
      if (dateFrom.value) dateFromUnix = Math.floor(new Date(dateFrom.value).getTime() / 1000);
      if (dateTo.value) dateToUnix = Math.floor(new Date(dateTo.value).getTime() / 1000);

      const result = await getSearchFacets(forQuery, {
        contentTypes: contentTypes.value.length > 0 ? contentTypes.value : undefined,
        repositories: repository.value ? [repository.value] : undefined,
        toolNames: toolName.value ? [toolName.value] : undefined,
        sessionId: sessionId.value ?? undefined,
        dateFromUnix,
        dateToUnix,
      });
      if (gen !== facetGeneration) return;
      facets.value = result;
    } catch (e) {
      if (gen !== facetGeneration) return;
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
      if (hasQuery.value || hasActiveFilters.value || hasResults.value) {
        await executeSearch();
      }
    } catch (e) {
      error.value = toErrorMessage(e);
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
    isBrowseMode,
    hasActiveFilters,
    totalPages,
    // Actions
    executeSearch,
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
    browseErrors,
    browseUserMessages,
    browseToolCalls,
  };
});
