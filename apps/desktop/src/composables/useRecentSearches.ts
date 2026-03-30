import { ref } from "vue";
import { logWarn } from "@/utils/logger";

export interface RecentSearch {
  query: string;
  timestamp: number;
  resultCount: number;
}

export interface UseRecentSearchesOptions {
  /** Maximum number of recent searches to keep. Defaults to 10. */
  maxItems?: number;
  /** localStorage key to persist recent searches. Defaults to `'tracepilot-recent-searches'`. */
  storageKey?: string;
}

const DEFAULT_MAX_ITEMS = 10;
const DEFAULT_STORAGE_KEY = "tracepilot-recent-searches";

function loadFromStorage(key: string, max: number): RecentSearch[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, max) : [];
  } catch (e) {
    logWarn("[useRecentSearches] Failed to load from localStorage:", e);
    return [];
  }
}

function saveToStorage(key: string, searches: RecentSearch[], max: number) {
  try {
    localStorage.setItem(key, JSON.stringify(searches.slice(0, max)));
  } catch (e) {
    // localStorage full or unavailable
    logWarn("[useRecentSearches] Failed to save to localStorage:", e);
  }
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

  const recentSearches = ref<RecentSearch[]>(loadFromStorage(storageKey, maxItems));

  /** Add or promote a search to the top of the recent list. */
  function addRecentSearch(query: string, resultCount: number) {
    const existing = recentSearches.value.filter((s) => s.query !== query);
    existing.unshift({ query, timestamp: Date.now(), resultCount });
    recentSearches.value = existing.slice(0, maxItems);
    saveToStorage(storageKey, recentSearches.value, maxItems);
  }

  /** Remove a specific search from the recent list. */
  function removeRecentSearch(query: string) {
    recentSearches.value = recentSearches.value.filter((s) => s.query !== query);
    saveToStorage(storageKey, recentSearches.value, maxItems);
  }

  /** Clear all recent searches. */
  function clearRecentSearches() {
    recentSearches.value = [];
    saveToStorage(storageKey, [], maxItems);
  }

  return {
    recentSearches,
    addRecentSearch,
    removeRecentSearch,
    clearRecentSearches,
  };
}
