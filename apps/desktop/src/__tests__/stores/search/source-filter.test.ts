// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import {
  emptySearchResponse,
  flushSearchQueue,
  mocks,
  resetAllMocks,
  setupDefaultMocks,
} from "./setup";
import { useSearchStore } from "../../../stores/search";

function lastSearch() {
  const calls = mocks.searchContent.mock.calls;
  return calls[calls.length - 1] as [string, Record<string, unknown>];
}

function lastFacets() {
  const calls = mocks.getSearchFacets.mock.calls;
  return calls[calls.length - 1] as [string | undefined, Record<string, unknown>];
}

describe("useSearchStore – source filter", () => {
  beforeEach(() => {
    setupPinia();
    resetAllMocks();
    setupDefaultMocks();
  });

  it("searches every source until one is picked", async () => {
    const store = useSearchStore();
    store.query = "retry";
    store.executeSearch();
    await flushSearchQueue();
    expect(lastSearch()[1].source).toBeUndefined();
    expect(lastFacets()[1].source).toBeUndefined();
  });

  it("a source change runs a search and scopes its facets", async () => {
    const store = useSearchStore();
    store.source = "claudeCode";
    await flushSearchQueue();
    await flushSearchQueue();

    expect(store.hasActiveFilters).toBe(true);
    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
    expect(lastSearch()[1].source).toBe("claudeCode");
    expect(lastFacets()[1].source).toBe("claudeCode");

    store.clearFilters();
    expect(store.source).toBeNull();
  });

  it("applies a source: qualifier from the query box", async () => {
    const store = useSearchStore();
    store.query = "retry source:claude";
    store.executeSearch();
    await flushSearchQueue();

    const [query, filters] = lastSearch();
    expect(query).toBe("retry");
    expect(filters.source).toBe("claudeCode");
    expect(lastFacets()).toEqual(["retry", expect.objectContaining({ source: "claudeCode" })]);
  });

  it("keeps the newest source's results when an older response lands late", async () => {
    const store = useSearchStore();
    let resolveClaude!: (v: unknown) => void;
    mocks.searchContent.mockImplementationOnce(
      () => new Promise((resolve) => (resolveClaude = resolve)),
    );
    const copilotRow = { id: 2, sessionId: "copilot-session" };
    mocks.searchContent.mockResolvedValueOnce({
      ...emptySearchResponse,
      results: [copilotRow],
      totalCount: 1,
    });

    store.source = "claudeCode";
    await flushSearchQueue();
    store.source = "copilot";
    await flushSearchQueue();
    await flushSearchQueue();
    resolveClaude({
      ...emptySearchResponse,
      results: [{ id: 1, sessionId: "claude-session" }],
      totalCount: 1,
    });
    await flushSearchQueue();

    expect(mocks.searchContent.mock.calls.map(([, f]) => f.source)).toEqual([
      "claudeCode",
      "copilot",
    ]);
    expect(store.results).toEqual([copilotRow]);
  });
});
