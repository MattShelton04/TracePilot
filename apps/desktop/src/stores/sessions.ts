import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { SessionListItem } from "@tracepilot/types";
import { listSessions, reindexSessions } from "@tracepilot/client";
import { toErrorMessage } from "@tracepilot/ui";
import { logError, logWarn } from "@/utils/logger";
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
  const filterRepo = ref<string | null>(null);
  const filterBranch = ref<string | null>(null);
  const sortBy = ref<SortOption>("updated");

  // Pre-compute lowercased search fields — rebuilt only when session list changes,
  // avoiding repeated .toLowerCase() calls on every keystroke in filteredSessions.
  const searchFieldCache = computed(() => {
    const cache = new Map<string, { id: string; summary: string; repository: string; branch: string }>();
    for (const s of sessions.value) {
      cache.set(s.id, {
        id: s.id.toLowerCase(),
        summary: (s.summary ?? '').toLowerCase(),
        repository: (s.repository ?? '').toLowerCase(),
        branch: (s.branch ?? '').toLowerCase(),
      });
    }
    return cache;
  });

  const filteredSessions = computed(() => {
    const prefs = usePreferencesStore();
    const q = searchQuery.value ? searchQuery.value.toLowerCase() : null;
    const repo = filterRepo.value;
    const branch = filterBranch.value;
    const hideEmpty = prefs.hideEmptySessions;
    const cache = searchFieldCache.value;

    // Single-pass filter: combine all predicates into one loop
    const result = sessions.value.filter((s) => {
      if (hideEmpty && (s.turnCount ?? 0) === 0) return false;

      if (q) {
        const fields = cache.get(s.id);
        if (!fields || !(
          fields.summary.includes(q) ||
          fields.repository.includes(q) ||
          fields.branch.includes(q) ||
          fields.id.includes(q)
        )) return false;
      }

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
      try { await indexingPromise; } catch (e) {
        // Background reindex already running - log warning if it fails
        logWarn('[sessions] Background reindex in progress failed', e);
      }
      try { sessions.value = await listSessions(); } catch (e) {
        // Silent refresh failed
        logWarn('[sessions] Failed to refresh session list after background reindex', e);
      }
      return;
    }

    try {
      indexingPromise = reindexSessions();
      await indexingPromise;
      sessions.value = await listSessions();
    } catch (e) {
      // Silent — this is a background optimization, not user-initiated
      logWarn('[sessions] Background ensureIndex failed', e);
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
