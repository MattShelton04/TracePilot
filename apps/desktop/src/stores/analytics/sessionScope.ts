/**
 * The Analytics filters' view of the session list, whose repository options
 * the Analytics header offers.
 */
import type { SessionSource } from "@tracepilot/types";
import { usePreferencesStore } from "../preferences";
import { useSessionsStore } from "../sessions";
import { buildSearchFieldCache, matchesSessionFilters } from "../sessions/filtering";

/** Ensure the sessions store is populated so the repository options have data. */
export async function fetchAvailableRepos() {
  const sessionsStore = useSessionsStore();
  if (sessionsStore.sessions.length === 0) {
    await sessionsStore.fetchSessions();
  }
}

/**
 * The repository filter to keep once `source` is picked. Like the session
 * list's, it is cleared when no session the list would show from `source`
 * sits under it; it stays while the list has not loaded.
 */
export function repositoryForSource(
  repository: string | null,
  source: SessionSource | null,
): string | null {
  const { sessions } = useSessionsStore();
  if (!repository || sessions.length === 0) return repository;
  const predicates = {
    searchTerms: [],
    repository,
    source,
    hideEmptySessions: usePreferencesStore().hideEmptySessions,
  };
  const cache = buildSearchFieldCache(sessions);
  return sessions.some((s) => matchesSessionFilters(s, predicates, cache)) ? repository : null;
}
