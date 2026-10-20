// ─── Pull request types ───────────────────────────────────────────
// The GitHub pull requests a session is linked to. Mirrors the specta DTOs in
// packages/client/src/generated/bindings.ts (checked by the client's drift test).

/** How a session took part in a pull request, strongest first. */
export type PullRequestRole = "created" | "updated" | "merged" | "reviewed" | "mentioned";

/** A pull request's state on GitHub. */
export type PullRequestState = "open" | "draft" | "closed" | "merged";

/** A pull request's last known state on GitHub. */
export interface PullRequestStatus {
  state: PullRequestState | null;
  title: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  reviewDecision: string | null;
  checksState: string | null;
  fetchedAt: string;
  /** The last lookup's failure. */
  error: string | null;
}

/** A pull request as the session list shows it. */
export interface PullRequestRef {
  host: string;
  owner: string;
  repo: string;
  number: number;
  /** Rebuilt from the parts above, never copied from a session file. */
  url: string;
  /** Null until GitHub has been asked. */
  state: PullRequestState | null;
}

/** How many pull requests a session is linked to, and the one that stands for it. */
export interface LinkedPullRequests {
  count: number;
  primary: PullRequestRef;
}

/** A pull request a session is linked to, with what the session did. */
export interface SessionPullRequest {
  host: string;
  owner: string;
  repo: string;
  number: number;
  /** Rebuilt from the parts above, never copied from a session file. */
  url: string;
  /** Strongest first. */
  roles: PullRequestRole[];
  /** The one that stands for the session in the list and header. */
  primary: boolean;
  headRef: string | null;
  baseRef: string | null;
  /** The title the transcript recorded. Untrusted display text. */
  title: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** The event that established the strongest role. */
  eventIndex: number | null;
  /** Null until GitHub has been asked. */
  status: PullRequestStatus | null;
  /** Linked only because the session pushed to the pull request's branch. */
  foundByBranch: boolean;
}

/** How the last GitHub lookup went. */
export type PullRequestLookup = "ok" | "disabled" | "notInstalled" | "signedOut" | "failed";

/** What a status refresh changed. */
export interface PullRequestRefreshResult {
  lookup: PullRequestLookup;
  /** Every pull request whose status this call wrote, with its new state. */
  updated: PullRequestRef[];
  /** Branch lookups added or removed a link for the session. */
  linksChanged: boolean;
}

/** Badge and pill tones for a pull request's state; unknown reads as neutral. */
export type PullRequestTone = "success" | "neutral" | "done" | "danger";

const STATE_TONES: Record<PullRequestState, PullRequestTone> = {
  open: "success",
  draft: "neutral",
  merged: "done",
  closed: "danger",
};

const STATE_LABELS: Record<PullRequestState, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

const ROLE_LABELS: Record<PullRequestRole, string> = {
  created: "Created",
  updated: "Updated",
  merged: "Merged",
  reviewed: "Reviewed",
  mentioned: "Mentioned",
};

const ROLE_SENTENCES: Record<PullRequestRole, string> = {
  created: "Created in this session",
  updated: "Updated in this session",
  merged: "Merged in this session",
  reviewed: "Reviewed in this session",
  mentioned: "Mentioned in this session",
};

export function pullRequestTone(state: PullRequestState | null | undefined): PullRequestTone {
  return state ? STATE_TONES[state] : "neutral";
}

/** "Merged", or null while the state is unknown. */
export function pullRequestStateLabel(state: PullRequestState | null | undefined): string | null {
  return state ? STATE_LABELS[state] : null;
}

export function pullRequestRoleLabel(role: PullRequestRole): string {
  return ROLE_LABELS[role];
}

/** "Created in this session" for the strongest role. */
export function pullRequestRoleSentence(roles: readonly PullRequestRole[]): string | null {
  return roles.length ? ROLE_SENTENCES[roles[0]] : null;
}

/** `owner/repo#n` */
export function pullRequestSlug(pr: {
  host?: string;
  owner: string;
  repo: string;
  number: number;
}): string {
  // Name any host other than GitHub, so a link never looks like it goes there.
  const host = pr.host && pr.host !== "github.com" ? `${pr.host}/` : "";
  return `${host}${pr.owner}/${pr.repo}#${pr.number}`;
}

/** The state GitHub last reported for a linked pull request. */
export function sessionPullRequestState(pr: SessionPullRequest): PullRequestState | null {
  return pr.status?.state ?? null;
}

/** The title GitHub reported, or the one the transcript recorded. */
export function sessionPullRequestTitle(pr: SessionPullRequest): string | null {
  return pr.status?.title?.trim() || pr.title?.trim() || null;
}

/** Tones for a pull request's checks summary. */
export type PullRequestChecksTone = "success" | "danger" | "warning";

/** A pull request's checks summary. */
export interface PullRequestChecks {
  label: string;
  tone: PullRequestChecksTone;
}

// GitHub's status check rollup states, lower-cased.
const CHECKS = new Map<string, PullRequestChecks>([
  ["success", { label: "Checks passing", tone: "success" }],
  ["failure", { label: "Checks failing", tone: "danger" }],
  ["error", { label: "Checks failing", tone: "danger" }],
  ["pending", { label: "Checks pending", tone: "warning" }],
  ["expected", { label: "Checks pending", tone: "warning" }],
]);

// GitHub's review decisions, lower-cased.
const REVIEW_LABELS = new Map<string, string>([
  ["approved", "Approved"],
  ["changes_requested", "Changes requested"],
  ["review_required", "Review required"],
]);

/** "Checks passing" and its tone, or null for no or an unknown rollup. */
export function pullRequestChecks(
  checksState: string | null | undefined,
): PullRequestChecks | null {
  return (checksState && CHECKS.get(checksState.toLowerCase())) || null;
}

/** "Approved", or null for no or an unknown review decision. */
export function pullRequestReviewLabel(reviewDecision: string | null | undefined): string | null {
  return (reviewDecision && REVIEW_LABELS.get(reviewDecision.toLowerCase())) || null;
}

/** Whether a refresh changed what the session's pull requests show. */
export function pullRequestRefreshChanged(result: PullRequestRefreshResult): boolean {
  return result.updated.length > 0 || result.linksChanged;
}
