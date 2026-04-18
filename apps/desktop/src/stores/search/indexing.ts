import type { UnlistenFn } from "@tauri-apps/api/event";
import { rebuildSearchIndex } from "@tracepilot/client";
import type { SearchIndexingProgress } from "@tracepilot/types";
import { IPC_EVENTS } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { getCurrentScope, onScopeDispose, ref } from "vue";
import { logWarn } from "@/utils/logger";
import { safeListen } from "@/utils/tauriEvents";
import type { FacetsSlice } from "./facets";
import type { MaintenanceSlice } from "./maintenance";
import type { QuerySlice } from "./query";

export interface IndexingSliceDeps {
  query: QuerySlice;
  facets: FacetsSlice;
  maintenance: MaintenanceSlice;
  /** Re-runs the current search (no page reset). */
  scheduleSearch: (resetPage: boolean, debounce?: boolean) => void;
  /** Awaitable single-shot execution (used by rebuild). */
  executeSearch: () => Promise<void>;
  /** Lazy view-mounted flag (read at event-dispatch time). */
  getViewMounted: () => boolean;
}

/**
 * Indexing slice — rebuild state, indexing progress, and IPC event wiring.
 *
 * Pinia setup stores run inside an effect scope owned by the Pinia instance,
 * so `onScopeDispose` fires on `pinia.dispose()` / unmount — releasing IPC
 * listeners so HMR + window teardown don't leak (Phase 1A.7).
 */
export function createIndexingSlice(deps: IndexingSliceDeps) {
  const rebuilding = ref(false);
  const searchIndexing = ref(false);
  const searchIndexingProgress = ref<SearchIndexingProgress | null>(null);

  let listenersInitialized = false;
  const unlisteners: UnlistenFn[] = [];

  function disposeListeners() {
    while (unlisteners.length > 0) {
      const u = unlisteners.pop();
      try {
        u?.();
      } catch {
        /* best-effort */
      }
    }
    listenersInitialized = false;
  }

  if (getCurrentScope()) {
    onScopeDispose(disposeListeners);
  } else {
    logWarn(
      "[search] store created outside an effect scope; IPC listeners will NOT be released on teardown",
    );
  }

  async function initEventListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    try {
      unlisteners.push(
        await safeListen(IPC_EVENTS.SEARCH_INDEXING_STARTED, () => {
          searchIndexing.value = true;
          searchIndexingProgress.value = null;
        }),
        await safeListen<SearchIndexingProgress>(IPC_EVENTS.SEARCH_INDEXING_PROGRESS, (event) => {
          searchIndexingProgress.value = event.payload;
        }),
        await safeListen(IPC_EVENTS.SEARCH_INDEXING_FINISHED, () => {
          searchIndexing.value = false;
          searchIndexingProgress.value = null;
          // Always invalidate — free variable reset, ensures next mount fetches fresh facets
          // even if the user is not on the search page when indexing finishes.
          deps.facets.invalidateFacetsCache();
          // Only perform API calls if the search view is currently mounted.
          if (!deps.getViewMounted()) return;

          deps.facets.fetchStats();
          deps.facets.fetchFilterOptions();
          deps.maintenance.fetchHealth(true);
          // Re-run current search if results are showing
          if (
            deps.query.hasQuery.value ||
            deps.query.hasActiveFilters.value ||
            deps.query.hasResults.value
          ) {
            deps.scheduleSearch(false);
          } else {
            deps.facets.fetchFacets();
          }
        }),
      );
    } catch (e) {
      // Not in Tauri environment - event listeners not available
      logWarn("[search] Failed to initialize event listeners (not in Tauri environment)", e);
    }
  }

  async function rebuild() {
    if (rebuilding.value || searchIndexing.value) return;
    rebuilding.value = true;
    deps.query.error.value = null;
    try {
      await rebuildSearchIndex();
      // Invalidate facets cache so rebuild always fetches fresh counts
      deps.facets.invalidateFacetsCache();
      await Promise.all([
        deps.facets.fetchStats(),
        deps.facets.fetchFacets(),
        deps.facets.fetchFilterOptions(),
      ]);
      if (
        deps.query.hasQuery.value ||
        deps.query.hasActiveFilters.value ||
        deps.query.hasResults.value
      ) {
        await deps.executeSearch();
      }
    } catch (e) {
      deps.query.error.value = toErrorMessage(e);
    } finally {
      rebuilding.value = false;
    }
  }

  return {
    rebuilding,
    searchIndexing,
    searchIndexingProgress,
    initEventListeners,
    rebuild,
  };
}

export type IndexingSlice = ReturnType<typeof createIndexingSlice>;
