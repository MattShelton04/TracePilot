import {
  getSearchFacets,
  getSearchRepositories,
  getSearchStats,
  getSearchToolNames,
} from "@tracepilot/client";
import type { SearchFacetsResponse, SearchStatsResponse } from "@tracepilot/types";
import { useAsyncGuard } from "@tracepilot/ui";
import { ref, shallowRef } from "vue";
import { logWarn } from "@/utils/logger";
import type { QuerySlice } from "./query";

export interface FacetOverrides {
  contentTypes?: string[];
  repo?: string | null;
  tool?: string | null;
  session?: string | null;
}

/**
 * Facets, stats, and available filter-option fetching.
 *
 * Guards prevent stale async responses when filters/search change rapidly
 * or when concurrent indexing/rebuild operations trigger parallel fetches.
 */
export function createFacetsSlice(q: QuerySlice) {
  // shallowRef: these payloads are immutable snapshots replaced wholesale.
  const stats = shallowRef<SearchStatsResponse | null>(null);
  const facets = shallowRef<SearchFacetsResponse | null>(null);
  const statsLoading = ref(false);

  const availableRepositories = shallowRef<string[]>([]);
  const availableToolNames = shallowRef<string[]>([]);

  const facetGuard = useAsyncGuard();
  const statsGuard = useAsyncGuard();
  const filterOptionsGuard = useAsyncGuard();

  /** Timestamp of the last unfiltered facets fetch — prevents redundant round-trips on re-navigation. */
  let facetsLastFetchedAt = 0;
  const FACETS_CACHE_TTL_MS = 2 * 60 * 1000;

  async function fetchFacets(forQuery?: string, overrides?: FacetOverrides) {
    const token = facetGuard.start();
    try {
      const { dateFromUnix, dateToUnix, error: dateError } = q.parseDateRange();
      if (dateError) {
        if (!facetGuard.isValid(token)) return;
        facets.value = null;
        logWarn("[search] Skipping search facets fetch due to invalid date filter:", dateError);
        return;
      }

      const ct = overrides?.contentTypes ?? q.contentTypes.value;
      const repo = overrides?.repo ?? q.repository.value;
      const tool = overrides?.tool ?? q.toolName.value;
      const session =
        overrides?.session !== undefined ? overrides.session : q.sessionId.value;

      // Skip re-fetch for unfiltered browse-mode calls when results are already fresh.
      // Filter-scoped fetches (after a search) always run to reflect the current query.
      const isUnfiltered =
        !forQuery &&
        ct.length === 0 &&
        q.excludeContentTypes.value.length === 0 &&
        !repo &&
        !tool &&
        !session &&
        !dateFromUnix &&
        !dateToUnix;
      if (isUnfiltered && facets.value && Date.now() - facetsLastFetchedAt < FACETS_CACHE_TTL_MS) {
        return;
      }

      const result = await getSearchFacets(forQuery, {
        contentTypes: ct.length > 0 ? ct : undefined,
        excludeContentTypes:
          q.excludeContentTypes.value.length > 0 ? q.excludeContentTypes.value : undefined,
        repositories: repo ? [repo] : undefined,
        toolNames: tool ? [tool] : undefined,
        sessionId: session ?? undefined,
        dateFromUnix,
        dateToUnix,
      });
      if (!facetGuard.isValid(token)) return;
      facets.value = result;
      if (isUnfiltered) facetsLastFetchedAt = Date.now();
    } catch (e) {
      if (!facetGuard.isValid(token)) return;
      logWarn("[search] Failed to fetch search facets:", e);
    }
  }

  /** Invalidate the facets cache so the next unfiltered fetch always runs (e.g. after reindex). */
  function invalidateFacetsCache() {
    facetsLastFetchedAt = 0;
  }

  async function fetchStats() {
    const token = statsGuard.start();
    statsLoading.value = true;
    try {
      const result = await getSearchStats();
      if (!statsGuard.isValid(token)) return;
      stats.value = result;
    } catch (e) {
      if (!statsGuard.isValid(token)) return;
      logWarn("[search] Failed to fetch search stats:", e);
    } finally {
      if (statsGuard.isValid(token)) statsLoading.value = false;
    }
  }

  async function fetchFilterOptions() {
    const token = filterOptionsGuard.start();
    try {
      const [repos, tools] = await Promise.all([getSearchRepositories(), getSearchToolNames()]);
      if (!filterOptionsGuard.isValid(token)) return;
      availableRepositories.value = repos;
      availableToolNames.value = tools;
    } catch (e) {
      if (!filterOptionsGuard.isValid(token)) return;
      // Non-fatal - filter options are supplementary UI info
      logWarn("[search] Failed to fetch filter options", e);
    }
  }

  return {
    stats,
    facets,
    statsLoading,
    availableRepositories,
    availableToolNames,
    fetchFacets,
    fetchStats,
    fetchFilterOptions,
    invalidateFacetsCache,
  };
}

export type FacetsSlice = ReturnType<typeof createFacetsSlice>;
