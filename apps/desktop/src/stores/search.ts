import type { SearchContentType, SearchResult } from "@tracepilot/types";
import { useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { nextTick, watch } from "vue";
import { useSearchClipboard } from "@/composables/useSearchClipboard";
import { createSearchExecutor } from "./search/executor";
import { createFacetsSlice } from "./search/facets";
import { createSearchHistory } from "./search/history";
import { createIndexingSlice } from "./search/indexing";
import { createMaintenanceSlice } from "./search/maintenance";
import { createQuerySlice } from "./search/query";
import { createSearchScheduler } from "./search/scheduler";

// Re-export types and utilities that consumers may depend on
export type { RecentSearch } from "@/composables/useRecentSearches";
export type { ParsedQualifiers } from "@/utils/parseQualifiers";
export { parseQualifiers } from "@/utils/parseQualifiers";
export type { FacetOverrides } from "./search/facets";
export type { SessionGroup } from "./search/query";

/** Content-type presets for the browse-mode quick filters. */
export const BROWSE_PRESETS = {
  errors: ["error", "tool_error"],
  userMessages: ["user_message"],
  toolCalls: ["tool_call"],
  reasoning: ["reasoning"],
  toolResults: ["tool_result"],
  subagents: ["subagent"],
} as const satisfies Record<string, readonly SearchContentType[]>;

const DEBOUNCE_MS = 150;

export const useSearchStore = defineStore("search", () => {
  const q = createQuerySlice();
  const f = createFacetsSlice(q);
  const m = createMaintenanceSlice();

  // Suppresses watcher-triggered searches while URL hydration is in progress.
  let isHydrating = false;
  // Tracks if the search view is currently mounted (prevents background ops
  // from firing API requests when the user has navigated away).
  let isViewMounted = false;
  // One-shot flag set when scheduleSearch resets page → 1 itself, so the
  // page watcher doesn't double-fire the search it already requested.
  let isPageWatcherSuppressed = false;

  const history = createSearchHistory();
  const { copyResultsToClipboard: clipboardCopyResults, copySingleResult: clipboardCopySingle } =
    useSearchClipboard();

  const searchGuard = useAsyncGuard();

  const { executeSearch } = createSearchExecutor({
    query: q,
    facets: f,
    guard: searchGuard,
    recordRecentSearch: history.addRecentSearch,
  });

  const scheduler = createSearchScheduler({
    delay: DEBOUNCE_MS,
    run: executeSearch,
    immediate: (cb) => {
      void nextTick(cb);
    },
  });

  /**
   * Schedule a search. All state changes funnel through here.
   * - resetPage: reset to page 1 (true for query/filter changes, false for page changes)
   * - debounce: add delay (true for typing, false for filter clicks)
   */
  function scheduleSearch(resetPage: boolean, debounce = false) {
    if (isHydrating) return;
    if (resetPage && q.page.value !== 1) {
      isPageWatcherSuppressed = true;
      q.page.value = 1;
    }
    scheduler.schedule(debounce);
  }

  const indexing = createIndexingSlice({
    query: q,
    facets: f,
    maintenance: m,
    scheduleSearch,
    executeSearch,
    getViewMounted: () => isViewMounted,
  });

  // Initialize listeners eagerly when the store is first created
  indexing.initEventListeners();

  // Query changes → debounced search (resets page)
  watch(q.query, () => scheduleSearch(true, true));

  // Filter changes → immediate search (resets page)
  watch(
    [
      q.contentTypes,
      q.excludeContentTypes,
      q.repository,
      q.toolName,
      q.dateFrom,
      q.dateTo,
      q.sessionId,
      q.sortBy,
    ],
    () => scheduleSearch(true),
    { deep: true },
  );

  // Page changes → immediate search (no page reset)
  watch(q.page, () => {
    if (isPageWatcherSuppressed) {
      isPageWatcherSuppressed = false;
      return;
    }
    scheduleSearch(false);
  });

  /**
   * Apply a browse preset, clearing all filters and setting content types.
   * Resets query, pagination, and all filter fields, then triggers a search.
   */
  function applyBrowsePreset(types: readonly SearchContentType[]) {
    isHydrating = true;
    q.page.value = 1;
    q.query.value = "";
    q.contentTypes.value = [...types];
    q.excludeContentTypes.value = [];
    q.repository.value = null;
    q.toolName.value = null;
    q.dateFrom.value = null;
    q.dateTo.value = null;
    q.sessionId.value = null;
    q.sortBy.value = "newest";
    nextTick(() => {
      isHydrating = false;
      scheduleSearch(false);
    });
  }

  function applyRecentSearch(s: string) {
    q.query.value = s;
  }

  async function copyResultsToClipboard(resultsToCopy?: SearchResult[]): Promise<boolean> {
    return clipboardCopyResults(resultsToCopy ?? q.results.value);
  }

  async function copySingleResult(result: SearchResult): Promise<boolean> {
    return clipboardCopySingle(result);
  }

  function clearAll() {
    // Suppress watchers during multi-ref reset
    isHydrating = true;
    q.query.value = "";
    q.clearFilters();
    q.clearSearchResults();
    q.error.value = null;
    nextTick(() => {
      isHydrating = false;
    });
  }

  // Strip internal-only helpers before exposing query slice keys publicly.
  const { parseDateRange: _pdr, clearSearchResults: _csr, ...qPublic } = q;
  void _pdr;
  void _csr;

  return {
    ...qPublic,
    ...f,
    ...m,
    ...indexing,
    recentSearches: history.recentSearches,
    removeRecentSearch: history.removeRecentSearch,
    clearRecentSearches: history.clearRecentSearches,
    executeSearch,
    applyBrowsePreset,
    applyRecentSearch,
    copyResultsToClipboard,
    copySingleResult,
    clearAll,
    // Hydration control (for URL sync)
    beginHydration: () => {
      isHydrating = true;
    },
    endHydration: () => {
      isHydrating = false;
    },
    // View lifecycle control (prevent background ops when view unmounted)
    setViewMounted: (mounted: boolean) => {
      isViewMounted = mounted;
    },
    // Load stats/facets without executing a search (for browse presets view)
    async fetchStatsOnly() {
      await Promise.all([f.fetchStats(), f.fetchFacets(), f.fetchFilterOptions()]);
    },
  };
});
