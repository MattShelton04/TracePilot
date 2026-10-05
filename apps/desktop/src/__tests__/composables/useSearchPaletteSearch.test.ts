import { searchContent } from "@tracepilot/client";
import { createDeferred } from "@tracepilot/test-utils";
import type { SearchContentType, SearchResult, SearchResultsResponse } from "@tracepilot/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EffectScope, effectScope, nextTick } from "vue";
import { useSearchPaletteSearch } from "@/composables/useSearchPaletteSearch";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({ searchContent: vi.fn() });
});

const mockSearch = vi.mocked(searchContent);
const scopes: EffectScope[] = [];

function setup(options: Parameters<typeof useSearchPaletteSearch>[0] = {}) {
  const scope = effectScope();
  scopes.push(scope);
  const state = scope.run(() => useSearchPaletteSearch(options))!;
  return { scope, state };
}

function result(id: number, contentType: SearchContentType = "user_message"): SearchResult {
  return {
    id,
    sessionId: `session-${id}`,
    contentType,
    turnNumber: 1,
    eventIndex: 2,
    timestampUnix: null,
    toolName: null,
    snippet: `Result ${id}`,
    metadataJson: null,
    sessionSummary: null,
    sessionRepository: null,
    sessionBranch: null,
    sessionUpdatedAt: null,
  };
}

function response(query: string, results = [result(1)]): SearchResultsResponse {
  return { results, totalCount: results.length + 10, hasMore: true, query, latencyMs: 12 };
}

async function start(state: ReturnType<typeof useSearchPaletteSearch>, query = "alpha") {
  state.query.value = query;
  await nextTick();
  await vi.advanceTimersByTimeAsync(150);
}

function expectCleared(state: ReturnType<typeof useSearchPaletteSearch>, loading = false) {
  expect(state.results.value).toEqual([]);
  expect(state.flatResults.value).toEqual([]);
  expect(state.groupedResults.value).toEqual([]);
  expect(state.hasResults.value).toBe(false);
  expect(state.totalCount.value).toBe(0);
  expect(state.latencyMs.value).toBe(0);
  expect(state.searchError.value).toBeNull();
  expect(state.loading.value).toBe(loading);
}

beforeEach(() => {
  vi.useFakeTimers();
  mockSearch.mockReset();
});

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  vi.useRealTimers();
});

describe("useSearchPaletteSearch", () => {
  it("starts empty and groups the current response for navigation", async () => {
    const { state } = setup();
    expectCleared(state);
    expect(state.hasQuery.value).toBe(false);
    const matches = [result(1), result(2, "tool_call"), result(3)];
    matches[2].sessionId = matches[0].sessionId;
    mockSearch.mockResolvedValue(response("alpha", matches));

    await start(state);

    expect(state.groupedResults.value.map((group) => group.contentType)).toEqual([
      "user_message",
      "tool_call",
    ]);
    expect(state.flatResults.value.map((match) => match.id)).toEqual([1, 3, 2]);
    expect(state.uniqueSessionCount()).toBe(2);
    expect(state.totalCount.value).toBe(13);
    expect(state.latencyMs.value).toBe(12);
    expect(state.hasResults.value).toBe(true);
    expect(state.loading.value).toBe(false);
  });

  it("retains the default 150 ms debounce and trims the submitted query", async () => {
    const { state } = setup();
    mockSearch.mockResolvedValue(response("alpha"));
    state.query.value = "al";
    await nextTick();
    await vi.advanceTimersByTimeAsync(100);
    state.query.value = "  alpha  ";
    await nextTick();

    await vi.advanceTimersByTimeAsync(149);
    expect(mockSearch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockSearch).toHaveBeenCalledExactlyOnceWith("alpha", { limit: 20 });
  });

  it("honors the configured debounce and result limit", async () => {
    const { state } = setup({ debounceMs: 25, limit: 5 });
    mockSearch.mockResolvedValue(response("alpha"));
    state.query.value = "alpha";
    await nextTick();
    await vi.advanceTimersByTimeAsync(24);
    expect(mockSearch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockSearch).toHaveBeenCalledExactlyOnceWith("alpha", { limit: 5 });
  });

  it("removes completed results from the selectable list as soon as the query changes", async () => {
    const { state } = setup();
    mockSearch.mockResolvedValue(response("alpha"));
    await start(state);

    state.query.value = "beta";

    expectCleared(state, true);
    expect(state.hasQuery.value).toBe(true);
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it("clears a completed error while the replacement query debounces", async () => {
    const { state } = setup();
    mockSearch.mockRejectedValue(new Error("Alpha failed"));
    await start(state);
    expect(state.searchError.value).toBe("Alpha failed");
    expect(state.loading.value).toBe(false);

    state.query.value = "beta";

    expectCleared(state, true);
  });

  it.each([
    "success",
    "error",
  ] as const)("ignores an old %s during the replacement query's debounce window", async (completion) => {
    const older = createDeferred<SearchResultsResponse>();
    const newer = createDeferred<SearchResultsResponse>();
    mockSearch.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { state } = setup();
    await start(state);

    state.query.value = "beta";
    if (completion === "success") older.resolve(response("alpha"));
    else older.reject(new Error("Alpha failed"));
    await nextTick();

    expectCleared(state, true);
    expect(mockSearch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(149);
    expectCleared(state, true);
    expect(mockSearch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockSearch).toHaveBeenLastCalledWith("beta", { limit: 20 });
    newer.resolve(response("beta", [result(2)]));
    await nextTick();
    expect(state.flatResults.value.map((match) => match.id)).toEqual([2]);
    expect(state.loading.value).toBe(false);
  });

  it.each([
    "success",
    "error",
  ] as const)("ignores an old %s after the newer query has succeeded", async (completion) => {
    const older = createDeferred<SearchResultsResponse>();
    mockSearch
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(response("beta", [result(2)]));
    const { state } = setup();
    await start(state);
    await start(state, "beta");

    if (completion === "success") older.resolve(response("alpha"));
    else older.reject(new Error("Alpha failed"));
    await nextTick();

    expect(state.results.value.map((match) => match.id)).toEqual([2]);
    expect(state.searchError.value).toBeNull();
    expect(state.loading.value).toBe(false);
  });

  it("shows the current request's failure and finishes loading", async () => {
    const { state } = setup();
    mockSearch.mockRejectedValue(new Error("Current search failed"));
    await start(state);
    expect(state.results.value).toEqual([]);
    expect(state.totalCount.value).toBe(0);
    expect(state.searchError.value).toBe("Current search failed");
    expect(state.loading.value).toBe(false);
  });

  it.each(["", " \t "])("clears immediately for an empty query %j", async (query) => {
    const older = createDeferred<SearchResultsResponse>();
    mockSearch.mockReturnValueOnce(older.promise);
    const { state } = setup();
    await start(state);

    state.query.value = query;
    expectCleared(state);
    expect(state.hasQuery.value).toBe(false);
    older.resolve(response("alpha"));
    await nextTick();
    expectCleared(state);
    await vi.runAllTimersAsync();
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reset cancels a queued request without scheduling an empty-query timer", async () => {
    const { state } = setup();
    state.query.value = "alpha";
    await nextTick();
    state.reset();
    state.reset();
    await nextTick();
    expectCleared(state);
    expect(state.query.value).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it.each([
    "success",
    "error",
  ] as const)("reset rejects a late %s even when the same query is entered again", async (completion) => {
    const older = createDeferred<SearchResultsResponse>();
    const newer = createDeferred<SearchResultsResponse>();
    mockSearch.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { state } = setup();
    await start(state);
    state.reset();
    expectCleared(state);
    await start(state);

    if (completion === "success") older.resolve(response("alpha"));
    else older.reject(new Error("Closed search failed"));
    await nextTick();
    expectCleared(state, true);
    newer.resolve(response("alpha", [result(2)]));
    await nextTick();
    expect(state.results.value.map((match) => match.id)).toEqual([2]);
    expect(state.loading.value).toBe(false);
  });

  it.each([
    "dispose",
    "scope stop",
  ] as const)("%s cancels queued work and stops observing the query", async (cleanup) => {
    const { state, scope } = setup();
    state.query.value = "alpha";
    await nextTick();
    if (cleanup === "dispose") {
      state.dispose();
      state.dispose();
    } else scope.stop();
    state.query.value = "beta";
    await nextTick();
    await vi.runAllTimersAsync();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(state.loading.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["dispose", "success"],
    ["dispose", "error"],
    ["scope stop", "success"],
    ["scope stop", "error"],
  ] as const)("%s ignores an in-flight %s", async (cleanup, completion) => {
    const pending = createDeferred<SearchResultsResponse>();
    mockSearch.mockReturnValueOnce(pending.promise);
    const { state, scope } = setup();
    await start(state);
    if (cleanup === "dispose") state.dispose();
    else scope.stop();
    expectCleared(state);

    if (completion === "success") pending.resolve(response("alpha"));
    else pending.reject(new Error("Disposed search failed"));
    await nextTick();
    expectCleared(state);
  });

  it("cleanup only invalidates the search owned by its scope", async () => {
    const first = createDeferred<SearchResultsResponse>();
    const second = createDeferred<SearchResultsResponse>();
    mockSearch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = setup();
    const b = setup();
    await start(a.state);
    await start(b.state, "beta");
    a.scope.stop();
    first.resolve(response("alpha"));
    second.resolve(response("beta", [result(2)]));
    await nextTick();
    expectCleared(a.state);
    expect(b.state.results.value.map((match) => match.id)).toEqual([2]);
    expect(b.state.loading.value).toBe(false);
  });
});
