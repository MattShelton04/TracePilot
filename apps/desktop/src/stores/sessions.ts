import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { SessionListItem } from "@tracepilot/types";
import { listSessions, reindexSessions, searchSessions } from "@tracepilot/client";
import { watchDebounced } from "@vueuse/core";
import { usePreferencesStore } from "./preferences";

export type SortOption = "updated" | "created" | "oldest" | "events" | "turns";

/** Debounce delay for search queries (milliseconds) */
const SEARCH_DEBOUNCE_MS = 300;

/** Deduplicate concurrent indexing calls. */
let indexingPromise: Promise<[number, number]> | null = null;
/** Deduplicate concurrent fetchSessions calls. */
let fetchPromise: Promise<void> | null = null;
/** Abort controller for cancelling in-flight search requests */
let searchAbortController: AbortController | null = null;

export const useSessionsStore = defineStore("sessions", () => {
  const allSessions = ref<SessionListItem[]>([]);
  const searchedSessions = ref<SessionListItem[]>([]);
  const loading = ref(false);
  const indexing = ref(false);
  const isSearching = ref(false);
  const error = ref<string | null>(null);
  const searchQuery = ref("");
  const filterRepo = ref<string | null>(null);
  const filterBranch = ref<string | null>(null);
  const sortBy = ref<SortOption>("updated");

  /**
   * Execute search using backend FTS5 infrastructure.
   * Implements race condition protection and progressive enhancement.
   */
  async function performSearch(): Promise<void> {
    // Cancel any in-flight search
    if (searchAbortController) {
      searchAbortController.abort();
    }

    const query = searchQuery.value.trim();

    // Empty query: clear search
    if (!query) {
      searchedSessions.value = [];
      isSearching.value = false;
      searchAbortController = null;
      return;
    }

    // Create new abort controller for this search
    searchAbortController = new AbortController();
    const thisController = searchAbortController;

    isSearching.value = true;
    error.value = null;

    try {
      const results = await searchSessions(query);

      // Only update if this search wasn't cancelled
      if (thisController === searchAbortController) {
        searchedSessions.value = results;
      }
    } catch (e) {
      // Only handle error if this search wasn't cancelled
      if (thisController !== searchAbortController) {
        return; // Cancelled, ignore
      }

      const errorMsg = String(e);
      console.error("Backend search failed:", errorMsg);

      // Progressive enhancement: Fall back to client-side search
      console.warn("Falling back to client-side search");
      const q = query.toLowerCase();
      searchedSessions.value = allSessions.value.filter(
        (s) =>
          s.summary?.toLowerCase().includes(q) ||
          s.repository?.toLowerCase().includes(q) ||
          s.branch?.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q)
      );

      // Categorize error for user display
      if (errorMsg.includes("network") || errorMsg.includes("connection")) {
        error.value = "Connection error. Using cached results.";
      } else if (errorMsg.includes("invalid query")) {
        error.value = "Invalid search query.";
      } else {
        error.value = "Search using cached data (backend unavailable)";
      }
    } finally {
      if (thisController === searchAbortController) {
        isSearching.value = false;
        searchAbortController = null;
      }
    }
  }

  // Watch searchQuery with debounce
  watchDebounced(
    searchQuery,
    async () => {
      await performSearch();
    },
    { debounce: SEARCH_DEBOUNCE_MS, immediate: false }
  );

  /** Source sessions: search results if searching, else all sessions */
  const sourceSessions = computed(() => {
    return searchQuery.value.trim() ? searchedSessions.value : allSessions.value;
  });

  /** Apply hideEmptySessions preference filter */
  const filteredByPreferences = computed(() => {
    const prefs = usePreferencesStore();
    if (!prefs.hideEmptySessions) return sourceSessions.value;
    return sourceSessions.value.filter((s) => (s.turnCount ?? 0) !== 0);
  });

  /** Apply repository filter */
  const filteredByRepo = computed(() => {
    if (!filterRepo.value) return filteredByPreferences.value;
    return filteredByPreferences.value.filter((s) => s.repository === filterRepo.value);
  });

  /** Apply branch filter */
  const filteredByBranch = computed(() => {
    if (!filterBranch.value) return filteredByRepo.value;
    return filteredByRepo.value.filter((s) => s.branch === filterBranch.value);
  });

  /** Final filtered and sorted sessions */
  const filteredSessions = computed(() => {
    const sorted = [...filteredByBranch.value];
    sorted.sort((a, b) => {
      switch (sortBy.value) {
        case "created":
          return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
        case "oldest":
          return (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
        case "events":
          return (b.eventCount ?? 0) - (a.eventCount ?? 0);
        case "turns":
          return (b.turnCount ?? 0) - (a.turnCount ?? 0);
        case "updated":
        default:
          return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      }
    });
    return sorted;
  });

  const repositories = computed(() => {
    // Show all available repositories, not just visible ones
    const repos = new Set(allSessions.value.map((s) => s.repository).filter(Boolean));
    return [...repos].sort();
  });

  const branches = computed(() => {
    const br = new Set(allSessions.value.map((s) => s.branch).filter(Boolean));
    return [...br].sort();
  });

  const emptySessionCount = computed(() => {
    return allSessions.value.filter((s) => (s.turnCount ?? 0) === 0).length;
  });

  /** Session count respecting hideEmptySessions but not search/repo/branch filters. */
  const visibleSessionCount = computed(() => {
    const prefs = usePreferencesStore();
    if (prefs.hideEmptySessions) {
      return allSessions.value.filter((s) => (s.turnCount ?? 0) !== 0).length;
    }
    return allSessions.value.length;
  });

  async function fetchSessions() {
    if (fetchPromise) return fetchPromise;
    loading.value = true;
    error.value = null;
    fetchPromise = (async () => {
      try {
        allSessions.value = await listSessions();
      } catch (e) {
        error.value = String(e);
      } finally {
        fetchPromise = null;
        loading.value = false;
      }
    })();
    return fetchPromise;
  }

  /** Silently refresh session list without triggering loading skeleton. */
  async function refreshSessions() {
    if (fetchPromise) return fetchPromise;
    fetchPromise = (async () => {
      try {
        allSessions.value = await listSessions();
      } catch (e) {
        console.error("Silent refresh failed:", e);
      } finally {
        fetchPromise = null;
      }
    })();
    return fetchPromise;
  }

  /** Reindex sessions in the background, then refresh the list. */
  async function reindex() {
    if (indexingPromise) {
      // Deduplicate: wait for the in-flight indexing call
      try {
        await indexingPromise;
        allSessions.value = await listSessions();
      } catch (e) {
        const msg = String(e);
        if (msg !== "ALREADY_INDEXING") {
          error.value = msg;
        }
      }
      return;
    }

    indexing.value = true;
    error.value = null;
    try {
      indexingPromise = reindexSessions();
      await indexingPromise;
      // After reindex completes, refresh the list from the now-updated index
      allSessions.value = await listSessions();
    } catch (e) {
      const msg = String(e);
      if (msg !== "ALREADY_INDEXING") {
        error.value = msg;
      }
    } finally {
      indexingPromise = null;
      indexing.value = false;
    }
  }

  /**
   * Ensure the index is up-to-date without blocking the UI.
   * Runs an incremental reindex in the background and silently refreshes
   * the session list when done. Does not show loading/indexing states.
   */
  async function ensureIndex() {
    if (indexingPromise) {
      try {
        await indexingPromise;
      } catch {
        /* already running */
      }
      try {
        allSessions.value = await listSessions();
      } catch {
        /* silent */
      }
      return;
    }

    try {
      indexingPromise = reindexSessions();
      await indexingPromise;
      allSessions.value = await listSessions();
    } catch {
      // Silent — this is a background optimization, not user-initiated
    } finally {
      indexingPromise = null;
    }
  }

  return {
    // Backward compatibility (deprecated, will warn in dev)
    get sessions() {
      if (import.meta.env.DEV) {
        console.warn("[TracePilot] sessions is deprecated, use allSessions instead");
      }
      return allSessions.value;
    },

    // Core state
    allSessions,
    searchedSessions,
    loading,
    indexing,
    isSearching,
    error,
    searchQuery,
    filterRepo,
    filterBranch,
    sortBy,

    // Computed
    filteredSessions,
    repositories,
    branches,
    emptySessionCount,
    visibleSessionCount,

    // Actions
    fetchSessions,
    refreshSessions,
    reindex,
    ensureIndex,
  };
});
