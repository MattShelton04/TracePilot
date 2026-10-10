import type {
  SearchFacetsResponse,
  SearchResultsResponse,
  SearchToolName,
} from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { searchMockRoute } from "../mock/search.js";

function search(args: Record<string, unknown>) {
  return searchMockRoute("search_content", args)?.value as SearchResultsResponse;
}

describe("search mock route", () => {
  it("filters results and facets by source, like the backend", () => {
    const all = search({ query: "retry" });
    const claude = search({ query: "retry", source: "claudeCode" });
    const copilot = search({ query: "retry", source: "copilot" });
    expect(claude.totalCount).toBeGreaterThan(0);
    expect(copilot.totalCount).toBeGreaterThan(0);
    expect(claude.totalCount + copilot.totalCount).toBe(all.totalCount);
    expect(new Set(claude.results.map((r) => r.sessionId))).toEqual(
      new Set(["sess-claude-code-review"]),
    );

    const facets = searchMockRoute("get_search_facets", { query: "retry", source: "claudeCode" })
      ?.value as SearchFacetsResponse;
    expect(facets.totalMatches).toBe(claude.totalCount);
    expect(facets.sessionCount).toBe(1);
  });

  it("gives each row its source and Claude tool rows their native name", () => {
    const claude = search({ query: "retry", source: "claudeCode" });
    expect(claude.results.every((r) => r.source === "claudeCode")).toBe(true);
    expect(
      search({ query: "retry", source: "copilot" }).results.map((r) => r.source),
    ).not.toContain("claudeCode");
    const shell = searchMockRoute("get_search_tool_names")?.value as SearchToolName[];
    expect(shell.find((t) => t.name === "shell")).toEqual({
      name: "shell",
      nativeNames: ["Bash"],
      sources: ["claudeCode"],
    });
    expect(shell.find((t) => t.name === "powershell")?.nativeNames).toEqual([]);
  });

  it("leaves other commands to the shared table", () => {
    expect(searchMockRoute("fts_health")).toBeNull();
  });
});
