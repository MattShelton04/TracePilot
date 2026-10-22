import type { SearchContentType, SearchResult, SessionSource } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { computed, ref, shallowRef } from "vue";
import { hasMeaningfulDateValue } from "@/utils/dateValidation";
import { parseQualifiers, stripQualifier, stripTypeQualifier } from "@/utils/parseQualifiers";
import { groupResultsBySession } from "./grouping";
import { describeSearchText } from "./queryTerms";

export type { SessionGroup } from "./grouping";

export type { MergedSearchInputs, MergeSearchInputsState, SortMode } from "./merge";
export { effectiveSortMode, mergeSearchInputs } from "./merge";

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
  /** One session source, or `null` for every source. */
  const source = ref<SessionSource | null>(null);
  const sortBy = ref<"relevance" | "newest" | "oldest">("relevance");
  const page = ref(1);
  const pageSize = ref(50);

  // ── Results state ────────────────────────────────────────────
  // shallowRef: results are always replaced wholesale after every search.
  const results = shallowRef<SearchResult[]>([]);
  const totalCount = ref(0);
  const hasMore = ref(false);
  const latencyMs = ref(0);
  /** Distinct sessions on every page, from this search's facets; null until known. */
  const facetSessionCount = ref<number | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const resultViewMode = ref<"flat" | "grouped">("flat");

  // ── Computed ─────────────────────────────────────────────────
  const hasResults = computed(() => results.value.length > 0);
  const hasQuery = computed(() => query.value.trim().length > 0);
  const totalPages = computed(() => Math.ceil(totalCount.value / pageSize.value));
  /** The typed text without its qualifiers, and what it will search for. */
  const searchTextTerms = computed(() => {
    const text = parseQualifiers(query.value).cleanQuery.trim();
    return { text, ...describeSearchText(text) };
  });
  /**
   * No text to rank by: nothing typed, or only qualifiers (`type:error`). Results
   * list newest first, as when browsing.
   */
  const isBrowseMode = computed(() => searchTextTerms.value.text === "");
  /** Text was typed, but nothing in it is searchable (`*`, `!!!`, a bare `NOT`). */
  const hasNoSearchableTerms = computed(
    () => searchTextTerms.value.text !== "" && !searchTextTerms.value.hasTerms,
  );
  /** The text opens with `NOT`, which needs a term before it. */
  const startsWithNot = computed(() => searchTextTerms.value.startsWithNot);
  /** `type:` values that name no content type, so they filter nothing. */
  const unknownTypes = computed(() => parseQualifiers(query.value).unknownTypes);
  /** Content types the query's `type:` qualifiers include, on top of the filters'. */
  const queryContentTypes = computed(() => parseQualifiers(query.value).types);
  /** The source searched: the query's `source:` qualifier, else the switch's. */
  const effectiveSource = computed(() => parseQualifiers(query.value).source ?? source.value);
  const hasActiveFilters = computed(() => {
    return (
      contentTypes.value.length > 0 ||
      excludeContentTypes.value.length > 0 ||
      repository.value !== null ||
      toolName.value !== null ||
      hasMeaningfulDateValue(dateFrom.value) ||
      hasMeaningfulDateValue(dateTo.value) ||
      sessionId.value !== null ||
      source.value !== null
    );
  });

  // Session-grouped view: group flat results by sessionId
  const groupedResults = computed(() => groupResultsBySession(results.value));

  /** Sessions behind every page; this page's groups only when it holds every result. */
  const resultSessionCount = computed(() => {
    if (facetSessionCount.value !== null) return facetSessionCount.value;
    return page.value === 1 && !hasMore.value ? groupedResults.value.length : null;
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
    facetSessionCount.value = null;
  }

  function clearFilters() {
    contentTypes.value = [];
    excludeContentTypes.value = [];
    repository.value = null;
    toolName.value = null;
    dateFrom.value = null;
    dateTo.value = null;
    sessionId.value = null;
    source.value = null;
    sortBy.value = "relevance";
    page.value = 1;
  }

  /**
   * Pick a source in the switch; a typed `source:` qualifier gives way to it.
   * The query changes first so the filter change's immediate search replaces
   * the query's debounced one: one search, not two.
   */
  function setSource(next: SessionSource | null) {
    if (parseQualifiers(query.value).source !== null) {
      query.value = stripQualifier(query.value, "source");
    }
    source.value = next;
  }

  /** Drop the query's `type:` qualifiers for these types, so a filter change can replace them. */
  function removeQueryContentTypes(types: readonly SearchContentType[]) {
    let next = query.value;
    for (const type of types) next = stripTypeQualifier(next, type);
    if (next !== query.value) query.value = next;
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
    source,
    sortBy,
    page,
    pageSize,
    // Results state refs
    results,
    totalCount,
    hasMore,
    latencyMs,
    facetSessionCount,
    loading,
    error,
    resultViewMode,
    // Computed
    hasResults,
    hasQuery,
    isBrowseMode,
    totalPages,
    hasActiveFilters,
    hasNoSearchableTerms,
    startsWithNot,
    unknownTypes,
    queryContentTypes,
    effectiveSource,
    groupedResults,
    resultSessionCount,
    // Helpers
    parseDateRange,
    clearSearchResults,
    clearFilters,
    clearError,
    setSource,
    removeQueryContentTypes,
    setDateRange,
    setPage,
    nextPage,
    prevPage,
  };
}

export type QuerySlice = ReturnType<typeof createQuerySlice>;
