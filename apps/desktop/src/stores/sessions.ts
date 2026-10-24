import { IPC_EVENTS, listSessions } from "@tracepilot/client";
import {
  type PullRequestRef,
  resolveSessionSource,
  type SessionListItem,
  type SessionSource,
} from "@tracepilot/types";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { useScopedEventListener } from "@/composables/useScopedEventListener";
import { usePreferencesStore } from "./preferences";
import {
  buildSearchFieldCache,
  filterAndSortSessions,
  inRepositoryFilter,
  matchesSessionFilters,
  parseSearchTerms,
  repositoryFilterOptions,
  uniqueRepositories,
  uniqueSources,
} from "./sessions/filtering";
import { createIndexingLifecycle } from "./sessions/indexingLifecycle";
import { folderRepositories } from "./sessions/repositoryFolders";

export type { SortOption } from "./sessions/filtering";

import type { SortOption } from "./sessions/filtering";

/** Identifies a pull request across hosts; owner and repository names ignore case. */
function pullRequestKey(pr: Pick<PullRequestRef, "host" | "owner" | "repo" | "number">): string {
  return `${pr.host}/${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase();
}

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
  // over a small dataset (~100s of sessions). Client-side word matching (each
  // word of the query must appear in some field of the session) gives
  // zero-latency keystrokes and avoids round-trips. The backend FTS5
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

  // Pre-compute lowercased search fields — rebuilt only when session list changes,
  // avoiding repeated .toLowerCase() calls on every keystroke in filteredSessions.
  const searchFieldCache = computed(() => buildSearchFieldCache(sessions.value));

  const filteredSessions = computed(() => {
    const prefs = usePreferencesStore();
    return filterAndSortSessions(
      sessions.value,
      {
        searchTerms: parseSearchTerms(searchQuery.value),
        repository: filterRepo.value,
        source: filterSource.value,
        hideEmptySessions: prefs.hideEmptySessions,
      },
      searchFieldCache.value,
      sortBy.value,
    );
  });

  /** Sessions the list can show from `source` before a search or repository narrows it. */
  function sessionsInSource(source: SessionSource | null): SessionListItem[] {
    const prefs = usePreferencesStore();
    const predicates = {
      searchTerms: [],
      repository: null,
      source,
      hideEmptySessions: prefs.hideEmptySessions,
    };
    return sessions.value.filter((s) =>
      matchesSessionFilters(s, predicates, searchFieldCache.value),
    );
  }

  const repositories = computed(() => uniqueRepositories(sessions.value));
  // Which repository each folder belongs to, from every source, so a folder
  // stays filed under its repository whichever source is picked.
  const folders = computed(() => folderRepositories(sessions.value));
  // Only repositories with sessions to show; the list's filter also groups
  // repository-less sessions by their cwd.
  const repositoryOptions = computed(() =>
    repositoryFilterOptions(sessionsInSource(filterSource.value), filterRepo.value, folders.value),
  );
  const sources = computed(() => uniqueSources(sessions.value));

  const emptySessionCount = computed(() => {
    return sessions.value.filter((s) => (s.turnCount ?? 0) === 0).length;
  });

  /** Session count respecting hideEmptySessions but not search/repo/source filters. */
  const visibleSessionCount = computed(() => {
    const prefs = usePreferencesStore();
    if (prefs.hideEmptySessions) {
      return sessions.value.filter((s) => (s.turnCount ?? 0) !== 0).length;
    }
    return sessions.value.length;
  });

  /**
   * Whether the picked source (every source when none is picked) has sessions
   * but hideEmptySessions hides all of them, so showing empty sessions, not
   * clearing a search or repository, is what brings the list back.
   */
  const sourceHasOnlyHiddenSessions = computed(() => {
    const prefs = usePreferencesStore();
    if (!prefs.hideEmptySessions) return false;
    const source = filterSource.value;
    const inSource = source
      ? sessions.value.filter((s) => resolveSessionSource(s.source) === source)
      : sessions.value;
    return inSource.length > 0 && inSource.every((s) => (s.turnCount ?? 0) === 0);
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

  /** Pick a source, clearing a repository that has no sessions to show there. */
  function setFilterSource(source: SessionSource | null) {
    filterSource.value = source;
    const repo = filterRepo.value;
    const cache = searchFieldCache.value;
    if (repo && !sessionsInSource(source).some((s) => inRepositoryFilter(s, repo, cache))) {
      filterRepo.value = null;
    }
  }

  /**
   * Give list items whose primary pull request GitHub just reported its new
   * state, without reloading the list. The list is replaced only when a state
   * changed.
   */
  function applyPullRequestStates(refs: readonly PullRequestRef[]) {
    if (!refs.length) return;
    const states = new Map(refs.map((ref) => [pullRequestKey(ref), ref.state]));
    let changed = false;
    const next = sessions.value.map((session) => {
      const linked = session.linkedPullRequests;
      if (!linked) return session;
      const key = pullRequestKey(linked.primary);
      if (!states.has(key)) return session;
      const state = states.get(key) ?? null;
      if (linked.primary.state === state) return session;
      changed = true;
      return {
        ...session,
        linkedPullRequests: { ...linked, primary: { ...linked.primary, state } },
      };
    });
    if (changed) sessions.value = next;
  }

  // Passes and source purges (turning Claude Code on or off) change the
  // list; keep the loaded list and the sidebar count in step with the index.
  const watchIndexUpdates = useScopedEventListener(IPC_EVENTS.INDEXING_FINISHED, () => {
    void lifecycle.refreshAfterIndexPass();
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
    filteredSessions,
    repositories,
    repositoryOptions,
    sources,
    emptySessionCount,
    visibleSessionCount,
    sourceHasOnlyHiddenSessions,
    fetchSessions: lifecycle.fetchSessions,
    refreshSessions: lifecycle.refreshSessions,
    reindex: lifecycle.reindex,
    ensureIndex: lifecycle.ensureIndex,
    watchIndexUpdates,
    setSortBy,
    setFilterSource,
    applyPullRequestStates,
  };
});
