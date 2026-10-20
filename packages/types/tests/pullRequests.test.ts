import { describe, expect, it } from "vitest";
import {
  type PullRequestStatus,
  pullRequestChecks,
  pullRequestRefreshChanged,
  pullRequestReviewLabel,
  type SessionPullRequest,
  sessionPullRequestTitle,
} from "../src/pullRequests.js";

function linked(
  title: string | null,
  status: Partial<PullRequestStatus> | null,
): SessionPullRequest {
  return {
    host: "github.com",
    owner: "example",
    repo: "orchard",
    number: 7,
    url: "https://github.com/example/orchard/pull/7",
    roles: ["created"],
    primary: true,
    headRef: null,
    baseRef: null,
    title,
    firstSeenAt: null,
    lastSeenAt: null,
    eventIndex: null,
    status: status
      ? {
          state: null,
          title: null,
          mergedAt: null,
          closedAt: null,
          reviewDecision: null,
          checksState: null,
          fetchedAt: "2026-10-01T00:00:00Z",
          error: null,
          ...status,
        }
      : null,
    foundByBranch: false,
  };
}

describe("pullRequestChecks", () => {
  it.each([
    ["success", "Checks passing", "success"],
    ["failure", "Checks failing", "danger"],
    ["error", "Checks failing", "danger"],
    ["pending", "Checks pending", "warning"],
    ["expected", "Checks pending", "warning"],
    ["SUCCESS", "Checks passing", "success"],
  ])("reads %s as %s", (state, label, tone) => {
    expect(pullRequestChecks(state)).toEqual({ label, tone });
  });

  it("is null for no rollup or one it doesn't know", () => {
    expect(pullRequestChecks(null)).toBeNull();
    expect(pullRequestChecks(undefined)).toBeNull();
    expect(pullRequestChecks("")).toBeNull();
    expect(pullRequestChecks("skipped")).toBeNull();
    expect(pullRequestChecks("constructor")).toBeNull();
  });
});

describe("pullRequestReviewLabel", () => {
  it("names each review decision", () => {
    expect(pullRequestReviewLabel("approved")).toBe("Approved");
    expect(pullRequestReviewLabel("changes_requested")).toBe("Changes requested");
    expect(pullRequestReviewLabel("REVIEW_REQUIRED")).toBe("Review required");
  });

  it("is null for none or an unknown decision", () => {
    expect(pullRequestReviewLabel(null)).toBeNull();
    expect(pullRequestReviewLabel("dismissed")).toBeNull();
    expect(pullRequestReviewLabel("toString")).toBeNull();
  });
});

describe("sessionPullRequestTitle", () => {
  it("prefers GitHub's title over the transcript's", () => {
    expect(sessionPullRequestTitle(linked("Draft name", { title: "Final name" }))).toBe(
      "Final name",
    );
  });

  it("falls back to the transcript's title, then null", () => {
    expect(sessionPullRequestTitle(linked("Draft name", { title: "  " }))).toBe("Draft name");
    expect(sessionPullRequestTitle(linked("Draft name", null))).toBe("Draft name");
    expect(sessionPullRequestTitle(linked(null, null))).toBeNull();
  });
});

describe("pullRequestRefreshChanged", () => {
  const ref = {
    host: "github.com",
    owner: "example",
    repo: "orchard",
    number: 7,
    url: "https://github.com/example/orchard/pull/7",
    state: "open" as const,
  };

  it("is true when a status was written or a link changed", () => {
    expect(pullRequestRefreshChanged({ lookup: "ok", updated: [ref], linksChanged: false })).toBe(
      true,
    );
    expect(pullRequestRefreshChanged({ lookup: "ok", updated: [], linksChanged: true })).toBe(true);
    expect(pullRequestRefreshChanged({ lookup: "ok", updated: [], linksChanged: false })).toBe(
      false,
    );
  });
});
