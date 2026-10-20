// ─── Pull request types ───────────────────────────────────────────
// The GitHub pull requests a session is linked to. Mirrors the specta DTOs in
// packages/client/src/generated/bindings.ts (checked by the client's drift test).

import type { SessionSource } from "./sources.js";

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

/** A linked pull request as the session list searches it. */
export interface LinkedPullRequestSummary {
  owner: string;
  repo: string;
  number: number;
  /** GitHub's title when it has been fetched, else the transcript's. Untrusted display text. */
  title: string | null;
}

/**
 * How many pull requests a session is linked to, the one that stands for it,
 * and every linked one, for searching the list.
 */
export interface LinkedPullRequests {
  count: number;
  primary: PullRequestRef;
  /** Every linked pull request, primary first, then by strongest role and recency; at most 200. */
  pullRequests: LinkedPullRequestSummary[];
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
}

/** How many other sessions link one of a session's pull requests. */
export interface RelatedPullRequestCount {
  host: string;
  owner: string;
  repo: string;
  number: number;
  /** Always at least 1: pull requests no other session links are left out. */
  otherSessionCount: number;
}

/** A session linked to a pull request, for listing the sessions that share it. */
export interface PullRequestSessionLink {
  sessionId: string;
  summary: string | null;
  repository: string | null;
  source: SessionSource;
  updatedAt: string | null;
  /** What this session did with the pull request, strongest first. */
  roles: PullRequestRole[];
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

/** The recorded title, or the one GitHub reported. */
export function sessionPullRequestTitle(pr: SessionPullRequest): string | null {
  return pr.title?.trim() || pr.status?.title?.trim() || null;
}
