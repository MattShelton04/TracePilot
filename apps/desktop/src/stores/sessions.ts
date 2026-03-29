import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import type { SessionListItem } from "@tracepilot/types";
import { listSessions, reindexSessions, searchSessions } from "@tracepilot/client";
import { toErrorMessage } from "@tracepilot/ui";
import { logError, logWarn } from "@/utils/logger";
import { useAsyncGuard } from "@/composables/useAsyncGuard";
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
  const error = ref<string | null>(null);
  const searchQuery = ref("");
  const searchResults = ref<SessionListItem[] | null>(null);
  const isSearching = ref(false);
  const searchError = ref<string | null>(null);
  const filterRepo = ref<string | null>(null);
  const filterBranch = ref<string | null>(null);
  const sortBy = ref<SortOption>("updated");

  const searchGuard = useAsyncGuard();
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  watch(searchQuery, (newQuery) => {
    if (searchTimeout) clearTimeout(searchTimeout);

    if (!newQuery || !newQuery.trim()) {
      searchGuard.invalidate();
      searchResults.value = null;
      searchError.value = null;
      isSearching.value = false;
      return;
    }

    isSearching.value = true;
    searchError.value = null;

    searchTimeout = setTimeout(async () => {
      const token = searchGuard.start();
      try {
        const results = await searchSessions(newQuery.trim());
        if (!searchGuard.isValid(token)) return;
        searchResults.value = results;
      } catch (e) {
        if (!searchGuard.isValid(token)) return;
        logWarn("[sessions] Search failed:", e);
        searchResults.value = [];
        searchError.value = toErrorMessage(e);
      } finally {
        if (searchGuard.isValid(token)) {
          isSearching.value = false;
        }
      }
    }, 300);
  });

  const filteredSessions = computed(() => {
    const prefs = usePreferencesStore();
    const q = searchQuery.value ? searchQuery.value.trim() : null;
    const repo = filterRepo.value;
    const branch = filterBranch.value;
    const hideEmpty = prefs.hideEmptySessions;

    // Use searchResults if there's a query, otherwise use full sessions list
    const baseList = q ? (searchResults.value ?? []) : sessions.value;

    // Single-pass filter: combine all predicates into one loop
    const result = baseList.filter((s) => {
      if (hideEmpty && (s.turnCount ?? 0) === 0) return false;
      if (repo && s.repository !== repo) return false;
      if (branch && s.branch !== branch) return false;

      return true;
    });

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
    error,
    searchQuery,
    searchResults,
    isSearching,
    searchError,
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
