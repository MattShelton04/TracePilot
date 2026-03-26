import { watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSearchStore } from '@/stores/search';
import type { SearchContentType } from '@tracepilot/types';

/**
 * Syncs search store state ↔ URL query params.
 * - On mount: reads URL query → applies to store (enables shareable links / back button).
 * - On route change: reads URL query → applies to store (back/forward navigation).
 * - On store change: writes store → URL query (debounced to avoid router spam).
 */
export function useSearchUrlSync() {
  const route = useRoute();
  const router = useRouter();
  const store = useSearchStore();

  let syncingFromUrl = false;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  const WRITE_DEBOUNCE_MS = 300;

  /** Read URL query params into store state. Missing params reset to defaults. */
  function readUrlIntoStore() {
    const q = route.query;
    syncingFromUrl = true;
    store.beginHydration();

    store.query = typeof q.q === 'string' ? q.q : '';
    if (typeof q.sort === 'string' && ['relevance', 'newest', 'oldest'].includes(q.sort)) {
      store.sortBy = q.sort as 'relevance' | 'newest' | 'oldest';
    } else {
      store.sortBy = 'relevance';
    }
    if (typeof q.page === 'string') {
      const p = parseInt(q.page, 10);
      store.page = (!isNaN(p) && p > 0) ? p : 1;
    } else {
      store.page = 1;
    }
    if (typeof q.view === 'string' && ['flat', 'grouped'].includes(q.view)) {
      store.resultViewMode = q.view as 'flat' | 'grouped';
    } else {
      store.resultViewMode = 'flat';
    }
    store.contentTypes = (typeof q.types === 'string' && q.types.length > 0)
      ? q.types.split(',') as SearchContentType[]
      : [];
    store.excludeContentTypes = (typeof q.exclude === 'string' && q.exclude.length > 0)
      ? q.exclude.split(',') as SearchContentType[]
      : [];
    store.repository = (typeof q.repo === 'string' && q.repo) ? q.repo : null;
    store.toolName = (typeof q.tool === 'string' && q.tool) ? q.tool : null;
    store.sessionId = (typeof q.session === 'string' && q.session) ? q.session : null;
    store.dateFrom = (typeof q.from === 'string' && q.from) ? q.from : null;
    store.dateTo = (typeof q.to === 'string' && q.to) ? q.to : null;

    // End hydration after Vue flushes watchers, then trigger a search
    // only if there's an actual query or active filters (otherwise show browse presets)
    setTimeout(() => {
      syncingFromUrl = false;
      store.endHydration();
      if (store.hasQuery || store.hasActiveFilters) {
        store.executeSearch();
      } else {
        // Fetch stats/facets so the browse view can show counts
        store.fetchStatsOnly();
      }
    }, 0);
  }

  /** Write current store state to URL query params. */
  function writeStoreToUrl() {
    if (syncingFromUrl) return;
    // Guard: only write if we're still on the search route
    if (!route.path.includes('search')) return;

    const query: Record<string, string> = {};
    if (store.query) query.q = store.query;
    if (store.sortBy !== 'relevance') query.sort = store.sortBy;
    if (store.page > 1) query.page = String(store.page);
    if (store.resultViewMode !== 'flat') query.view = store.resultViewMode;
    if (store.contentTypes.length > 0) query.types = store.contentTypes.join(',');
    if (store.excludeContentTypes.length > 0) query.exclude = store.excludeContentTypes.join(',');
    if (store.repository) query.repo = store.repository;
    if (store.toolName) query.tool = store.toolName;
    if (store.sessionId) query.session = store.sessionId;
    if (store.dateFrom) query.from = store.dateFrom;
    if (store.dateTo) query.to = store.dateTo;

    // Only update if query actually changed
    const current = { ...route.query } as Record<string, string>;
    const same = Object.keys(query).length === Object.keys(current).length
      && Object.entries(query).every(([k, v]) => current[k] === v);
    if (same) return;

    router.replace({ query });
  }

  /** Debounced write to URL. */
  function scheduleUrlWrite() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(writeStoreToUrl, WRITE_DEBOUNCE_MS);
  }

  // Watch all search-relevant state and sync to URL
  watch(
    () => [
      store.query, store.sortBy, store.page, store.resultViewMode,
      store.contentTypes, store.excludeContentTypes,
      store.repository, store.toolName, store.sessionId,
      store.dateFrom, store.dateTo,
    ],
    scheduleUrlWrite,
    { deep: true },
  );

  // Watch route.query for back/forward browser navigation
  watch(
    () => route.query,
    () => {
      if (!syncingFromUrl) {
        readUrlIntoStore();
      }
    },
  );

  // On mount: always read URL into store so that empty URL resets stale state
  onMounted(() => {
    readUrlIntoStore();
  });

  // Clean up pending timer on unmount to avoid polluting other routes
  onBeforeUnmount(() => {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
  });
}
