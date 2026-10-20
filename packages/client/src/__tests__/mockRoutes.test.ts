import type { SessionPullRequest } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { IPC_COMMANDS } from "../commands.js";
import { MOCK_ROUTE_TABLES, mockRoute } from "../mock/routes/index.js";
import { MOCK_SESSIONS } from "../mock/sessions.js";
import {
  getPullRequestSessions,
  getSessionPullRequestRelatedCounts,
  getSessionPullRequests,
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
      expect(session.linkedPullRequests ?? null).toEqual(
        primary
          ? {
              count: linked.length,
              primary: {
                host: primary.host,
                owner: primary.owner,
                repo: primary.repo,
                number: primary.number,
                url: primary.url,
                state: null,
              },
              pullRequests: linked.map((pr) => ({
                owner: pr.owner,
                repo: pr.repo,
                number: pr.number,
                title: pr.title,
              })),
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
    expect(prs[0]).toMatchObject({ primary: true, roles: ["created"], status: null });
  });

  it("lists the sessions linked to a pull request, ignoring case", async () => {
    const sessions = await getPullRequestSessions({
      host: "GitHub.com",
      owner: "Example",
      repo: "ORCHARD",
      number: 1046,
    });
    const session = MOCK_SESSIONS.find((s) => s.id === "sess-claude-code-review");
    expect(sessions).toEqual([
      {
        sessionId: "sess-claude-code-review",
        summary: session?.summary ?? null,
        repository: session?.repository ?? null,
        source: session?.source ?? "copilot",
        updatedAt: session?.updatedAt ?? null,
        roles: ["created"],
      },
    ]);
    expect(
      mockRoute("get_pull_request_sessions", {
        host: "github.com",
        owner: "example",
        repo: "orchard",
        number: 10460,
      }),
    ).toEqual([]);
  });

  it("counts only pull requests other sessions link", async () => {
    // No two mock sessions share a pull request.
    expect(await getSessionPullRequestRelatedCounts("sess-claude-code-review")).toEqual([]);
    expect(mockRoute("get_session_pull_request_related_counts", { sessionId: "nope" })).toEqual([]);
  });
});
