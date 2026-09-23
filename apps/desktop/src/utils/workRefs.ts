/**
 * Presentation model for linked-work references read from the Copilot CLI's
 * own session store.
 *
 * A reference is evidence that a value was *mentioned* in a session, not that
 * the session worked on it. How a reference may link:
 *
 *   - an explicit reference links to the host and repository it named;
 *   - a bare `#123` links into the session's own repository, the way GitHub
 *     itself reads `#123` inside a repository, but only when TracePilot knows
 *     the session is on github.com. The host is never assumed: the same number
 *     on GitHub Enterprise is a different issue, so those stay unlinked. The
 *     link is marked as inferred, since a mention of another repository would
 *     make it wrong;
 *   - `kind: "gitRef"` is a Git ref. Only a SHA-shaped one links, as a commit;
 *     branch names and expressions such as `HEAD~1` stay plain.
 */

import type { StoredWorkRef, WorkRefResolution } from "@tracepilot/types";
import type { StatusPillTone } from "@tracepilot/ui";
import { parseExternalUrl } from "@/utils/openExternal";

/** How a row may be acted on. */
export type WorkRefPresentation =
  /** Opens externally; `linkInferred` says whether the repository was assumed. */
  | "link"
  /** Has a repository but no safe link, e.g. a branch name or an unknown host. */
  | "context"
  /** Searchable text only. */
  | "label";

/** What the session itself says about where its repository lives. */
export interface WorkRefContext {
  /**
   * The host a bare reference may be linked on: `github.com` for a session
   * TracePilot recorded as GitHub-hosted, otherwise `null`.
   */
  sessionHost: string | null;
}

export interface WorkRefRow {
  identity: string;
  /** The source kind, e.g. `pullRequest`; used for grouping. */
  kind: string;
  kindLabel: string;
  /** Short identifier shown first, e.g. `#844` or a branch name. */
  displayValue: string;
  /** The value exactly as the source recorded it. */
  rawValue: string;
  presentation: WorkRefPresentation;
  /** Present only when `presentation === "link"`. */
  href: string | null;
  /** True when the link's repository came from the session, not the reference. */
  linkInferred: boolean;
  /** What "copy" puts on the clipboard: `owner/name#123`, a SHA or a ref name. */
  copyText: string;
  /** A session-search query finding every session that mentions this, or `null`. */
  searchQuery: string | null;
  /** Grouping key: `commit` and `branch` split the Git refs apart. */
  group: string;
  repository: string | null;
  /** False when the repository came from the session rather than the ref. */
  repositoryVerified: boolean;
  host: string | null;
  /** True only for a `gitRef` whose text is 7–40 hex characters. */
  shaCandidate: boolean;
  resolution: WorkRefResolution;
  resolutionLabel: string;
  resolutionTone: StatusPillTone;
  resolutionHint: string;
}

const KIND_LABELS: Record<string, string> = {
  pullRequest: "Pull request",
  issue: "Issue",
  gitRef: "Git ref",
};

const RESOLUTION_LABELS: Record<WorkRefResolution, string> = {
  explicit: "Explicit reference",
  sessionContext: "Unverified repository",
  unresolved: "Unresolved",
};

const RESOLUTION_TONES: Record<WorkRefResolution, StatusPillTone> = {
  explicit: "accent",
  sessionContext: "warning",
  unresolved: "neutral",
};

const RESOLUTION_HINTS: Record<WorkRefResolution, string> = {
  explicit: "The reference itself named the host and repository.",
  sessionContext:
    "The repository was taken from this session, not from the reference; a mention of another repository would make it wrong.",
  unresolved:
    "No repository could be determined for this reference. It is kept as a searchable label.",
};

/** A bare decimal issue/PR number, excluding zero and leading-zero forms. */
function positiveNumber(value: string): string | null {
  return /^[1-9]\d*$/.test(value) ? value : null;
}

/** A hostname the reference supplied, with no scheme, path or credentials. */
function usableHost(host: string | null): string | null {
  if (!host) return null;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)
    ? host
    : null;
}

/** `owner/name`, the only repository shape the source records. */
function usableRepository(repository: string | null): string | null {
  if (!repository) return null;
  return /^[\w.-]+\/[\w.-]+$/.test(repository) ? repository : null;
}

/** The URL path segment and value for a reference, or `null` when it has none. */
function linkTarget(ref: StoredWorkRef): string | null {
  if (ref.kind === "gitRef") return ref.shaShaped ? `commit/${ref.normalizedValue}` : null;
  const segment = ref.kind === "pullRequest" ? "pull" : ref.kind === "issue" ? "issues" : null;
  const number = positiveNumber(ref.normalizedValue);
  return segment && number ? `${segment}/${number}` : null;
}

/**
 * The URL to open, or `null` when none can be justified.
 *
 * A reference that already carries an absolute HTTP(S) URL is preferred: it is
 * the reference's own evidence. Otherwise a URL is assembled from the host and
 * repository the reference named, or, for a bare reference, from the session's
 * own repository on a host the session is known to use.
 */
function resolveHref(ref: StoredWorkRef, context: WorkRefContext): string | null {
  let host: string | null = null;
  let repository: string | null = null;
  if (ref.resolution === "explicit") {
    const fromRaw = parseExternalUrl(ref.rawValue);
    if (fromRaw) return fromRaw.href;
    host = usableHost(ref.resolvedHost);
    repository = usableRepository(ref.resolvedRepository);
  } else if (ref.resolution === "sessionContext") {
    host = usableHost(context.sessionHost);
    repository = usableRepository(ref.candidateRepository ?? ref.resolvedRepository);
  }
  const target = linkTarget(ref);
  if (!host || !repository || !target) return null;

  // Re-parsed rather than trusted: the pieces are source data, and
  // `parseExternalUrl` is the same guard every other external link uses.
  return parseExternalUrl(`https://${host}/${repository}/${target}`)?.href ?? null;
}

const SEARCH_QUALIFIERS: Record<string, string> = {
  pullRequest: "pr",
  issue: "issue",
  gitRef: "commit",
};

/** `pr:123`, `issue:4` or `commit:<ref>`, quoted when the value has spaces. */
function searchQuery(ref: StoredWorkRef): string | null {
  const qualifier = SEARCH_QUALIFIERS[ref.kind];
  const value = positiveNumber(ref.normalizedValue) ?? ref.normalizedValue;
  if (!qualifier || !value || value.includes('"')) return null;
  return /\s/.test(value) ? `${qualifier}:"${value}"` : `${qualifier}:${value}`;
}

function displayValue(ref: StoredWorkRef): string {
  if (ref.kind === "pullRequest" || ref.kind === "issue") {
    const number = positiveNumber(ref.normalizedValue);
    if (number) return `#${number}`;
  }
  return ref.normalizedValue || ref.rawValue;
}

const NO_CONTEXT: WorkRefContext = { sessionHost: null };

export function toWorkRefRow(ref: StoredWorkRef, context: WorkRefContext = NO_CONTEXT): WorkRefRow {
  const href = resolveHref(ref, context);
  const explicitRepository = usableRepository(ref.resolvedRepository);
  const verified = ref.resolution === "explicit" && explicitRepository !== null;
  const repository = verified
    ? explicitRepository
    : usableRepository(ref.candidateRepository ?? ref.resolvedRepository);
  const value = displayValue(ref);

  return {
    identity: ref.identity,
    kind: ref.kind,
    kindLabel: KIND_LABELS[ref.kind] ?? ref.kind,
    displayValue: value,
    rawValue: ref.rawValue,
    presentation: href ? "link" : ref.resolution === "unresolved" ? "label" : "context",
    href,
    linkInferred: href !== null && !verified,
    // `owner/name#123` is GitHub's own cross-repository shorthand.
    copyText: repository && value.startsWith("#") ? `${repository}${value}` : value,
    searchQuery: searchQuery(ref),
    group: ref.kind === "gitRef" ? (ref.shaShaped ? "commit" : "branch") : ref.kind,
    repository,
    repositoryVerified: verified,
    host: ref.resolution === "explicit" ? usableHost(ref.resolvedHost) : null,
    shaCandidate: ref.kind === "gitRef" && ref.shaShaped,
    resolution: ref.resolution,
    resolutionLabel: RESOLUTION_LABELS[ref.resolution] ?? ref.resolution,
    resolutionTone: RESOLUTION_TONES[ref.resolution] ?? "neutral",
    resolutionHint: RESOLUTION_HINTS[ref.resolution] ?? "",
  };
}

export function toWorkRefRows(
  refs: readonly StoredWorkRef[],
  context: WorkRefContext = NO_CONTEXT,
): WorkRefRow[] {
  return refs.map((ref) => toWorkRefRow(ref, context));
}

export interface WorkRefGroup {
  /** The group key: a kind, or `commit`/`branch` for the two sides of Git refs. */
  kind: string;
  label: string;
  rows: WorkRefRow[];
}

const GROUP_ORDER = ["pullRequest", "issue", "commit", "branch"];
const GROUP_LABELS: Record<string, string> = {
  pullRequest: "Pull requests",
  issue: "Issues",
  commit: "Commits",
  branch: "Branches and other refs",
};

function numericValue(row: WorkRefRow): number | null {
  const match = /^#([1-9]\d*)$/.exec(row.displayValue);
  return match ? Number(match[1]) : null;
}

function compareRows(a: WorkRefRow, b: WorkRefRow): number {
  const left = numericValue(a);
  const right = numericValue(b);
  if (left !== null && right !== null) return left - right;
  if (left !== null) return -1;
  if (right !== null) return 1;
  return a.displayValue.localeCompare(b.displayValue);
}

/**
 * Rows grouped by kind — pull requests, issues, commits, branches and other
 * Git refs, then anything the source added later — with numbers in numeric
 * order inside each group.
 */
export function groupWorkRefRows(rows: readonly WorkRefRow[]): WorkRefGroup[] {
  const byKind = new Map<string, WorkRefRow[]>();
  for (const row of rows) {
    const list = byKind.get(row.group) ?? [];
    list.push(row);
    byKind.set(row.group, list);
  }
  const rank = (kind: string) => {
    const index = GROUP_ORDER.indexOf(kind);
    return index === -1 ? GROUP_ORDER.length : index;
  };
  return [...byKind.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([kind, list]) => ({
      kind,
      label: GROUP_LABELS[kind] ?? list[0]?.kindLabel ?? kind,
      rows: [...list].sort(compareRows),
    }));
}

/**
 * The one repository every unverified reference was placed in, if there is
 * exactly one. Stating it once for the panel replaces a warning on every row;
 * when references disagree, each row names its own instead.
 */
export function sharedContextRepository(rows: readonly WorkRefRow[]): string | null {
  const repositories = new Set(
    rows
      .filter((row) => !row.repositoryVerified && row.repository)
      .map((row) => row.repository as string),
  );
  return repositories.size === 1 ? [...repositories][0] : null;
}

/** Everything a chip leaves out, for its tooltip. */
export function workRefTooltip(row: WorkRefRow): string {
  const parts = [`${row.kindLabel}: ${row.rawValue}`];
  if (row.repository) {
    parts.push(row.repositoryVerified ? row.repository : `${row.repository} (from this session)`);
  }
  if (row.host) parts.push(row.host);
  if (row.shaCandidate) parts.push("Looks like a commit SHA; it may not exist on the remote.");
  if (row.resolution !== "unresolved") parts.push(row.resolutionHint);
  parts.push(row.href ? "Click to open · right-click for more" : "Click for actions");
  return parts.join("\n");
}
