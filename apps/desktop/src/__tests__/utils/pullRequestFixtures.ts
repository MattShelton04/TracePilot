import type { PullRequestRole, SessionPullRequest } from "@tracepilot/types";

/** A synthetic linked pull request on example/orchard, state unknown. */
export function makePullRequest(
  number: number,
  roles: PullRequestRole[],
  fields: Partial<SessionPullRequest> = {},
): SessionPullRequest {
  return {
    host: "github.com",
    owner: "example",
    repo: "orchard",
    number,
    url: `https://github.com/example/orchard/pull/${number}`,
    roles,
    primary: false,
    headRef: null,
    baseRef: null,
    title: null,
    firstSeenAt: null,
    lastSeenAt: null,
    eventIndex: null,
    status: null,
    ...fields,
  };
}
