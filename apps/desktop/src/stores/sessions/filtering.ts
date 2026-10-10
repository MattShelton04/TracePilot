import {
  resolveSessionSource,
  SESSION_SOURCES,
  type SessionListItem,
  type SessionSource,
} from "@tracepilot/types";
import { projectLabelFromCwd } from "@tracepilot/ui";

export type SortOption = "updated" | "created" | "oldest" | "events" | "turns";

export interface SessionFilterPredicates {
  /** Lower-cased substring match across id/summary/repository/branch/cwd/model. */
  searchTerm: string | null;
  /** A repository, or a `PROJECT_FILTER_PREFIX` key for a session with only a cwd. */
  repository: string | null;
  /** Only sessions from this source; `null` or absent means every source. */
  source?: SessionSource | null;
  hideEmptySessions: boolean;
}

export interface SessionSearchFields {
  id: string;
  summary: string;
  repository: string;
  branch: string;
  cwd: string;
  model: string;
}

/** Marks a repository-filter value as a working-directory project, not a repository. */
export const PROJECT_FILTER_PREFIX = "project:";

/** One option of the session list's repository filter. */
export interface RepositoryFilterOption {
  value: string;
  label: string;
  /** Full working directories behind a project option. */
  title?: string;
  group: "Repositories" | "Folders";
}

/**
 * The repository-filter key a session groups under: its repository, or a
 * project derived from its working directory when it has no repository.
 */
export function sessionRepositoryKey(s: SessionListItem): string | null {
  if (s.repository) return s.repository;
  const project = projectLabelFromCwd(s.cwd);
  return project ? `${PROJECT_FILTER_PREFIX}${project}` : null;
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
      cwd: (s.cwd ?? "").toLowerCase(),
      model: (s.currentModel ?? "").toLowerCase(),
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
        fields.cwd.includes(predicates.searchTerm) ||
        fields.model.includes(predicates.searchTerm) ||
        fields.id.includes(predicates.searchTerm)
      )
    ) {
      return false;
    }
  }

  if (predicates.repository && sessionRepositoryKey(s) !== predicates.repository) return false;
  if (predicates.source && resolveSessionSource(s.source) !== predicates.source) return false;

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
 * Repository-filter options: repositories first, then projects for sessions
 * that have only a working directory, each list sorted by label.
 */
export function repositoryFilterOptions(
  sessions: readonly SessionListItem[],
): RepositoryFilterOption[] {
  const repos = new Set<string>();
  const projects = new Map<string, Set<string>>();
  for (const s of sessions) {
    if (s.repository) {
      repos.add(s.repository);
      continue;
    }
    const label = projectLabelFromCwd(s.cwd);
    if (!label || !s.cwd) continue;
    let paths = projects.get(label);
    if (!paths) {
      paths = new Set();
      projects.set(label, paths);
    }
    paths.add(s.cwd.trim());
  }
  const repoOptions = [...repos]
    .sort()
    .map((repo): RepositoryFilterOption => ({ value: repo, label: repo, group: "Repositories" }));
  const projectOptions = [...projects.keys()].sort().map(
    (label): RepositoryFilterOption => ({
      value: `${PROJECT_FILTER_PREFIX}${label}`,
      label,
      title: [...(projects.get(label) ?? [])].sort().join("\n"),
      group: "Folders",
    }),
  );
  return [...repoOptions, ...projectOptions];
}

/** Sources present in the session set, in display order. */
export function uniqueSources(sessions: readonly SessionListItem[]): SessionSource[] {
  const present = new Set(sessions.map((s) => resolveSessionSource(s.source)));
  return SESSION_SOURCES.filter((source) => present.has(source));
}
