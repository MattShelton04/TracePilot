import {
  modelDisplayName,
  resolveSessionSource,
  SESSION_SOURCES,
  type SessionListItem,
  type SessionSource,
} from "@tracepilot/types";
import { projectLabelFromCwd } from "@tracepilot/ui";
import { folderRepositories, folderRepository } from "./repositoryFolders";

export type SortOption = "updated" | "created" | "oldest" | "events" | "turns";

export interface SessionFilterPredicates {
  /**
   * Lower-cased words from `parseSearchTerms`. Each must appear in at least
   * one of id/summary/repository/branch/cwd/model; empty means no search.
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

export interface SessionSearchFields {
  id: string;
  summary: string;
  repository: string;
  branch: string;
  cwd: string;
  model: string;
  /** The model as the card shows it (`claude-opus-5.5` for `claude-opus-5-5`). */
  modelName: string;
  /** The repository a cwd-only session's folder belongs to (see `repositoryFolders`). */
  folderRepository: string | null;
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
 * Split a session-list search query into lower-cased words, so that
 * "login fix" finds "Fix login bug". A blank query yields no words.
 */
export function parseSearchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Build a per-session lower-cased search field cache.
 *
 * Pre-computes the strings used by `matchesSessionFilters` so the typing
 * keystroke path doesn't run `.toLowerCase()` per row per keystroke. Built
 * from the whole list, it also records which repository each cwd-only
 * session's folder belongs to.
 */
export function buildSearchFieldCache(
  sessions: readonly SessionListItem[],
): Map<string, SessionSearchFields> {
  const cache = new Map<string, SessionSearchFields>();
  const folders = folderRepositories(sessions);
  for (const s of sessions) {
    cache.set(s.id, {
      id: s.id.toLowerCase(),
      summary: (s.summary ?? "").toLowerCase(),
      repository: (s.repository ?? "").toLowerCase(),
      branch: (s.branch ?? "").toLowerCase(),
      cwd: (s.cwd ?? "").toLowerCase(),
      model: (s.currentModel ?? "").toLowerCase(),
      modelName: s.currentModel ? modelDisplayName(s.currentModel, s.source).toLowerCase() : "",
      folderRepository: folderRepository(s, folders),
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

  if (predicates.searchTerms.length > 0) {
    const fields = cache.get(s.id);
    if (!fields || !predicates.searchTerms.every((term) => fieldsInclude(fields, term))) {
      return false;
    }
  }

  // A cwd-only session keeps matching its folder key too, so a folder picked
  // before a repository-bearing session appeared there still shows it.
  const repository = predicates.repository;
  if (
    repository &&
    sessionRepositoryKey(s) !== repository &&
    cache.get(s.id)?.folderRepository !== repository
  ) {
    return false;
  }
  if (predicates.source && resolveSessionSource(s.source) !== predicates.source) return false;

  return true;
}

function fieldsInclude(fields: SessionSearchFields, term: string): boolean {
  return (
    fields.summary.includes(term) ||
    fields.repository.includes(term) ||
    fields.branch.includes(term) ||
    fields.cwd.includes(term) ||
    fields.model.includes(term) ||
    fields.modelName.includes(term) ||
    fields.id.includes(term)
  );
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
 * session whose folder belongs to a repository is filed under it instead.
 * `selected` stays listed even with no session behind it, so the select can
 * show it.
 */
export function repositoryFilterOptions(
  sessions: readonly SessionListItem[],
  selected: string | null = null,
): RepositoryFilterOption[] {
  const repos = new Set<string>();
  const projects = new Map<string, Set<string>>();
  const folders = folderRepositories(sessions);
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

/** Sources present in the session set, in display order. */
export function uniqueSources(sessions: readonly SessionListItem[]): SessionSource[] {
  const present = new Set(sessions.map((s) => resolveSessionSource(s.source)));
  return SESSION_SOURCES.filter((source) => present.has(source));
}
