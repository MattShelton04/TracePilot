import type { SessionListItem } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { buildSearchFieldCache, matchesSessionFilters, parseSearchTerms } from "../filtering";

describe("stores/sessions/filtering – parseSearchTerms", () => {
  it("lower-cases and splits on any whitespace", () => {
    expect(parseSearchTerms("Login  FIX\tbug\n")).toEqual(["login", "fix", "bug"]);
    expect(parseSearchTerms("export")).toEqual(["export"]);
  });

  it("yields no terms for a blank query", () => {
    expect(parseSearchTerms("")).toEqual([]);
    expect(parseSearchTerms("   ")).toEqual([]);
  });
});

describe("stores/sessions/filtering – multi-word search", () => {
  const session = {
    id: "aaa-111",
    summary: "Refactor search store",
    repository: "org/repo-one",
    branch: "main",
    turnCount: 1,
  } as SessionListItem;
  const cache = buildSearchFieldCache([session]);
  const matches = (searchTerms: string[]) =>
    matchesSessionFilters(
      session,
      { searchTerms, repository: null, hideEmptySessions: false },
      cache,
    );

  it("requires every term, each in any field and in any order", () => {
    // "store" is only in the summary, "repo-one" only in the repository.
    expect(matches(["store", "repo-one"])).toBe(true);
    expect(matches(["repo-one", "store"])).toBe(true);
    expect(matches(["store", "repo-two"])).toBe(false);
  });

  it("does not filter with no terms", () => {
    expect(matches([])).toBe(true);
  });
});
