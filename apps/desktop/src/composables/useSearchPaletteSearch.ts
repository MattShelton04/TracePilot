import { searchContent } from "@tracepilot/client";
import type {
  SearchContentType,
  SearchResult,
  SearchResultsResponse,
  SessionSource,
} from "@tracepilot/types";
import { CONTENT_TYPE_CONFIG, getDesignToken, toErrorMessage } from "@tracepilot/ui";
import { computed, onScopeDispose, ref, watch } from "vue";
import { parseQualifiers } from "@/utils/parseQualifiers";

export interface ResultGroup {
  contentType: SearchContentType;
  label: string;
  color: string;
  results: SearchResult[];
}

/**
 * Search-palette query / debounce / results state.
 *
 * Kept standalone so the palette shell component stays focused on presentation
 * + keyboard handling. Caller is expected to clear state via `reset()` when
 * the palette closes.
 */
export function useSearchPaletteSearch(
  options: {
    debounceMs?: number;
    limit?: number;
    /** The Search page's source filter, used when the query names none. */
    defaultSource?: () => SessionSource | null;
  } = {},
) {
  const debounceMs = options.debounceMs ?? 150;
  const limit = options.limit ?? 20;

  const query = ref("");
  /** The source searched: the query's `source:` qualifier, else the default. */
  const source = computed<SessionSource | null>(
    () => parseQualifiers(query.value).source ?? options.defaultSource?.() ?? null,
  );
  const results = ref<SearchResult[]>([]);
  const totalCount = ref(0);
  const latencyMs = ref(0);
  const loading = ref(false);
  const searchError = ref<string | null>(null);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchGeneration = 0;

  function invalidateSearch() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    ++searchGeneration;
  }

  function clearSearchState() {
    results.value = [];
    totalCount.value = 0;
    latencyMs.value = 0;
    loading.value = false;
    searchError.value = null;
  }

  async function executeSearch() {
    const q = query.value.trim();
    if (!q) {
      invalidateSearch();
      clearSearchState();
      return;
    }

    const gen = ++searchGeneration;
    loading.value = true;
    searchError.value = null;
    // Qualifiers filter as on the Search page instead of being matched as text.
    const parsed = parseQualifiers(q);
    try {
      const response: SearchResultsResponse = await searchContent(parsed.cleanQuery, {
        limit,
        contentTypes: parsed.types.length > 0 ? parsed.types : undefined,
        repositories: parsed.repo ? [parsed.repo] : undefined,
        toolNames: parsed.tool ? [parsed.tool] : undefined,
        sessionId: parsed.session ?? undefined,
        source: source.value ?? undefined,
        sortBy: parsed.sort && parsed.sort !== "relevance" ? parsed.sort : undefined,
      });
      if (gen !== searchGeneration) return;
      results.value = response.results;
      totalCount.value = response.totalCount;
      latencyMs.value = response.latencyMs;
    } catch (e) {
      if (gen !== searchGeneration) return;
      results.value = [];
      totalCount.value = 0;
      searchError.value = toErrorMessage(e, "Search failed");
    } finally {
      if (gen === searchGeneration) loading.value = false;
    }
  }

  function debouncedSearch() {
    // Invalidate on input, before an older response can complete while the
    // replacement request is still waiting for its debounce.
    invalidateSearch();
    clearSearchState();
    if (!query.value.trim()) return;
    loading.value = true;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void executeSearch();
    }, debounceMs);
  }

  const stopWatching = watch(query, debouncedSearch, { flush: "sync" });

  const groupedResults = computed<ResultGroup[]>(() => {
    const groups = new Map<SearchContentType, SearchResult[]>();
    for (const r of results.value) {
      const existing = groups.get(r.contentType);
      if (existing) existing.push(r);
      else groups.set(r.contentType, [r]);
    }
    const out: ResultGroup[] = [];
    for (const [ct, items] of groups) {
      const config = CONTENT_TYPE_CONFIG[ct];
      out.push({
        contentType: ct,
        label: config?.label ?? ct,
        color: config?.color ?? getDesignToken("--text-tertiary"),
        results: items,
      });
    }
    return out;
  });

  const flatResults = computed<SearchResult[]>(() =>
    groupedResults.value.flatMap((g) => g.results),
  );

  const hasResults = computed(() => results.value.length > 0);
  const hasQuery = computed(() => query.value.trim().length > 0);

  function reset() {
    invalidateSearch();
    query.value = "";
    clearSearchState();
  }

  function dispose() {
    invalidateSearch();
    stopWatching();
    clearSearchState();
  }

  onScopeDispose(dispose);

  function uniqueSessionCount(): number {
    const ids = new Set(results.value.map((r) => r.sessionId));
    return ids.size;
  }

  return {
    // state
    query,
    source,
    results,
    totalCount,
    latencyMs,
    loading,
    searchError,
    // derived
    groupedResults,
    flatResults,
    hasResults,
    hasQuery,
    // helpers
    uniqueSessionCount,
    reset,
    dispose,
  };
}
