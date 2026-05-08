import { useRecentSearches } from "@/composables/useRecentSearches";

export type { RecentSearch, UseRecentSearchesOptions } from "@/composables/useRecentSearches";

/**
 * Recent-query persistence for the search store.
 *
 * Thin re-export of the `useRecentSearches` composable so the Pinia store and
 * its tests can depend on a stable `stores/search/history` import path while
 * leaving the actual localStorage-backed implementation in the composable
 * (which is also consumed directly by UI components).
 */
export const createSearchHistory = useRecentSearches;

export type SearchHistory = ReturnType<typeof createSearchHistory>;
