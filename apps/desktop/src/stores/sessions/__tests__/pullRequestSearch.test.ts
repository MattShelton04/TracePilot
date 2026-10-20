import type { LinkedPullRequestSummary, SessionListItem } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  buildSearchFieldCache,
  filterAndSortSessions,
  parseSearchTerms,
  type SessionFilterPredicates,
} from "../filtering";

function session(
  id: string,
  pullRequests: LinkedPullRequestSummary[] = [],
  extra: Partial<SessionListItem> = {},
): SessionListItem {
  return {
    id,
    summary: `Session ${id}`,
    repository: "example/orchard",
    turnCount: 1,
    updatedAt: `2026-01-0${id.length}T00:00:00Z`,
    linkedPullRequests: pullRequests.length
      ? {
          count: pullRequests.length,
          primary: {
            host: "github.com",
            ...pullRequests[0],
            url: "",
            state: null,
          },
          pullRequests,
        }
      : null,
    ...extra,
  } as SessionListItem;
}

const pr = (number: number, title: string | null = null, owner = "Example", repo = "Orchard") => ({
  owner,
  repo,
  number,
  title,
});

const sessions = [
  session("a", [pr(57, "Retry index writes")]),
  session("bb", [pr(570), pr(12, "Parser cleanup", "other", "tools")]),
  session("ccc"),
  session("dddd", [pr(57, null, "other", "tools")], { source: "claudeCode" }),
];
const cache = buildSearchFieldCache(sessions);

function find(query: string, predicates: Partial<SessionFilterPredicates> = {}): string[] {
  return filterAndSortSessions(
    sessions,
    {
      searchTerms: parseSearchTerms(query),
      repository: null,
      hideEmptySessions: false,
      ...predicates,
    },
    cache,
    "oldest",
  ).map((s) => s.id);
}

describe("stores/sessions/filtering – linked pull requests", () => {
  it("matches #n exactly, in any repository", () => {
    expect(find("#57")).toEqual(["a", "dddd"]);
    expect(find("#570")).toEqual(["bb"]);
    expect(find("#5")).toEqual([]);
  });

  it("matches owner/repo#n exactly and case-insensitively", () => {
    expect(find("example/orchard#57")).toEqual(["a"]);
    expect(find("EXAMPLE/Orchard#57")).toEqual(["a"]);
    expect(find("other/tools#57")).toEqual(["dddd"]);
    expect(find("example/orchard#5")).toEqual([]);
  });

  it("matches a bare number as a substring, like the other fields", () => {
    expect(find("57")).toEqual(["a", "bb", "dddd"]);
  });

  it("matches owner/repo and title words", () => {
    expect(find("other/tools")).toEqual(["bb", "dddd"]);
    expect(find("retry writes")).toEqual(["a"]);
    expect(find("parser")).toEqual(["bb"]);
  });

  it("finds sessions by a typed pull request URL", () => {
    expect(find("https://github.com/other/tools/pull/57/files")).toEqual(["dddd"]);
  });

  it("combines with other terms and filters", () => {
    expect(find("#57 retry")).toEqual(["a"]);
    expect(find("#57", { source: "claudeCode" })).toEqual(["dddd"]);
    expect(find("#12 session")).toEqual(["bb"]);
  });

  it("leaves sessions without pull requests to their other fields", () => {
    expect(find("ccc")).toEqual(["ccc"]);
    expect(find("#1")).toEqual([]);
  });

  it("keeps a #n term matching other fields as text", () => {
    const withMention = [session("e", [], { summary: "Follow up on #57" })];
    const result = filterAndSortSessions(
      withMention,
      { searchTerms: ["#57"], repository: null, hideEmptySessions: false },
      buildSearchFieldCache(withMention),
      "updated",
    );
    expect(result.map((s) => s.id)).toEqual(["e"]);
  });
});
