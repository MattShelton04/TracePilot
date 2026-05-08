import type { SessionListItem } from "@tracepilot/types";

export type SortOption = "updated" | "created" | "oldest" | "events" | "turns";

export interface SessionFilterPredicates {
  /** Lower-cased substring match across id/summary/repository/branch. */
  searchTerm: string | null;
  repository: string | null;
  branch: string | null;
  hideEmptySessions: boolean;
}

export interface SessionSearchFields {
  id: string;
  summary: string;
  repository: string;
  branch: string;
}

/**
 * Build a per-session lower-cased search field cache.
 *
 * Pre-computes the strings used by `matchesSessionFilters` so the typing
 * keystroke path doesn't run `.toLowerCase()` per row per keystroke.
 */
export function buildSearchFieldCache(
  sessions: readonly SessionListItem[],
): Map<string, SessionSearchFields> {
  const cache = new Map<string, SessionSearchFields>();
  for (const s of sessions) {
    cache.set(s.id, {
      id: s.id.toLowerCase(),
      summary: (s.summary ?? "").toLowerCase(),
      repository: (s.repository ?? "").toLowerCase(),
      branch: (s.branch ?? "").toLowerCase(),
    });
  }
  return cache;
}

/**
 * Pure single-session predicate combining all session-list filters.
 *
 * `cache` is the lower-cased field cache from `buildSearchFieldCache`; if a
 * session is missing from the cache the search predicate fails closed
 * (mirrors prior store behaviour).
 */
export function matchesSessionFilters(
  s: SessionListItem,
  predicates: SessionFilterPredicates,
  cache: Map<string, SessionSearchFields>,
): boolean {
  if (predicates.hideEmptySessions && (s.turnCount ?? 0) === 0) return false;

  if (predicates.searchTerm) {
    const fields = cache.get(s.id);
    if (
      !fields ||
      !(
        fields.summary.includes(predicates.searchTerm) ||
        fields.repository.includes(predicates.searchTerm) ||
        fields.branch.includes(predicates.searchTerm) ||
        fields.id.includes(predicates.searchTerm)
      )
    ) {
      return false;
    }
  }

  if (predicates.repository && s.repository !== predicates.repository) return false;
  if (predicates.branch && s.branch !== predicates.branch) return false;

  return true;
}

/** In-place sort comparator for the session list. */
export function compareSessions(
  a: SessionListItem,
  b: SessionListItem,
  sortBy: SortOption,
): number {
  switch (sortBy) {
    case "created":
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    case "oldest":
      return (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
    case "events":
      return (b.eventCount ?? 0) - (a.eventCount ?? 0);
    case "turns":
      return (b.turnCount ?? 0) - (a.turnCount ?? 0);
    default:
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  }
}

/**
 * Filter + sort a session list. Allocates a new array; mutates nothing.
 */
export function filterAndSortSessions(
  sessions: readonly SessionListItem[],
  predicates: SessionFilterPredicates,
  cache: Map<string, SessionSearchFields>,
  sortBy: SortOption,
): SessionListItem[] {
  const result = sessions.filter((s) => matchesSessionFilters(s, predicates, cache));
  result.sort((a, b) => compareSessions(a, b, sortBy));
  return result;
}

/** Sorted unique repository list across the session set. */
export function uniqueRepositories(sessions: readonly SessionListItem[]): string[] {
  const repos = new Set(sessions.map((s) => s.repository).filter((r): r is string => !!r));
  return [...repos].sort();
}

/**
 * Sorted unique branch list, optionally scoped to a single repository.
 * Mirrors the store's previous semantics where a non-null `repository`
 * filter narrows the branch set.
 */
export function uniqueBranches(
  sessions: readonly SessionListItem[],
  repository: string | null,
): string[] {
  const scoped = repository ? sessions.filter((s) => s.repository === repository) : sessions;
  const set = new Set(scoped.map((s) => s.branch).filter((b): b is string => !!b));
  return [...set].sort();
}
