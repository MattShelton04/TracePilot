import { searchContent } from "@tracepilot/client";
import type { SearchContentType, SearchResult } from "@tracepilot/types";
import { toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { nextTick, watch } from "vue";
import { useRecentSearches } from "@/composables/useRecentSearches";
import { useSearchClipboard } from "@/composables/useSearchClipboard";
import { parseQualifiers } from "@/utils/parseQualifiers";
import { createFacetsSlice } from "./search/facets";
import { createIndexingSlice } from "./search/indexing";
import { createMaintenanceSlice } from "./search/maintenance";
import { createQuerySlice } from "./search/query";

// Re-export types and utilities that consumers may depend on
export type { RecentSearch } from "@/composables/useRecentSearches";
export type { ParsedQualifiers } from "@/utils/parseQualifiers";
export { parseQualifiers } from "@/utils/parseQualifiers";
export type { SessionGroup } from "./search/query";
export type { FacetOverrides } from "./search/facets";

/** Content-type presets for the browse-mode quick filters. */
export const BROWSE_PRESETS = {
  errors: ["error", "tool_error"],
  userMessages: ["user_message"],
  toolCalls: ["tool_call"],
  reasoning: ["reasoning"],
  toolResults: ["tool_result"],
  subagents: ["subagent"],
} as const satisfies Record<string, readonly SearchContentType[]>;

export const useSearchStore = defineStore("search", () => {
  const q = createQuerySlice();
  const f = createFacetsSlice(q);
  const m = createMaintenanceSlice();

  // When true, watcher-triggered searches are suppressed (URL hydration in progress)
  let hydrating = false;
  // Track if the search view is currently mounted (prevent background ops when navigated away)
  let isViewMounted = false;

  const { recentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches } =
    useRecentSearches();
  const { copyResultsToClipboard: clipboardCopyResults, copySingleResult: clipboardCopySingle } =
    useSearchClipboard();

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
    if (resetPage && q.page.value !== 1) {
      suppressPageWatcher = true;
      q.page.value = 1;
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
      q.isBrowseMode.value && q.sortBy.value === "relevance" ? "newest" : q.sortBy.value;

    // Parse inline qualifiers (e.g. "type:error repo:myapp fix bug")
    const parsed = parseQualifiers(q.query.value);
    // Always use parsed.cleanQuery — empty string means "no text, filter only"
    const searchQuery = parsed.cleanQuery;

    // Merge qualifier-derived filters with explicit UI filters
    const mergedContentTypes =
      parsed.types.length > 0
        ? [...new Set([...q.contentTypes.value, ...parsed.types])]
        : q.contentTypes.value;
    const mergedRepo = parsed.repo ?? q.repository.value;
    const mergedTool = parsed.tool ?? q.toolName.value;
    const mergedSession = parsed.session ?? q.sessionId.value;
    const mergedSort = parsed.sort ?? effectiveSort;

    const token = searchGuard.start();
    q.loading.value = true;
    q.error.value = null;

    try {
      const { dateFromUnix, dateToUnix, error: dateError } = q.parseDateRange();
      if (dateError) {
        q.error.value = dateError;
        q.clearSearchResults();
        f.facets.value = null;
        return;
      }

      const response = await searchContent(searchQuery, {
        contentTypes: mergedContentTypes.length > 0 ? mergedContentTypes : undefined,
        excludeContentTypes:
          q.excludeContentTypes.value.length > 0 ? q.excludeContentTypes.value : undefined,
        repositories: mergedRepo ? [mergedRepo] : undefined,
        toolNames: mergedTool ? [mergedTool] : undefined,
        sessionId: mergedSession ?? undefined,
        dateFromUnix,
        dateToUnix,
        limit: q.pageSize.value,
        offset: (q.page.value - 1) * q.pageSize.value,
        sortBy: mergedSort !== "relevance" ? mergedSort : undefined,
      });

      if (!searchGuard.isValid(token)) return;

      q.results.value = response.results;
      q.totalCount.value = response.totalCount;
      q.hasMore.value = response.hasMore;
      q.latencyMs.value = response.latencyMs;

      // Record to recent searches (only for text queries, not browse mode)
      if (q.query.value.trim().length > 0 && response.totalCount > 0) {
        addRecentSearch(q.query.value.trim(), response.totalCount);
      }

      // Fetch facets using the same parsed query and merged filters as the search.
      // Use searchQuery directly (empty string = browse mode); don't fall back to raw
      // query.value which may contain qualifier syntax like "type:error".
      const facetQuery = searchQuery || undefined;
      f.fetchFacets(facetQuery, {
        contentTypes: mergedContentTypes,
        repo: mergedRepo,
        tool: mergedTool,
        session: mergedSession,
      });
    } catch (e) {
      if (!searchGuard.isValid(token)) return;
      q.error.value = toErrorMessage(e);
      q.clearSearchResults();
    } finally {
      if (searchGuard.isValid(token)) q.loading.value = false;
    }
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
    if (suppressPageWatcher) {
      suppressPageWatcher = false;
      return;
    }
    scheduleSearch(false);
  });

  /**
   * Apply a browse preset, clearing all filters and setting content types.
   * Resets query, pagination, and all filter fields, then triggers a search.
   */
  function applyBrowsePreset(types: readonly SearchContentType[]) {
    hydrating = true;
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
      hydrating = false;
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
    hydrating = true;
    q.query.value = "";
    q.clearFilters();
    q.clearSearchResults();
    q.error.value = null;
    nextTick(() => {
      hydrating = false;
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
    recentSearches,
    removeRecentSearch,
    clearRecentSearches,
    executeSearch,
    applyBrowsePreset,
    applyRecentSearch,
    copyResultsToClipboard,
    copySingleResult,
    clearAll,
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
      await Promise.all([f.fetchStats(), f.fetchFacets(), f.fetchFilterOptions()]);
    },
  };
});
