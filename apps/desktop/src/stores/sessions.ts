import { listSessions } from "@tracepilot/client";
import type { SessionListItem } from "@tracepilot/types";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { usePreferencesStore } from "./preferences";
import {
  buildSearchFieldCache,
  filterAndSortSessions,
  uniqueBranches,
  uniqueRepositories,
} from "./sessions/filtering";
import { createIndexingLifecycle } from "./sessions/indexingLifecycle";

export type { SortOption } from "./sessions/filtering";

import type { SortOption } from "./sessions/filtering";

export const useSessionsStore = defineStore("sessions", () => {
  // shallowRef: session list is always replaced wholesale (never index-mutated).
  const sessions = shallowRef<SessionListItem[]>([]);
  const loading = ref(false);
  const indexing = ref(false);
  const error = ref<string | null>(null);

  // ── Session List Filtering (client-side — intentional) ──────────
  // This search filters the already-loaded session list in memory.
  // It is NOT a bug that this doesn't use the backend FTS5 index.
  //
  // Rationale: The session list page needs fast, instant-feedback filtering
  // over a small dataset (~100s of sessions). Client-side substring matching
  // gives zero-latency keystrokes and avoids round-trips. The backend FTS5
  // search (in stores/search.ts → SessionSearchView) serves a different
  // purpose: deep full-text search across session *content* (turns, tool
  // results, etc.), which is a much larger dataset that requires indexing.
  //
  // Do not refactor this to use FTS5 — it has been evaluated and the current
  // approach is correct for this use case.
  const searchQuery = ref("");
  const filterRepo = ref<string | null>(null);
  const filterBranch = ref<string | null>(null);
  const sortBy = ref<SortOption>("updated");

  // Pre-compute lowercased search fields — rebuilt only when session list changes,
  // avoiding repeated .toLowerCase() calls on every keystroke in filteredSessions.
  const searchFieldCache = computed(() => buildSearchFieldCache(sessions.value));

  const filteredSessions = computed(() => {
    const prefs = usePreferencesStore();
    const term = searchQuery.value ? searchQuery.value.toLowerCase() : null;
    return filterAndSortSessions(
      sessions.value,
      {
        searchTerm: term,
        repository: filterRepo.value,
        branch: filterBranch.value,
        hideEmptySessions: prefs.hideEmptySessions,
      },
      searchFieldCache.value,
      sortBy.value,
    );
  });

  const repositories = computed(() => uniqueRepositories(sessions.value));
  const branches = computed(() => uniqueBranches(sessions.value, filterRepo.value));

  const emptySessionCount = computed(() => {
    return sessions.value.filter((s) => (s.turnCount ?? 0) === 0).length;
  });

  /** Session count respecting hideEmptySessions but not search/repo/branch filters. */
  const visibleSessionCount = computed(() => {
    const prefs = usePreferencesStore();
    if (prefs.hideEmptySessions) {
      return sessions.value.filter((s) => (s.turnCount ?? 0) !== 0).length;
    }
    return sessions.value.length;
  });

  const lifecycle = createIndexingLifecycle({
    sessions,
    loading,
    indexing,
    error,
    fetchAllSessions: () => listSessions(),
  });

  function setSortBy(option: SortOption) {
    sortBy.value = option;
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
    fetchSessions: lifecycle.fetchSessions,
    refreshSessions: lifecycle.refreshSessions,
    reindex: lifecycle.reindex,
    ensureIndex: lifecycle.ensureIndex,
    setSortBy,
  };
});
