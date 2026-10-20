/**
 * Display helpers for the pull requests a session is linked to: the header
 * chip's tooltip, the Overview section's groups, and the jump from a pull
 * request's event to its conversation turn.
 */
import {
  type ConversationTurn,
  type PullRequestRole,
  pullRequestRoleSentence,
  pullRequestSlug,
  type SessionPullRequest,
  sessionPullRequestTitle,
} from "@tracepilot/types";

/** The pull request that stands for the session (the list is primary first). */
export function primaryPullRequest(prs: readonly SessionPullRequest[]): SessionPullRequest | null {
  return prs.find((pr) => pr.primary) ?? prs[0] ?? null;
}

/** `head → base`, or null when the transcript named neither. */
export function pullRequestBranches(pr: SessionPullRequest): string | null {
  if (!pr.headRef && !pr.baseRef) return null;
  return `${pr.headRef ?? "?"} → ${pr.baseRef ?? "?"}`;
}

/** Title line, branches and role, one per line. */
export function pullRequestTooltip(pr: SessionPullRequest): string {
  const title = sessionPullRequestTitle(pr);
  const lines = [title ? `${pullRequestSlug(pr)} — ${title}` : pullRequestSlug(pr)];
  const branches = pullRequestBranches(pr);
  if (branches) lines.push(branches);
  const role = pullRequestRoleSentence(pr.roles);
  if (role) lines.push(role);
  return lines.join("\n");
}

export type PullRequestGroupKey = "authored" | "merged" | "reviewed";

export interface PullRequestGroup {
  key: PullRequestGroupKey;
  /** Subheading, shown only when the session has more than one group. */
  label: string;
  prs: SessionPullRequest[];
  /** Long groups start collapsed behind a summary line. */
  collapsed: boolean;
  /** The collapsed group's summary, e.g. "Merged 23 pull requests". */
  summary: string;
}

/** A group longer than this starts collapsed. */
export const PULL_REQUEST_GROUP_LIMIT = 5;

const GROUP_OF: Record<PullRequestRole, PullRequestGroupKey> = {
  created: "authored",
  updated: "authored",
  merged: "merged",
  reviewed: "reviewed",
  mentioned: "reviewed",
};

const GROUP_LABELS: Record<PullRequestGroupKey, { label: string; verb: string }> = {
  authored: { label: "Created or updated", verb: "Created or updated" },
  merged: { label: "Merged", verb: "Merged" },
  reviewed: { label: "Reviewed", verb: "Reviewed or mentioned" },
};

/**
 * Groups by strongest role, keeping the list's order: what the session
 * created or updated, then what it only merged, then what it only read or
 * was given.
 */
export function groupPullRequests(prs: readonly SessionPullRequest[]): PullRequestGroup[] {
  const byKey = new Map<PullRequestGroupKey, SessionPullRequest[]>();
  for (const pr of prs) {
    const key = GROUP_OF[pr.roles[0] ?? "mentioned"];
    byKey.set(key, [...(byKey.get(key) ?? []), pr]);
  }
  return (["authored", "merged", "reviewed"] as const)
    .filter((key) => byKey.has(key))
    .map((key) => {
      const items = byKey.get(key) ?? [];
      return {
        key,
        label: GROUP_LABELS[key].label,
        prs: items,
        collapsed: items.length > PULL_REQUEST_GROUP_LIMIT,
        summary: `${GROUP_LABELS[key].verb} ${items.length} pull requests`,
      };
    });
}

/**
 * The conversation turn holding an event: the turn whose tool call started
 * at it, else the last turn that opened at or before it.
 */
export function turnForEvent(
  turns: readonly ConversationTurn[],
  eventIndex: number,
): ConversationTurn | null {
  const exact = turns.find((turn) => turn.toolCalls.some((tc) => tc.eventIndex === eventIndex));
  if (exact) return exact;
  let best: ConversationTurn | null = null;
  for (const turn of turns) {
    if (turn.eventIndex != null && turn.eventIndex <= eventIndex) {
      if (!best || (best.eventIndex ?? -1) < turn.eventIndex) best = turn;
    }
  }
  return best;
}
