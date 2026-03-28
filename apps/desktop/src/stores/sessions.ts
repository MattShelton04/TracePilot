import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { watchDebounced } from "@vueuse/core";
import type { SessionListItem } from "@tracepilot/types";
import { listSessions, reindexSessions, searchSessions } from "@tracepilot/client";
import { toErrorMessage } from "@tracepilot/ui";
import { logError } from "@/utils/logger";
import { usePreferencesStore } from "./preferences";

export type SortOption = "updated" | "created" | "oldest" | "events" | "turns";

/** Deduplicate concurrent indexing calls. */
let indexingPromise: Promise<[number, number]> | null = null;
/** Deduplicate concurrent fetchSessions calls. */
let fetchPromise: Promise<void> | null = null;

export const useSessionsStore = defineStore("sessions", () => {
  const sessions = ref<SessionListItem[]>([]);
  const loading = ref(false);
  const indexing = ref(false);
  const searching = ref(false);
  const error = ref<string | null>(null);
  const searchError = ref<string | null>(null);
  const searchQuery = ref("");
  const filterRepo = ref<string | null>(null);
  const filterBranch = ref<string | null>(null);
  const sortBy = ref<SortOption>("updated");

  /**
   * Debounced search watcher: triggers backend FTS5 search when query changes.
   * Uses 300ms debounce to avoid excessive backend calls during typing.
   * Falls back to listSessions() when query is empty.
   */
  watchDebounced(
    searchQuery,
    async (query) => {
      if (!query || query.trim() === '') {
        // Empty query: fetch all sessions (normal browse mode)
        await fetchSessions();
        return;
      }

      // Execute backend FTS5 search
      searching.value = true;
      searchError.value = null;
      try {
        const results = await searchSessions(query.trim());
        sessions.value = results;
      } catch (e) {
        searchError.value = toErrorMessage(e);
        logError('[sessions] Search failed:', e);
        // Keep existing sessions visible on error for better UX
      } finally {
        searching.value = false;
      }
    },
    { debounce: 300, maxWait: 1000 }
  );

  /**
   * Filtered and sorted sessions list.
   * When searchQuery is non-empty, sessions.value contains FTS5 search results.
   * When searchQuery is empty, sessions.value contains all indexed sessions.
   * This computed applies client-side filters (repo, branch, hideEmpty) and sorting.
   */
  const filteredSessions = computed(() => {
    const prefs = usePreferencesStore();
    const repo = filterRepo.value;
    const branch = filterBranch.value;
    const hideEmpty = prefs.hideEmptySessions;

    // sessions.value now contains either:
    // - All sessions (from listSessions) if no search query
    // - Search results (from searchSessions) if query exists

    let result = sessions.value;

    // Apply client-side filters for instant reactivity
    if (hideEmpty) {
      result = result.filter(s => (s.turnCount ?? 0) !== 0);
    }
    if (repo) {
      result = result.filter(s => s.repository === repo);
    }
    if (branch) {
      result = result.filter(s => s.branch === branch);
    }

    // Apply sort
    result.sort((a, b) => {
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

    return result;
  });

  const repositories = computed(() => {
    const repos = new Set(sessions.value.map((s) => s.repository).filter(Boolean));
    return [...repos].sort();
  });

  const branches = computed(() => {
    let s = sessions.value;
    if (filterRepo.value) {
      s = s.filter((x) => x.repository === filterRepo.value);
    }
    const br = new Set(s.map((s) => s.branch).filter(Boolean));
    return [...br].sort();
  });

  const emptySessionCount = computed(() => {
    return sessions.value.filter(s => (s.turnCount ?? 0) === 0).length;
  });

  /** Session count respecting hideEmptySessions but not search/repo/branch filters. */
  const visibleSessionCount = computed(() => {
    const prefs = usePreferencesStore();
    if (prefs.hideEmptySessions) {
      return sessions.value.filter(s => (s.turnCount ?? 0) !== 0).length;
    }
    return sessions.value.length;
  });

  async function fetchSessions() {
    if (fetchPromise) return fetchPromise;
    loading.value = true;
    error.value = null;
    fetchPromise = (async () => {
      try {
        sessions.value = await listSessions();
      } catch (e) {
        error.value = toErrorMessage(e);
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
        sessions.value = await listSessions();
      } catch (e) {
        logError("[sessions] Silent refresh failed:", e);
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
        sessions.value = await listSessions();
      } catch (e) {
        const msg = toErrorMessage(e);
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
      sessions.value = await listSessions();
    } catch (e) {
      const msg = toErrorMessage(e);
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
      try { await indexingPromise; } catch { /* already running */ }
      try { sessions.value = await listSessions(); } catch { /* silent */ }
      return;
    }

    try {
      indexingPromise = reindexSessions();
      await indexingPromise;
      sessions.value = await listSessions();
    } catch {
      // Silent — this is a background optimization, not user-initiated
    } finally {
      indexingPromise = null;
    }
  }

  return {
    sessions,
    loading,
    indexing,
    searching,
    error,
    searchError,
    searchQuery,
    filterRepo,
    filterBranch,
    sortBy,
    filteredSessions,
    repositories,
    branches,
    emptySessionCount,
    visibleSessionCount,
    fetchSessions,
    refreshSessions,
    reindex,
    ensureIndex,
  };
});
