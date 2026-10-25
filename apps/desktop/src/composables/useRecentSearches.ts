import { usePersistedRef } from "@tracepilot/ui";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { logWarn } from "@/utils/logger";

export interface RecentSearch {
  query: string;
  timestamp: number;
  resultCount: number;
}

export interface UseRecentSearchesOptions {
  /** Maximum number of recent searches to keep. Defaults to 10. */
  maxItems?: number;
  /** localStorage key to persist recent searches. Defaults to `STORAGE_KEYS.recentSearches`. */
  storageKey?: string;
  /**
   * How long after the newest entry a query that extends or trims it still
   * counts as refining it (and replaces it). Defaults to 5 seconds.
   */
  refineWindowMs?: number;
}

const DEFAULT_MAX_ITEMS = 10;
const DEFAULT_STORAGE_KEY = STORAGE_KEYS.recentSearches;
const DEFAULT_REFINE_WINDOW_MS = 5_000;

/** One query is the other plus more typing (either direction), ignoring case. */
function isRefinement(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * Composable for managing recent search history with localStorage persistence.
 *
 * Handles CRUD operations and persistence. Does **not** trigger searches —
 * the search store owns query state and search execution.
 */
export function useRecentSearches(options: UseRecentSearchesOptions = {}) {
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const refineWindowMs = options.refineWindowMs ?? DEFAULT_REFINE_WINDOW_MS;

  const recentSearches = usePersistedRef<RecentSearch[]>(storageKey, [], {
    onParseError: (e) => logWarn("[useRecentSearches] Failed to load from localStorage:", e),
    serializer: {
      read: (raw) => {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.slice(0, maxItems) : [];
        } catch {
          return [];
        }
      },
      write: (val) => JSON.stringify(val),
    },
  });

  /**
   * Add or promote a search to the top of the recent list.
   *
   * Search runs as the user types, so typing "auth plugin" records "auth",
   * "auth p", ... in turn. A query that extends or trims the newest entry
   * within `refineWindowMs` of it is the same search being refined, so it
   * replaces that entry instead of pushing older history out. Re-running the
   * newest query (another page, a filter) keeps its timestamp, so the window
   * still dates from when the user stopped typing it.
   */
  function addRecentSearch(query: string, resultCount: number) {
    const now = Date.now();
    const newest = recentSearches.value[0];
    const repeatsNewest = newest?.query === query;
    const refinesNewest =
      newest !== undefined &&
      !repeatsNewest &&
      now - newest.timestamp < refineWindowMs &&
      isRefinement(newest.query, query);
    const existing = recentSearches.value.filter(
      (s, i) => s.query !== query && !(refinesNewest && i === 0),
    );
    const timestamp = repeatsNewest ? newest.timestamp : now;
    existing.unshift({ query, timestamp, resultCount });
    recentSearches.value = existing.slice(0, maxItems);
  }

  /** Remove a specific search from the recent list. */
  function removeRecentSearch(query: string) {
    recentSearches.value = recentSearches.value.filter((s) => s.query !== query);
  }

  /** Clear all recent searches. */
  function clearRecentSearches() {
    recentSearches.value = [];
  }

  return {
    recentSearches,
    addRecentSearch,
    removeRecentSearch,
    clearRecentSearches,
  };
}
