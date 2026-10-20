import type { LinkedPullRequests, SessionPullRequest } from "@tracepilot/types";
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
    }),
    pr(1031, {
      roles: ["merged", "reviewed"],
      headRef: "chore/busy-timeout",
      baseRef: "main",
      title: "Pin the indexer's SQLite busy timeout",
      firstSeenAt: ts(-ONE_HOUR * 5),
      lastSeenAt: ts(-ONE_HOUR * 5),
    }),
    pr(1012, {
      roles: ["reviewed"],
      firstSeenAt: ts(-ONE_HOUR * 6),
      lastSeenAt: ts(-ONE_HOUR * 6),
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
  ],
};

export function getMockSessionPullRequests(sessionId: string): SessionPullRequest[] {
  return MOCK_SESSION_PULL_REQUESTS[sessionId] ?? [];
}

/** The list item's summary of {@link getMockSessionPullRequests}. */
export function mockLinkedPullRequests(sessionId: string): LinkedPullRequests | null {
  const linked = getMockSessionPullRequests(sessionId);
  const primary = linked.find((item) => item.primary);
  if (!primary) return null;
  const { host, owner, repo, number, url } = primary;
  return {
    count: linked.length,
    primary: { host, owner, repo, number, url, state: primary.status?.state ?? null },
  };
}
