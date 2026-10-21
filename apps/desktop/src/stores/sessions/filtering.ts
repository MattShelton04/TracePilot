import {
  resolveSessionSource,
  SESSION_SOURCES,
  type SessionListItem,
  type SessionSource,
} from "@tracepilot/types";
import { projectLabelFromCwd } from "@tracepilot/ui";
import { type FolderRepositories, folderRepositories, folderRepository } from "./repositoryFolders";
import { fieldsInclude, type SessionSearchFields } from "./searchFields";

export { buildSearchFieldCache, parseSearchTerms, type SessionSearchFields } from "./searchFields";

export type SortOption = "updated" | "created" | "oldest" | "events" | "turns";

export interface SessionFilterPredicates {
  /**
   * Lower-cased words from `parseSearchTerms`. Each must appear in at least
   * one of id/summary/repository/branch/cwd/model or a linked pull request;
   * empty means no search.
   */
  searchTerms: readonly string[];
  /**
   * A repository, or a `PROJECT_FILTER_PREFIX` key for a session with only a
   * cwd. A repository also matches cwd-only sessions in a folder it ran in.
   */
  repository: string | null;
  /** Only sessions from this source; `null` or absent means every source. */
  source?: SessionSource | null;
  hideEmptySessions: boolean;
}

/** Marks a repository-filter value as a working-directory project, not a repository. */
export const PROJECT_FILTER_PREFIX = "project:";

/**
 * What a repository-filter value reads as: the folder name for a
 * `PROJECT_FILTER_PREFIX` key, as the filter's Folders group lists it, else
 * the repository itself.
 */
export function repositoryFilterLabel(value: string): string {
  return value.startsWith(PROJECT_FILTER_PREFIX)
    ? value.slice(PROJECT_FILTER_PREFIX.length)
    : value;
}

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

  if (predicates.searchTerms.length > 0) {
    const fields = cache.get(s.id);
    if (!fields || !predicates.searchTerms.every((term) => fieldsInclude(fields, term))) {
      return false;
    }
  }

  if (predicates.repository && !inRepositoryFilter(s, predicates.repository, cache)) return false;
  if (predicates.source && resolveSessionSource(s.source) !== predicates.source) return false;

  return true;
}

/**
 * Whether `s` belongs under a repository-filter value: its own key, or the
 * repository its folder belongs to (from `cache`). A cwd-only session keeps
 * matching its folder key too, so a folder picked before a repository-bearing
 * session appeared there still shows it.
 */
export function inRepositoryFilter(
  s: SessionListItem,
  repository: string,
  cache: Map<string, SessionSearchFields>,
): boolean {
  return sessionRepositoryKey(s) === repository || cache.get(s.id)?.folderRepository === repository;
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
 * that have only a working directory, each list sorted by label. A cwd-only
 * session whose folder belongs to a repository is filed under it instead;
 * pass `folders` from the whole list when `sessions` is only part of it.
 * `selected` stays listed even with no session behind it, so the select can
 * show it.
 */
export function repositoryFilterOptions(
  sessions: readonly SessionListItem[],
  selected: string | null = null,
  folders: FolderRepositories = folderRepositories(sessions),
): RepositoryFilterOption[] {
  const repos = new Set<string>();
  const projects = new Map<string, Set<string>>();
  for (const s of sessions) {
    const repository = s.repository || folderRepository(s, folders);
    if (repository) {
      repos.add(repository);
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
  if (selected?.startsWith(PROJECT_FILTER_PREFIX)) {
    const label = selected.slice(PROJECT_FILTER_PREFIX.length);
    if (!projects.has(label)) projects.set(label, new Set());
  } else if (selected) {
    repos.add(selected);
  }
  const repoOptions = [...repos]
    .sort()
    .map((repo): RepositoryFilterOption => ({ value: repo, label: repo, group: "Repositories" }));
  const projectOptions = [...projects.keys()].sort().map(
    (label): RepositoryFilterOption => ({
      value: `${PROJECT_FILTER_PREFIX}${label}`,
      label,
      title: [...(projects.get(label) ?? [])].sort().join("\n") || undefined,
      group: "Folders",
    }),
  );
  return [...repoOptions, ...projectOptions];
}

/**
 * The repository-filter options the session list offers with `source` picked:
 * from the sessions it would show, each folder filed under its repository on
 * evidence from every session. Analytics and Search offer the same options,
 * and their backends resolve each value to the same sessions
 * (`index_db::helpers::RepositoryScope`).
 */
export function repositoryFilterOptionsFor(
  sessions: readonly SessionListItem[],
  scope: { source: SessionSource | null; hideEmptySessions: boolean; selected: string | null },
): RepositoryFilterOption[] {
  const predicates: SessionFilterPredicates = {
    searchTerms: [],
    repository: null,
    source: scope.source,
    hideEmptySessions: scope.hideEmptySessions,
  };
  // With no search terms or repository, the predicate never reads the cache.
  const shown = sessions.filter((s) => matchesSessionFilters(s, predicates, new Map()));
  return repositoryFilterOptions(shown, scope.selected, folderRepositories(sessions));
}

/** Options split into their non-empty `<optgroup>`s, repositories first. */
export function groupRepositoryFilterOptions(
  options: readonly RepositoryFilterOption[],
): { label: RepositoryFilterOption["group"]; options: RepositoryFilterOption[] }[] {
  return (["Repositories", "Folders"] as const)
    .map((label) => ({ label, options: options.filter((o) => o.group === label) }))
    .filter((group) => group.options.length > 0);
}

/** Whether any session sits under a repository-filter value, from any source. */
export function hasRepositoryFilterValue(
  sessions: readonly SessionListItem[],
  value: string,
): boolean {
  return repositoryFilterOptions(sessions).some((option) => option.value === value);
}

/** Sources present in the session set, in display order. */
export function uniqueSources(sessions: readonly SessionListItem[]): SessionSource[] {
  const present = new Set(sessions.map((s) => resolveSessionSource(s.source)));
  return SESSION_SOURCES.filter((source) => present.has(source));
}
