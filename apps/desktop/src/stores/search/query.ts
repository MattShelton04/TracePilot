import type { SearchContentType, SearchResult } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { computed, ref, shallowRef } from "vue";
import { hasMeaningfulDateValue } from "@/utils/dateValidation";

export interface SessionGroup {
  sessionId: string;
  sessionSummary: string | null;
  sessionRepository: string | null;
  sessionBranch: string | null;
  results: SearchResult[];
}

export interface ParsedDateRange {
  dateFromUnix?: number;
  dateToUnix?: number;
  error?: string;
}

/**
 * Query + filters + results state slice.
 *
 * Owns all refs/computed that describe the current query, active filters,
 * and the materialised result set. Async fetching lives in the facets /
 * indexing / maintenance slices; this slice is pure state + helpers.
 */
export function createQuerySlice() {
  // ── Query state ──────────────────────────────────────────────
  const query = ref("");
  // shallowRef: filter arrays replaced wholesale via clearFilters / setters.
  const contentTypes = shallowRef<SearchContentType[]>([]);
  const excludeContentTypes = shallowRef<SearchContentType[]>([]);
  const repository = ref<string | null>(null);
  const toolName = ref<string | null>(null);
  const dateFrom = ref<string | null>(null);
  const dateTo = ref<string | null>(null);
  const sessionId = ref<string | null>(null);
  const sortBy = ref<"relevance" | "newest" | "oldest">("relevance");
  const page = ref(1);
  const pageSize = ref(50);

  // ── Results state ────────────────────────────────────────────
  // shallowRef: results are always replaced wholesale after every search.
  const results = shallowRef<SearchResult[]>([]);
  const totalCount = ref(0);
  const hasMore = ref(false);
  const latencyMs = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const resultViewMode = ref<"flat" | "grouped">("flat");

  // ── Computed ─────────────────────────────────────────────────
  const hasResults = computed(() => results.value.length > 0);
  const hasQuery = computed(() => query.value.trim().length > 0);
  const isBrowseMode = computed(() => !hasQuery.value);
  const totalPages = computed(() => Math.ceil(totalCount.value / pageSize.value));
  const hasActiveFilters = computed(() => {
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

  // ── Helpers ──────────────────────────────────────────────────
  function parseDateInputToUnix(
    value: string | null,
    fieldName: "From" | "To",
  ): number | undefined {
    if (value == null) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const timestampMs = new Date(trimmed).getTime();
    if (!Number.isFinite(timestampMs)) {
      throw new Error(`Invalid date filter: ${fieldName} date is not a valid date.`);
    }

    return Math.floor(timestampMs / 1000);
  }

  function parseDateRange(): ParsedDateRange {
    try {
      const dateFromUnix = parseDateInputToUnix(dateFrom.value, "From");
      const dateToUnix = parseDateInputToUnix(dateTo.value, "To");

      if (dateFromUnix != null && dateToUnix != null && dateFromUnix > dateToUnix) {
        return { error: "Invalid date filter: From date cannot be after To date." };
      }

      return { dateFromUnix, dateToUnix };
    } catch (e) {
      return { error: toErrorMessage(e) };
    }
  }

  function clearSearchResults() {
    results.value = [];
    totalCount.value = 0;
    hasMore.value = false;
    latencyMs.value = 0;
  }

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

  function clearError() {
    error.value = null;
  }

  function setDateRange(from: string | null, to: string | null) {
    dateFrom.value = from;
    dateTo.value = to;
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
    // Query state refs
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
    // Results state refs
    results,
    totalCount,
    hasMore,
    latencyMs,
    loading,
    error,
    resultViewMode,
    // Computed
    hasResults,
    hasQuery,
    isBrowseMode,
    totalPages,
    hasActiveFilters,
    groupedResults,
    // Helpers
    parseDateRange,
    clearSearchResults,
    clearFilters,
    clearError,
    setDateRange,
    setPage,
    nextPage,
    prevPage,
  };
}

export type QuerySlice = ReturnType<typeof createQuerySlice>;
