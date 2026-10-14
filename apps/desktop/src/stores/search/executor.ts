import { searchContent } from "@tracepilot/client";
import type { AsyncGuard } from "@tracepilot/ui";
import { runAction } from "@tracepilot/ui";
import { parseQualifiers } from "@/utils/parseQualifiers";
import type { FacetsSlice } from "./facets";
import type { QuerySlice } from "./query";
import { mergeSearchInputs } from "./query";

export interface SearchExecutorDeps {
  query: QuerySlice;
  facets: FacetsSlice;
  guard: AsyncGuard;
  /** Called on success when the user-typed query produced ≥1 result. */
  recordRecentSearch: (query: string, totalCount: number) => void;
}

export interface SearchExecutor {
  executeSearch: () => Promise<void>;
}

/**
 * Search execution path — parses qualifiers, merges them with explicit
 * filters, validates the date range, dispatches to the SDK and reconciles
 * results / facets / recent-searches. Pure factory; no Vue lifecycle.
 */
export function createSearchExecutor(deps: SearchExecutorDeps): SearchExecutor {
  const { query: q, facets: f, guard, recordRecentSearch } = deps;
  /** The search inputs `q.facetSessionCount` was counted for. */
  let sessionCountKey: string | null = null;

  async function executeSearch() {
    const parsed = parseQualifiers(q.query.value);
    const merged = mergeSearchInputs(parsed, {
      contentTypes: q.contentTypes.value,
      repository: q.repository.value,
      toolName: q.toolName.value,
      sessionId: q.sessionId.value,
      source: q.source.value,
      sortBy: q.sortBy.value,
      isBrowseMode: q.isBrowseMode.value,
    });

    const { dateFromUnix, dateToUnix, error: dateError } = q.parseDateRange();
    if (dateError) {
      q.error.value = dateError;
      q.clearSearchResults();
      f.facets.value = null;
      return;
    }

    await runAction({
      loading: q.loading,
      error: q.error,
      guard,
      action: () =>
        searchContent(merged.searchQuery, {
          contentTypes: merged.contentTypes.length > 0 ? merged.contentTypes : undefined,
          excludeContentTypes:
            q.excludeContentTypes.value.length > 0 ? q.excludeContentTypes.value : undefined,
          repositories: merged.repository ? [merged.repository] : undefined,
          toolNames: merged.toolName ? [merged.toolName] : undefined,
          sessionId: merged.sessionId ?? undefined,
          source: merged.source ?? undefined,
          dateFromUnix,
          dateToUnix,
          limit: q.pageSize.value,
          offset: (q.page.value - 1) * q.pageSize.value,
          sortBy: merged.sortBy !== "relevance" ? merged.sortBy : undefined,
        }),
      onSuccess: (response) => {
        q.results.value = response.results;
        q.totalCount.value = response.totalCount;
        q.hasMore.value = response.hasMore;
        q.latencyMs.value = response.latencyMs;

        if (q.query.value.trim().length > 0 && response.totalCount > 0) {
          recordRecentSearch(q.query.value.trim(), response.totalCount);
        }

        const facetQuery = merged.searchQuery || undefined;
        const facetFilters = {
          contentTypes: merged.contentTypes,
          repo: merged.repository,
          tool: merged.toolName,
          session: merged.sessionId,
          source: merged.source,
        };
        // The facets count the sessions behind every page. Another page of the
        // same search keeps its count; anything else waits for its own facets.
        const countKey = JSON.stringify([
          facetQuery,
          facetFilters,
          q.excludeContentTypes.value,
          dateFromUnix,
          dateToUnix,
          response.totalCount,
        ]);
        if (countKey !== sessionCountKey) q.facetSessionCount.value = null;
        void f.fetchFacets(facetQuery, facetFilters).then((applied) => {
          // Only facets for the results on screen, counting the same matches.
          if (!applied || q.results.value !== response.results) return;
          const agrees = applied.totalMatches === response.totalCount;
          q.facetSessionCount.value = agrees ? applied.sessionCount : null;
          sessionCountKey = agrees ? countKey : null;
        });
      },
    });

    if (q.error.value) {
      q.clearSearchResults();
    }
  }

  return { executeSearch };
}
