import type { UnlistenFn } from "@tauri-apps/api/event";
import type { FtsHealthInfo } from "@tracepilot/client";
import {
  ftsHealth,
  ftsIntegrityCheck,
  ftsOptimize,
  getSearchFacets,
  getSearchRepositories,
  getSearchStats,
  getSearchToolNames,
  rebuildSearchIndex,
  searchContent,
} from "@tracepilot/client";
import type {
  SearchContentType,
  SearchFacetsResponse,
  SearchIndexingProgress,
  SearchResult,
  SearchStatsResponse,
} from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, nextTick, ref, watch } from "vue";
import { useAsyncGuard } from "@/composables/useAsyncGuard";
import { useRecentSearches } from "@/composables/useRecentSearches";
import { useSearchClipboard } from "@/composables/useSearchClipboard";
import { logWarn } from "@/utils/logger";
import { parseQualifiers } from "@/utils/parseQualifiers";
import { safeListen } from "@/utils/tauriEvents";

// Re-export types and utilities that consumers may depend on
export type { RecentSearch } from "@/composables/useRecentSearches";
export type { ParsedQualifiers } from "@/utils/parseQualifiers";
export { parseQualifiers } from "@/utils/parseQualifiers";

export interface SessionGroup {
  sessionId: string;
  sessionSummary: string | null;
  sessionRepository: string | null;
  sessionBranch: string | null;
  results: SearchResult[];
}

/** Content-type presets for the browse-mode quick filters. */
export const BROWSE_PRESETS = {
  errors: ["error", "tool_error"],
  userMessages: ["user_message"],
  toolCalls: ["tool_call"],
  reasoning: ["reasoning"],
  toolResults: ["tool_result"],
  subagents: ["subagent"],
} as const satisfies Record<string, readonly SearchContentType[]>;

export interface FacetOverrides {
  contentTypes?: string[];
  repo?: string | null;
  tool?: string | null;
  session?: string | null;
}

interface ParsedDateRange {
  dateFromUnix?: number;
  dateToUnix?: number;
  error?: string;
}

export const useSearchStore = defineStore("search", () => {
  // ── Query state ──────────────────────────────────────────────
  const query = ref("");
  const contentTypes = ref<SearchContentType[]>([]);
  const excludeContentTypes = ref<SearchContentType[]>([]);
  const repository = ref<string | null>(null);
  const toolName = ref<string | null>(null);
  const dateFrom = ref<string | null>(null);
  const dateTo = ref<string | null>(null);
  const sessionId = ref<string | null>(null);
  const sortBy = ref<"relevance" | "newest" | "oldest">("relevance");
  const page = ref(1);
  const pageSize = ref(50);

  // When true, watcher-triggered searches are suppressed (URL hydration in progress)
  let hydrating = false;

  // Track if the search view is currently mounted (prevent background ops when navigated away)
  let isViewMounted = false;

  // ── Results state ────────────────────────────────────────────
  const results = ref<SearchResult[]>([]);
  const totalCount = ref(0);
  const hasMore = ref(false);
  const latencyMs = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const resultViewMode = ref<"flat" | "grouped">("flat");

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

  // ── FTS health / maintenance ────────────────────────────────
  const healthInfo = ref<FtsHealthInfo | null>(null);
  const healthLoading = ref(false);
  const maintenanceMessage = ref<string | null>(null);

  // ── Recent searches (delegated to composable) ──────────────
  const { recentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches } =
    useRecentSearches();

  // ── Clipboard (delegated to composable) ────────────────────
  const { copyResultsToClipboard: clipboardCopyResults, copySingleResult: clipboardCopySingle } =
    useSearchClipboard();

  // Global event listeners — initialized once, persist across route navigation
  let listenersInitialized = false;
  const unlisteners: UnlistenFn[] = [];

  async function initEventListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    try {
      unlisteners.push(
        await safeListen("search-indexing-started", () => {
          searchIndexing.value = true;
          searchIndexingProgress.value = null;
        }),
        await safeListen<SearchIndexingProgress>("search-indexing-progress", (event) => {
          searchIndexingProgress.value = event.payload;
        }),
        await safeListen("search-indexing-finished", () => {
          searchIndexing.value = false;
          searchIndexingProgress.value = null;
          // Only perform background operations if the search view is currently mounted
          // to avoid unnecessary API calls when user is on a different screen
          if (!isViewMounted) return;

          fetchStats();
          fetchFilterOptions();
          fetchHealth();
          // Re-run current search if results are showing
          if (hasQuery.value || hasActiveFilters.value || hasResults.value) {
            scheduleSearch(false);
          } else {
            fetchFacets();
          }
        }),
      );
    } catch (e) {
      // Not in Tauri environment - event listeners not available
      logWarn("[search] Failed to initialize event listeners (not in Tauri environment)", e);
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
    const hasMeaningfulDateValue = (value: string | null) => value != null && value.trim().length > 0;
    return (
      contentTypes.value.length > 0 ||
      excludeContentTypes.value.length > 0 ||
      repository.value !== null ||
      toolName.value !== null ||
      hasMeaningfulDateValue(dateFrom.value) ||
      hasMeaningfulDateValue(dateTo.value) ||
      sessionId.value !== null
    );
  });

  // Session-grouped view: group flat results by sessionId
  const groupedResults = computed<SessionGroup[]>(() => {
    if (results.value.length === 0) return [];
    const map = new Map<string, SessionGroup>();
    for (const r of results.value) {
      let group = map.get(r.sessionId);
      if (!group) {
        group = {
          sessionId: r.sessionId,
          sessionSummary: r.sessionSummary ?? null,
          sessionRepository: r.sessionRepository ?? null,
          sessionBranch: r.sessionBranch ?? null,
          results: [],
        };
        map.set(r.sessionId, group);
      }
      group.results.push(r);
    }
    return Array.from(map.values());
  });

  // ── Single search scheduler (replaces multiple watchers) ────
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressPageWatcher = false;
  const searchGuard = useAsyncGuard();
  const DEBOUNCE_MS = 150;

  /**
   * Schedule a search. All state changes funnel through here.
   * - resetPage: reset to page 1 (true for query/filter changes, false for page changes)
   * - debounce: add delay (true for typing, false for filter clicks)
   */
  function scheduleSearch(resetPage: boolean, debounce = false) {
    if (hydrating) return; // Suppress during URL hydration

    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }

    if (resetPage && page.value !== 1) {
      suppressPageWatcher = true;
      page.value = 1;
    }

    if (debounce) {
      searchTimer = setTimeout(() => {
        searchTimer = null;
        executeSearch();
      }, DEBOUNCE_MS);
    } else {
      // Use nextTick to coalesce synchronous state changes (e.g. presets)
      nextTick(() => executeSearch());
    }
  }

  async function executeSearch() {
    // In browse mode, default to newest sort since relevance is meaningless
    const effectiveSort =
      isBrowseMode.value && sortBy.value === "relevance" ? "newest" : sortBy.value;

    // Parse inline qualifiers (e.g. "type:error repo:myapp fix bug")
    const parsed = parseQualifiers(query.value);
    // Always use parsed.cleanQuery — empty string means "no text, filter only"
    const searchQuery = parsed.cleanQuery;

    // Merge qualifier-derived filters with explicit UI filters
    const mergedContentTypes =
      parsed.types.length > 0
        ? [...new Set([...contentTypes.value, ...parsed.types])]
        : contentTypes.value;
    const mergedRepo = parsed.repo ?? repository.value;
    const mergedTool = parsed.tool ?? toolName.value;
    const mergedSession = parsed.session ?? sessionId.value;
    const mergedSort = parsed.sort ?? effectiveSort;

    const token = searchGuard.start();
    loading.value = true;
    error.value = null;

    try {
      const { dateFromUnix, dateToUnix, error: dateError } = parseDateRange();
      if (dateError) {
        error.value = dateError;
        results.value = [];
        facets.value = null;
        totalCount.value = 0;
        hasMore.value = false;
        latencyMs.value = 0;
        return;
      }

      const response = await searchContent(searchQuery, {
        contentTypes: mergedContentTypes.length > 0 ? mergedContentTypes : undefined,
        excludeContentTypes:
          excludeContentTypes.value.length > 0 ? excludeContentTypes.value : undefined,
        repositories: mergedRepo ? [mergedRepo] : undefined,
        toolNames: mergedTool ? [mergedTool] : undefined,
        sessionId: mergedSession ?? undefined,
        dateFromUnix,
        dateToUnix,
        limit: pageSize.value,
        offset: (page.value - 1) * pageSize.value,
        sortBy: mergedSort !== "relevance" ? mergedSort : undefined,
      });

      if (!searchGuard.isValid(token)) return;

      results.value = response.results;
      totalCount.value = response.totalCount;
      hasMore.value = response.hasMore;
      latencyMs.value = response.latencyMs;

      // Record to recent searches (only for text queries, not browse mode)
      if (query.value.trim().length > 0 && response.totalCount > 0) {
        addRecentSearch(query.value.trim(), response.totalCount);
      }

      // Fetch facets using the same parsed query and merged filters as the search.
      // Use searchQuery directly (empty string = browse mode); don't fall back to raw
      // query.value which may contain qualifier syntax like "type:error".
      const facetQuery = searchQuery || undefined;
      fetchFacets(facetQuery, {
        contentTypes: mergedContentTypes,
        repo: mergedRepo,
        tool: mergedTool,
        session: mergedSession,
      });
    } catch (e) {
      if (!searchGuard.isValid(token)) return;
      error.value = toErrorMessage(e);
      results.value = [];
      totalCount.value = 0;
      hasMore.value = false;
      latencyMs.value = 0;
    } finally {
      if (searchGuard.isValid(token)) loading.value = false;
    }
  }

  // Query changes → debounced search (resets page)
  watch(query, () => scheduleSearch(true, true));

  // Filter changes → immediate search (resets page)
  watch(
    [contentTypes, excludeContentTypes, repository, toolName, dateFrom, dateTo, sessionId, sortBy],
    () => scheduleSearch(true),
    { deep: true },
  );

  // Page changes → immediate search (no page reset)
  watch(page, () => {
    if (suppressPageWatcher) {
      suppressPageWatcher = false;
      return;
    }
    scheduleSearch(false);
  });

  // ── Quick browse presets ─────────────────────────────────────
  /**
   * Apply a browse preset, clearing all filters and setting content types.
   * Resets query, pagination, and all filter fields, then triggers a search.
   * @param types - Array of content types to filter by (use BROWSE_PRESETS constants)
   */
  function applyBrowsePreset(types: readonly SearchContentType[]) {
    hydrating = true;
    page.value = 1;
    query.value = "";
    contentTypes.value = [...types];
    excludeContentTypes.value = [];
    repository.value = null;
    toolName.value = null;
    dateFrom.value = null;
    dateTo.value = null;
    sessionId.value = null;
    sortBy.value = "newest";
    nextTick(() => {
      hydrating = false;
      scheduleSearch(false);
    });
  }


  // ── Recent search helpers (store-level orchestration) ──────
  function applyRecentSearch(q: string) {
    query.value = q;
  }

  // ── Clipboard helpers (delegate to composable, keep store API) ──
  async function copyResultsToClipboard(resultsToCopy?: SearchResult[]): Promise<boolean> {
    return clipboardCopyResults(resultsToCopy ?? results.value);
  }

  async function copySingleResult(result: SearchResult): Promise<boolean> {
    return clipboardCopySingle(result);
  }

  // ── Facets & stats ───────────────────────────────────────────
  // Guards prevent stale async responses when filters/search change rapidly
  // or when concurrent indexing/rebuild operations trigger parallel fetches
  const facetGuard = useAsyncGuard();
  const statsGuard = useAsyncGuard();
  const filterOptionsGuard = useAsyncGuard();

  function parseDateInputToUnix(value: string | null, label: "From" | "To"): number | undefined {
    if (value == null) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const timestampMs = new Date(trimmed).getTime();
    if (!Number.isFinite(timestampMs)) {
      throw new Error(`Invalid date filter: ${label} date is not a valid date.`);
    }

    return Math.floor(timestampMs / 1000);
  }

  function parseDateRange(): ParsedDateRange {
    try {
      const dateFromUnix = parseDateInputToUnix(dateFrom.value, "From");
      const dateToUnix = parseDateInputToUnix(dateTo.value, "To");

      if (dateFromUnix != null && dateToUnix != null && dateFromUnix > dateToUnix) {
        return { error: "Invalid date filter: From date must be before or equal to To date." };
      }

      return { dateFromUnix, dateToUnix };
    } catch (e) {
      return { error: toErrorMessage(e) };
    }
  }

  async function fetchFacets(forQuery?: string, overrides?: FacetOverrides) {
    const token = facetGuard.start();
    try {
      const { dateFromUnix, dateToUnix, error: dateError } = parseDateRange();
      if (dateError) {
        if (!facetGuard.isValid(token)) return;
        facets.value = null;
        logWarn("[search] Skipping search facets fetch due to invalid date filter:", dateError);
        return;
      }

      const ct = overrides?.contentTypes ?? contentTypes.value;
      const repo = overrides?.repo ?? repository.value;
      const tool = overrides?.tool ?? toolName.value;
      const session = overrides?.session !== undefined ? overrides.session : sessionId.value;

      const result = await getSearchFacets(forQuery, {
        contentTypes: ct.length > 0 ? ct : undefined,
        excludeContentTypes:
          excludeContentTypes.value.length > 0 ? excludeContentTypes.value : undefined,
        repositories: repo ? [repo] : undefined,
        toolNames: tool ? [tool] : undefined,
        sessionId: session ?? undefined,
        dateFromUnix,
        dateToUnix,
      });
      if (!facetGuard.isValid(token)) return;
      facets.value = result;
    } catch (e) {
      if (!facetGuard.isValid(token)) return;
      logWarn("[search] Failed to fetch search facets:", e);
    }
  }

  async function fetchStats() {
    const token = statsGuard.start();
    statsLoading.value = true;
    try {
      const result = await getSearchStats();
      if (!statsGuard.isValid(token)) return;
      stats.value = result;
    } catch (e) {
      if (!statsGuard.isValid(token)) return;
      logWarn("[search] Failed to fetch search stats:", e);
    } finally {
      if (statsGuard.isValid(token)) statsLoading.value = false;
    }
  }

  async function fetchFilterOptions() {
    const token = filterOptionsGuard.start();
    try {
      const [repos, tools] = await Promise.all([getSearchRepositories(), getSearchToolNames()]);
      if (!filterOptionsGuard.isValid(token)) return;
      availableRepositories.value = repos;
      availableToolNames.value = tools;
    } catch (e) {
      if (!filterOptionsGuard.isValid(token)) return;
      // Non-fatal - filter options are supplementary UI info
      logWarn("[search] Failed to fetch filter options", e);
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

  // ── FTS Maintenance ─────────────────────────────────────────
  async function fetchHealth() {
    healthLoading.value = true;
    try {
      healthInfo.value = await ftsHealth();
    } catch (_e) {
      healthInfo.value = null;
    } finally {
      healthLoading.value = false;
    }
  }

  async function runIntegrityCheck() {
    maintenanceMessage.value = null;
    try {
      maintenanceMessage.value = await ftsIntegrityCheck();
    } catch (e) {
      maintenanceMessage.value = `Error: ${toErrorMessage(e)}`;
    }
  }

  async function runOptimize() {
    maintenanceMessage.value = null;
    try {
      maintenanceMessage.value = await ftsOptimize();
      await fetchHealth(); // refresh health after optimize
    } catch (e) {
      maintenanceMessage.value = `Error: ${toErrorMessage(e)}`;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────
  function clearFilters() {
    contentTypes.value = [];
    excludeContentTypes.value = [];
    repository.value = null;
    toolName.value = null;
    dateFrom.value = null;
    dateTo.value = null;
    sessionId.value = null;
    sortBy.value = "relevance";
    page.value = 1;
  }

  function clearAll() {
    // Suppress watchers during multi-ref reset
    hydrating = true;
    query.value = "";
    clearFilters();
    results.value = [];
    totalCount.value = 0;
    hasMore.value = false;
    latencyMs.value = 0;
    error.value = null;
    nextTick(() => {
      hydrating = false;
    });
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
    excludeContentTypes,
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
    resultViewMode,
    groupedResults,
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
    // Recent searches
    recentSearches,
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
    applyBrowsePreset,
    applyRecentSearch,
    removeRecentSearch,
    clearRecentSearches,
    copyResultsToClipboard,
    copySingleResult,
    // FTS maintenance
    healthInfo,
    healthLoading,
    maintenanceMessage,
    fetchHealth,
    runIntegrityCheck,
    runOptimize,
    // Hydration control (for URL sync)
    beginHydration: () => {
      hydrating = true;
    },
    endHydration: () => {
      hydrating = false;
    },
    // View lifecycle control (prevent background ops when view unmounted)
    setViewMounted: (mounted: boolean) => {
      isViewMounted = mounted;
    },
    // Load stats/facets without executing a search (for browse presets view)
    async fetchStatsOnly() {
      await Promise.all([fetchStats(), fetchFacets(), fetchFilterOptions()]);
    },
  };
});
