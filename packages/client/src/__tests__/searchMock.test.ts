import type { SearchFacetsResponse, SearchResultsResponse } from "@tracepilot/types";
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

  it("leaves other commands to the shared table", () => {
    expect(searchMockRoute("fts_health")).toBeNull();
  });
});
