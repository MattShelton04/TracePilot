/**
 * Presentation model for linked-work references read from the Copilot CLI's
 * own session store.
 *
 * A reference is evidence that a value was *mentioned* in a session. It is not
 * evidence that the work exists, that the session opened it, or that the
 * repository the number belongs to is the session's repository. The rules here
 * exist so the UI cannot quietly upgrade a guess into a link:
 *
 *   - only `resolution: "explicit"` may produce a navigable URL;
 *   - a host is only ever taken from the reference itself, never defaulted to
 *     github.com, because the same `#123` on GitHub Enterprise points at a
 *     different issue;
 *   - `kind: "gitRef"` is a Git ref. `shaShaped` says the text looks like a
 *     SHA, which is not the same as a commit that exists.
 */

import type { StoredWorkRef, WorkRefResolution } from "@tracepilot/types";
import type { StatusPillTone } from "@tracepilot/ui";
import { parseExternalUrl } from "@/utils/openExternal";

/** How a row may be acted on. */
export type WorkRefPresentation =
  /** Verified enough to open externally. */
  | "link"
  /** Repository shown as unverified context; deliberately not clickable. */
  | "context"
  /** Searchable text only. */
  | "label";

export interface WorkRefRow {
  identity: string;
  kindLabel: string;
  /** Short identifier shown first, e.g. `#844` or a branch name. */
  displayValue: string;
  /** The value exactly as the source recorded it. */
  rawValue: string;
  presentation: WorkRefPresentation;
  /** Present only when `presentation === "link"`. */
  href: string | null;
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
  explicit: "The reference itself named the host and repository, so it can be opened.",
  sessionContext:
    "The repository was taken from this session, not from the reference. A mention of another repository would make it wrong, so it is shown as context rather than a link.",
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

/**
 * The URL to open, or `null` when none can be justified.
 *
 * A reference that already carries an absolute HTTP(S) URL is preferred: it is
 * the reference's own evidence. Otherwise a URL is only assembled when the ref
 * itself supplied both host and repository and the value is a valid number.
 */
function resolveHref(ref: StoredWorkRef): string | null {
  if (ref.resolution !== "explicit") return null;

  const fromRaw = parseExternalUrl(ref.rawValue);
  if (fromRaw) return fromRaw.href;

  const host = usableHost(ref.resolvedHost);
  const repository = usableRepository(ref.resolvedRepository);
  if (!host || !repository) return null;

  const segment = ref.kind === "pullRequest" ? "pull" : ref.kind === "issue" ? "issues" : null;
  if (!segment) return null;

  const number = positiveNumber(ref.normalizedValue);
  if (!number) return null;

  // Re-parsed rather than trusted: the pieces are source data, and
  // `parseExternalUrl` is the same guard every other external link uses.
  return parseExternalUrl(`https://${host}/${repository}/${segment}/${number}`)?.href ?? null;
}

function displayValue(ref: StoredWorkRef): string {
  if (ref.kind === "pullRequest" || ref.kind === "issue") {
    const number = positiveNumber(ref.normalizedValue);
    if (number) return `#${number}`;
  }
  return ref.normalizedValue || ref.rawValue;
}

export function toWorkRefRow(ref: StoredWorkRef): WorkRefRow {
  const href = resolveHref(ref);
  const explicitRepository = usableRepository(ref.resolvedRepository);
  const verified = ref.resolution === "explicit" && explicitRepository !== null;

  return {
    identity: ref.identity,
    kindLabel: KIND_LABELS[ref.kind] ?? ref.kind,
    displayValue: displayValue(ref),
    rawValue: ref.rawValue,
    presentation: href ? "link" : ref.resolution === "unresolved" ? "label" : "context",
    href,
    repository: verified
      ? explicitRepository
      : usableRepository(ref.candidateRepository ?? ref.resolvedRepository),
    repositoryVerified: verified,
    host: ref.resolution === "explicit" ? usableHost(ref.resolvedHost) : null,
    shaCandidate: ref.kind === "gitRef" && ref.shaShaped,
    resolution: ref.resolution,
    resolutionLabel: RESOLUTION_LABELS[ref.resolution] ?? ref.resolution,
    resolutionTone: RESOLUTION_TONES[ref.resolution] ?? "neutral",
    resolutionHint: RESOLUTION_HINTS[ref.resolution] ?? "",
  };
}

export function toWorkRefRows(refs: readonly StoredWorkRef[]): WorkRefRow[] {
  return refs.map(toWorkRefRow);
}
