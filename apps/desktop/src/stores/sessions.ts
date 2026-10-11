import { IPC_EVENTS, listSessions } from "@tracepilot/client";
import type { SessionListItem, SessionSource } from "@tracepilot/types";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { useScopedEventListener } from "@/composables/useScopedEventListener";
import { usePreferencesStore } from "./preferences";
import { useSessionAnnotationsStore } from "./sessionAnnotations";
import {
  buildSearchFieldCache,
  filterAndSortSessions,
  repositoryFilterOptions,
  uniqueRepositories,
  uniqueSources,
} from "./sessions/filtering";
import { createIndexingLifecycle } from "./sessions/indexingLifecycle";

export type { SessionListScope, SortOption } from "./sessions/filtering";

import type { SessionListScope, SortOption } from "./sessions/filtering";

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
  const filterSource = ref<SessionSource | null>(null);
  const sortBy = ref<SortOption>("updated");
  /** All (archived hidden), starred only, or archived only. */
  const scope = ref<SessionListScope>("all");
  const filterTag = ref<string | null>(null);

  // Pre-compute lowercased search fields — rebuilt only when session list changes,
  // avoiding repeated .toLowerCase() calls on every keystroke in filteredSessions.
  const searchFieldCache = computed(() => buildSearchFieldCache(sessions.value));

  const filteredSessions = computed(() => {
    const prefs = usePreferencesStore();
    const annotations = useSessionAnnotationsStore();
    const term = searchQuery.value ? searchQuery.value.toLowerCase() : null;
    return filterAndSortSessions(
      sessions.value,
      {
        searchTerm: term,
        repository: filterRepo.value,
        source: filterSource.value,
        hideEmptySessions: prefs.hideEmptySessions,
        scope: scope.value,
        tag: filterTag.value,
        annotations: annotations.byId,
      },
      searchFieldCache.value,
      sortBy.value,
    );
  });

  const repositories = computed(() => uniqueRepositories(sessions.value));
  // The list's filter also groups repository-less sessions by their cwd.
  const repositoryOptions = computed(() => repositoryFilterOptions(sessions.value));
  const sources = computed(() => uniqueSources(sessions.value));

  const emptySessionCount = computed(() => {
    return sessions.value.filter((s) => (s.turnCount ?? 0) === 0).length;
  });

  /**
   * Session count respecting hideEmptySessions and archiving, but not
   * search/repo/source filters.
   */
  const visibleSessionCount = computed(() => {
    const prefs = usePreferencesStore();
    const annotations = useSessionAnnotationsStore();
    return sessions.value.filter(
      (s) =>
        !annotations.isArchived(s.id) && !(prefs.hideEmptySessions && (s.turnCount ?? 0) === 0),
    ).length;
  });

  /** How many loaded sessions are starred (not archived) and archived. */
  const annotationCounts = computed(() => {
    const annotations = useSessionAnnotationsStore();
    let starred = 0;
    let archived = 0;
    for (const s of sessions.value) {
      if (annotations.isArchived(s.id)) archived += 1;
      else if (annotations.isStarred(s.id)) starred += 1;
    }
    return { starred, archived };
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

  // Passes and source purges (turning Claude Code on or off) change the
  // list; keep the loaded list and the sidebar count in step with the index.
  const watchIndexUpdates = useScopedEventListener(IPC_EVENTS.INDEXING_FINISHED, () => {
    void lifecycle.refreshSessions();
  });

  return {
    sessions,
    loading,
    indexing,
    error,
    searchQuery,
    filterRepo,
    filterSource,
    sortBy,
    scope,
    filterTag,
    filteredSessions,
    repositories,
    repositoryOptions,
    sources,
    emptySessionCount,
    visibleSessionCount,
    annotationCounts,
    fetchSessions: lifecycle.fetchSessions,
    refreshSessions: lifecycle.refreshSessions,
    reindex: lifecycle.reindex,
    ensureIndex: lifecycle.ensureIndex,
    watchIndexUpdates,
    setSortBy,
  };
});
