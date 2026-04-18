import type { IndexingProgressPayload, SearchContentType, SearchResult } from "@tracepilot/types";
import { CONTENT_TYPE_CONFIG, usePolling, useToast } from "@tracepilot/ui";
import type { Ref } from "vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useIndexingEvents } from "@/composables/useIndexingEvents";
import { useSearchKeyboardNavigation } from "@/composables/useSearchKeyboardNavigation";
import { useSearchPagination } from "@/composables/useSearchPagination";
import { useSearchResultState } from "@/composables/useSearchResultState";
import { useSearchUrlSync } from "@/composables/useSearchUrlSync";
import { useSearchStore } from "@/stores/search";
import { toFriendlyErrorMessage } from "@/utils/backendErrors";
import { hasMeaningfulDateValue } from "@/utils/dateValidation";

export interface UseSessionSearchOptions {
  /** Ref to the search input element (supplied by the parent view via a child component). */
  searchInputRef: Ref<HTMLInputElement | null>;
}

export function useSessionSearch(options: UseSessionSearchOptions) {
  const store = useSearchStore();
  const { searchInputRef } = options;

  // Sync search state ↔ URL query params
  useSearchUrlSync();

  // ── Main indexing progress (local to this view) ──────────────
  const indexingProgress = ref<IndexingProgressPayload | null>(null);
  const isIndexing = ref(false);
  const healthPolling = usePolling(() => store.fetchHealth(), {
    intervalMs: 5_000,
    immediate: false,
    pauseWhenHidden: true,
    swallowErrors: true,
  });

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

  const friendlyError = computed(() => toFriendlyErrorMessage(store.error));

  // ── Stats facets (always visible, from search stats) ──────────
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

  // ── Clear all filters ─────────────────────────────────────────
  function handleClearFilters() {
    store.clearFilters();
    activeDatePreset.value = "all";
    filteredSessionNameOverride.value = null;
  }

  // ── Session link path ─────────────────────────────────────────
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
    healthPolling.start();

    // Main indexing events (local — only for showing main index progress)
    await setupIndexingEvents();
    // Search indexing events are handled globally in the search store
  });

  onUnmounted(() => {
    // Notify store that search view is unmounted (disables background operations)
    store.setViewMounted(false);
    healthPolling.stop();
  });

  return {
    store,
    // indexing
    indexingProgress,
    isIndexing,
    // result state
    expandedResults,
    toggleExpand,
    collapsedGroups,
    toggleGroupCollapse,
    filteredSessionNameOverride,
    sessionDisplayName,
    filterBySession,
    // keyboard
    focusedResultIndex,
    resultIndexMap,
    // pagination
    pageStart,
    pageEnd,
    visiblePages,
    // UI state
    filtersOpen,
    activeDatePreset,
    showSyntaxHelp,
    // copy
    handleCopyResult,
    handleCopyAllResults,
    // content type
    contentTypeConfig,
    activeFilterCount,
    activeContentTypeChips,
    removeContentTypeFilter,
    // misc
    friendlyError,
    statsContentTypeFacets,
    handleClearFilters,
    sessionLink,
  };
}
