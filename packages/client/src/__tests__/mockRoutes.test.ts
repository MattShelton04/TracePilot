import type { PullRequestRefreshResult, SessionPullRequest } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { IPC_COMMANDS } from "../commands.js";
import { MOCK_ROUTE_TABLES, mockRoute } from "../mock/routes/index.js";
import { MOCK_SESSIONS } from "../mock/sessions.js";
import {
  getSessionPullRequests,
  refreshListPullRequests,
  refreshSessionPullRequests,
} from "../sessions.js";

describe("mock route tables", () => {
  it("answer each command from one table only", () => {
    const owners = new Map<string, string[]>();
    for (const [table, routes] of Object.entries(MOCK_ROUTE_TABLES))
      for (const cmd of Object.keys(routes)) owners.set(cmd, [...(owners.get(cmd) ?? []), table]);
    const shared = [...owners].filter(([, tables]) => tables.length > 1);
    expect(shared).toEqual([]);
  });

  it("only route registered commands", () => {
    const known = new Set<string>(IPC_COMMANDS);
    const routed = Object.values(MOCK_ROUTE_TABLES).flatMap((routes) => Object.keys(routes));
    expect(routed.filter((cmd) => !known.has(cmd))).toEqual([]);
  });

  it("rejects an unknown command", () => {
    expect(() => mockRoute("no_such_command")).toThrow("[STUB] No mock data for command");
    expect(() => mockRoute("constructor")).toThrow("[STUB]");
  });
});

describe("mock pull requests", () => {
  it("links each session's list item to its primary pull request", () => {
    for (const session of MOCK_SESSIONS) {
      const linked = mockRoute("get_session_pull_requests", {
        sessionId: session.id,
      }) as SessionPullRequest[];
      const primary = linked.find((pr) => pr.primary);
      expect(linked.filter((pr) => pr.primary).length).toBe(linked.length ? 1 : 0);
      // The list counts transcript links only, not branch lookups.
      const counted = linked.filter((pr) => !pr.foundByBranch);
      expect(session.linkedPullRequests ?? null).toEqual(
        primary
          ? {
              count: counted.length,
              primary: {
                host: primary.host,
                owner: primary.owner,
                repo: primary.repo,
                number: primary.number,
                url: primary.url,
                state: primary.status?.state ?? null,
              },
            }
          : null,
      );
    }
    expect(MOCK_SESSIONS.filter((s) => s.linkedPullRequests).length).toBeGreaterThan(1);
  });

  it("answers an unknown session with none", () => {
    expect(mockRoute("get_session_pull_requests", { sessionId: "nope" })).toEqual([]);
  });

  it("calls the command through the client wrapper", async () => {
    const prs = await getSessionPullRequests("sess-claude-code-review");
    expect(prs.map((pr) => pr.number)).toEqual([1046, 1031, 1012]);
    expect(prs[0]).toMatchObject({ primary: true, roles: ["created"], foundByBranch: false });
    expect(prs[0].status).toMatchObject({ state: "open", checksState: "success" });
  });

  it("shows a status error, a pull request with no status and one found by branch", () => {
    const review = mockRoute("get_session_pull_requests", {
      sessionId: "sess-claude-code-review",
    }) as SessionPullRequest[];
    expect(review[2].status).toMatchObject({ state: null, error: expect.any(String) });
    const search = mockRoute("get_session_pull_requests", {
      sessionId: "sess-search-polish",
    }) as SessionPullRequest[];
    expect(search.map((pr) => [pr.number, pr.status?.state ?? null, pr.foundByBranch])).toEqual([
      [988, null, false],
      [990, "draft", true],
    ]);
  });

  it("refreshes a session's pull requests through the client wrapper", async () => {
    const result = await refreshSessionPullRequests("sess-claude-code-review", true);
    expect(result).toMatchObject({ lookup: "ok", linksChanged: false });
    expect(result.updated.map((ref) => [ref.number, ref.state])).toEqual([
      [1046, "open"],
      [1031, "merged"],
    ]);
  });

  it("refreshes the list's primary pull requests through the client wrapper", async () => {
    const result: PullRequestRefreshResult = await refreshListPullRequests([
      "sess-search-polish",
      "sess-auth-refactor",
      "sess-claude-code-review",
    ]);
    expect(result.lookup).toBe("ok");
    expect(result.updated.map((ref) => [ref.number, ref.state])).toEqual([
      [988, "open"],
      [1046, "open"],
    ]);
    expect(mockRoute("refresh_list_pull_requests", {})).toEqual({
      lookup: "ok",
      updated: [],
      linksChanged: false,
    });
  });
});
