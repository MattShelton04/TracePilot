import type { ConversationTurn } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  groupPullRequests,
  primaryPullRequest,
  pullRequestTooltip,
  turnForEvent,
} from "@/utils/pullRequests";
import { makePullRequest } from "./pullRequestFixtures";

describe("pull request helpers", () => {
  it("picks the primary pull request, else the first", () => {
    const a = makePullRequest(1, ["reviewed"]);
    const b = makePullRequest(2, ["created"], { primary: true });
    expect(primaryPullRequest([a, b])).toBe(b);
    expect(primaryPullRequest([a])).toBe(a);
    expect(primaryPullRequest([])).toBeNull();
  });

  it("puts the title, branches and role in the tooltip", () => {
    const pr = makePullRequest(1046, ["created", "merged"], {
      title: "Retry index writes",
      headRef: "fix/retry",
      baseRef: "main",
    });
    expect(pullRequestTooltip(pr)).toBe(
      "example/orchard#1046 — Retry index writes\nfix/retry → main\nCreated in this session",
    );
    expect(pullRequestTooltip(makePullRequest(7, ["mentioned"]))).toBe(
      "example/orchard#7\nMentioned in this session",
    );
    // A host other than GitHub is always named.
    expect(pullRequestTooltip(makePullRequest(8, ["reviewed"], { host: "code.example.com" }))).toBe(
      "code.example.com/example/orchard#8\nReviewed in this session",
    );
  });

  it("groups by strongest role and collapses only groups of more than five", () => {
    const prs = [
      makePullRequest(1, ["created"]),
      ...[2, 3, 4, 5, 6, 7].map((n) => makePullRequest(n, ["merged"])),
      makePullRequest(8, ["reviewed"]),
      makePullRequest(9, ["mentioned"]),
    ];
    const groups = groupPullRequests(prs);
    expect(groups.map((g) => [g.key, g.prs.map((pr) => pr.number), g.collapsed])).toEqual([
      ["authored", [1], false],
      ["merged", [2, 3, 4, 5, 6, 7], true],
      ["reviewed", [8, 9], false],
    ]);
    expect(groups[1].summary).toBe("Merged 6 pull requests");
  });

  it("finds the turn holding an event", () => {
    const turns = [
      { turnIndex: 0, eventIndex: 1, toolCalls: [{ eventIndex: 5 }] },
      { turnIndex: 1, eventIndex: 10, toolCalls: [] },
      { turnIndex: 2, toolCalls: [{ eventIndex: 30 }] },
    ] as unknown as ConversationTurn[];
    expect(turnForEvent(turns, 5)?.turnIndex).toBe(0);
    expect(turnForEvent(turns, 12)?.turnIndex).toBe(1);
    expect(turnForEvent(turns, 30)?.turnIndex).toBe(2);
    expect(turnForEvent(turns, 0)).toBeNull();
    // A turn opened without a start event starts at its first tool call, so
    // a later record in it (a pr-link) lands there, not in the turn before.
    expect(turnForEvent(turns, 34)?.turnIndex).toBe(2);
  });
});
