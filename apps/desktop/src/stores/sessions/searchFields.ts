/**
 * The session list's text search: the lower-cased fields each session is
 * searched by, the query's terms, and whether one term matches. Kept apart
 * from the filter and sort predicates in `filtering.ts`, which re-exports it.
 */
import { modelDisplayName, type SessionListItem } from "@tracepilot/types";
import {
  includesPullRequestKey,
  isPullRequestSearchKey,
  pullRequestKeyFromUrl,
  pullRequestSearchKeys,
} from "@/utils/pullRequestUrl";
import { folderRepositories, folderRepository } from "./repositoryFolders";

/** The fields every term is looked for in, besides linked pull requests. */
const TEXT_FIELDS = [
  "summary",
  "repository",
  "branch",
  "cwd",
  "model",
  "modelName",
  "id",
] as const satisfies readonly (keyof SessionSearchFields)[];

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
  /** Each linked pull request's `owner/repo#n` and title, one per line. */
  pullRequests: string;
  /** Exact `#n` and `owner/repo#n` keys, for terms shaped like one. */
  pullRequestKeys: ReadonlySet<string> | null;
}

/**
 * Split a session-list search query into lower-cased words, so that
 * "login fix" finds "Fix login bug". A blank query yields no words. A pull
 * request URL becomes its `owner/repo#n` key, so a typed URL finds the
 * sessions linked to that pull request as a pasted one does.
 */
export function parseSearchTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (pullRequestKeyFromUrl(word) ?? word).toLowerCase());
}

function pullRequestSearchFields(
  s: SessionListItem,
): Pick<SessionSearchFields, "pullRequests" | "pullRequestKeys"> {
  const prs = s.linkedPullRequests?.pullRequests ?? [];
  if (prs.length === 0) return { pullRequests: "", pullRequestKeys: null };
  const keys = new Set<string>();
  const lines: string[] = [];
  for (const pr of prs) {
    const [numberKey, fullKey] = pullRequestSearchKeys(pr);
    keys.add(numberKey);
    keys.add(fullKey);
    // One line each: a term never has whitespace, so it can't span two.
    lines.push(fullKey, (pr.title ?? "").toLowerCase());
  }
  return { pullRequests: lines.join("\n"), pullRequestKeys: keys };
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
      ...pullRequestSearchFields(s),
    });
  }
  return cache;
}

/**
 * Whether `term` appears in any searched field. A `#n` or `owner/repo#n`
 * term names one pull request: a linked one matches only as a whole key, and
 * the text fields only where no digit follows it, so `#57` finds neither
 * #570 nor "Review #570". Any other term, a bare number included, is a
 * substring of any field.
 */
export function fieldsInclude(fields: SessionSearchFields, term: string): boolean {
  if (isPullRequestSearchKey(term)) {
    return (
      fields.pullRequestKeys?.has(term) === true ||
      TEXT_FIELDS.some((field) => includesPullRequestKey(fields[field], term))
    );
  }
  return (
    (fields.pullRequestKeys !== null && fields.pullRequests.includes(term)) ||
    TEXT_FIELDS.some((field) => fields[field].includes(term))
  );
}
