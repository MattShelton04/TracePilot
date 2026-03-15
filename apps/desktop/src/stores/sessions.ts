import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { SessionListItem } from "@tracepilot/types";
import { listSessions, reindexSessions } from "@tracepilot/client";

export type SortOption = "updated" | "created" | "oldest" | "events" | "turns";

export const useSessionsStore = defineStore("sessions", () => {
  const sessions = ref<SessionListItem[]>([]);
  const loading = ref(false);
  const indexing = ref(false);
  const error = ref<string | null>(null);
  const searchQuery = ref("");
  const filterRepo = ref<string | null>(null);
  const filterBranch = ref<string | null>(null);
  const sortBy = ref<SortOption>("updated");

  const filteredSessions = computed(() => {
    let result = sessions.value;

    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase();
      result = result.filter(
        (s) =>
          s.summary?.toLowerCase().includes(q) ||
          s.repository?.toLowerCase().includes(q) ||
          s.branch?.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q),
      );
    }

    if (filterRepo.value) {
      result = result.filter((s) => s.repository === filterRepo.value);
    }
    if (filterBranch.value) {
      result = result.filter((s) => s.branch === filterBranch.value);
    }

    const sorted = [...result];
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
    const repos = new Set(sessions.value.map((s) => s.repository).filter(Boolean));
    return [...repos].sort();
  });

  const branches = computed(() => {
    const br = new Set(sessions.value.map((s) => s.branch).filter(Boolean));
    return [...br].sort();
  });

  async function fetchSessions() {
    loading.value = true;
    error.value = null;
    try {
      sessions.value = await listSessions();
    } catch (e) {
      error.value = String(e);
    } finally {
      loading.value = false;
    }
  }

  /** Reindex sessions in the background, then refresh the list. */
  async function reindex() {
    indexing.value = true;
    error.value = null;
    try {
      await reindexSessions();
      // After reindex completes, refresh the list from the now-updated index
      sessions.value = await listSessions();
    } catch (e) {
      error.value = String(e);
    } finally {
      indexing.value = false;
    }
  }

  /**
   * Ensure the index is up-to-date without blocking the UI.
   * Runs an incremental reindex in the background and silently refreshes
   * the session list when done. Does not show loading/indexing states.
   */
  async function ensureIndex() {
    try {
      await reindexSessions();
      sessions.value = await listSessions();
    } catch {
      // Silent — this is a background optimization, not user-initiated
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
    fetchSessions,
    reindex,
    ensureIndex,
  };
});
