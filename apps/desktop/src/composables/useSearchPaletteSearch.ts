import { searchContent } from "@tracepilot/client";
import type { SearchContentType, SearchResult, SearchResultsResponse } from "@tracepilot/types";
import { CONTENT_TYPE_CONFIG, toErrorMessage } from "@tracepilot/ui";
import { computed, ref, watch } from "vue";

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
export function useSearchPaletteSearch(options: { debounceMs?: number; limit?: number } = {}) {
  const debounceMs = options.debounceMs ?? 150;
  const limit = options.limit ?? 20;

  const query = ref("");
  const results = ref<SearchResult[]>([]);
  const totalCount = ref(0);
  const latencyMs = ref(0);
  const loading = ref(false);
  const searchError = ref<string | null>(null);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchGeneration = 0;

  async function executeSearch() {
    const q = query.value.trim();
    if (!q) {
      ++searchGeneration;
      results.value = [];
      totalCount.value = 0;
      latencyMs.value = 0;
      loading.value = false;
      searchError.value = null;
      return;
    }

    const gen = ++searchGeneration;
    loading.value = true;
    searchError.value = null;
    try {
      const response: SearchResultsResponse = await searchContent(q, { limit });
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
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(executeSearch, debounceMs);
  }

  watch(query, () => {
    debouncedSearch();
  });

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
        color: config?.color ?? "#71717a",
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
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    ++searchGeneration;
    query.value = "";
    results.value = [];
    totalCount.value = 0;
    latencyMs.value = 0;
    loading.value = false;
    searchError.value = null;
  }

  function dispose() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function uniqueSessionCount(): number {
    const ids = new Set(results.value.map((r) => r.sessionId));
    return ids.size;
  }

  return {
    // state
    query,
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
