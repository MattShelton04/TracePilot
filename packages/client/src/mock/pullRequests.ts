import type {
  LinkedPullRequests,
  PullRequestRef,
  PullRequestRefreshResult,
  PullRequestStatus,
  SessionPullRequest,
} from "@tracepilot/types";
import { ONE_HOUR, ts } from "./common.js";

function pr(
  number: number,
  fields: Partial<SessionPullRequest> & Pick<SessionPullRequest, "roles">,
): SessionPullRequest {
  return {
    host: "github.com",
    owner: "example",
    repo: "orchard",
    number,
    url: `https://github.com/example/orchard/pull/${number}`,
    primary: false,
    headRef: null,
    baseRef: null,
    title: null,
    firstSeenAt: null,
    lastSeenAt: null,
    eventIndex: null,
    // GitHub is not asked yet, so the state is unknown.
    status: null,
    foundByBranch: false,
    ...fields,
  };
}

function status(fields: Partial<PullRequestStatus>): PullRequestStatus {
  return {
    state: null,
    title: null,
    mergedAt: null,
    closedAt: null,
    reviewDecision: null,
    checksState: null,
    fetchedAt: ts(-ONE_HOUR / 2),
    error: null,
    ...fields,
  };
}

/** Pull requests the mock sessions are linked to, primary first. */
const MOCK_SESSION_PULL_REQUESTS: Record<string, SessionPullRequest[]> = {
  "sess-claude-code-review": [
    pr(1046, {
      roles: ["created"],
      primary: true,
      headRef: "fix/index-retry",
      baseRef: "main",
      title: "Retry failed index writes with a bounded backoff",
      firstSeenAt: ts(-ONE_HOUR * 4),
      lastSeenAt: ts(-ONE_HOUR * 3),
      eventIndex: 5,
      status: status({
        state: "open",
        title: "Retry failed index writes with a bounded backoff",
        reviewDecision: "approved",
        checksState: "success",
      }),
    }),
    pr(1031, {
      roles: ["merged", "reviewed"],
      headRef: "chore/busy-timeout",
      baseRef: "main",
      title: "Pin the indexer's SQLite busy timeout",
      firstSeenAt: ts(-ONE_HOUR * 5),
      lastSeenAt: ts(-ONE_HOUR * 5),
      status: status({
        state: "merged",
        title: "Pin the indexer's SQLite busy timeout",
        mergedAt: ts(-ONE_HOUR * 5),
        checksState: "success",
      }),
    }),
    pr(1012, {
      roles: ["reviewed"],
      firstSeenAt: ts(-ONE_HOUR * 6),
      lastSeenAt: ts(-ONE_HOUR * 6),
      // GitHub couldn't find it (deleted, or no access): the state stays unknown.
      status: status({ error: "Could not resolve to a PullRequest" }),
    }),
  ],
  "sess-search-polish": [
    pr(988, {
      roles: ["updated"],
      primary: true,
      headRef: "feature/search",
      baseRef: "main",
      title: "Search presets: drop the legacy filter",
      firstSeenAt: ts(-ONE_HOUR * 70),
      lastSeenAt: ts(-ONE_HOUR * 5),
    }),
    pr(990, {
      roles: ["updated"],
      headRef: "feature/search-presets",
      baseRef: "main",
      foundByBranch: true,
      status: status({
        state: "draft",
        title: "Search presets: saved filters",
        reviewDecision: "review_required",
        checksState: "pending",
      }),
    }),
  ],
};

export function getMockSessionPullRequests(sessionId: string): SessionPullRequest[] {
  return MOCK_SESSION_PULL_REQUESTS[sessionId] ?? [];
}

function toRef(item: SessionPullRequest, state = item.status?.state ?? null): PullRequestRef {
  const { host, owner, repo, number, url } = item;
  return { host, owner, repo, number, url, state };
}

/**
 * The list item's summary of {@link getMockSessionPullRequests}. Like the
 * index's columns, it counts only links from the transcript.
 */
export function mockLinkedPullRequests(sessionId: string): LinkedPullRequests | null {
  const linked = getMockSessionPullRequests(sessionId).filter((item) => !item.foundByBranch);
  const primary = linked.find((item) => item.primary);
  if (!primary) return null;
  return { count: linked.length, primary: toRef(primary) };
}

/** GitHub's answer for a pull request never fetched: it is open. */
function refreshedRef(item: SessionPullRequest): PullRequestRef {
  return toRef(item, item.status?.state ?? "open");
}

/** `refresh_session_pull_requests`: every linked pull request with a state. */
export function mockRefreshSessionPullRequests(sessionId: string): PullRequestRefreshResult {
  const updated = getMockSessionPullRequests(sessionId)
    .filter((item) => !item.status?.error)
    .map(refreshedRef);
  return { lookup: "ok", updated, linksChanged: false };
}

/** `refresh_list_pull_requests`: the primary pull requests of those sessions. */
export function mockRefreshListPullRequests(sessionIds: unknown): PullRequestRefreshResult {
  const ids = Array.isArray(sessionIds) ? sessionIds.filter((id) => typeof id === "string") : [];
  const updated = ids.flatMap((id) => {
    const primary = getMockSessionPullRequests(id).find((item) => item.primary);
    return primary ? [refreshedRef(primary)] : [];
  });
  return { lookup: "ok", updated, linksChanged: false };
}
