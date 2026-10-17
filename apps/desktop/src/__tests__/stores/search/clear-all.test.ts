// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { createDeferred, setupPinia } from "@tracepilot/test-utils";
import type { SearchResult } from "@tracepilot/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyFacets,
  emptySearchResponse,
  flushSearchQueue,
  mocks,
  resetAllMocks,
  setupDefaultMocks,
} from "./setup";
import { useSearchStore } from "../../../stores/search";

const match = {
  id: 1,
  sessionId: "s1",
  sessionSummary: "Synthetic session",
  contentType: "user_message",
  turnNumber: 1,
  eventIndex: 0,
  snippet: "retry",
  timestampUnix: 1,
  source: "copilot",
} as unknown as SearchResult;

const found = { ...emptySearchResponse, results: [match], totalCount: 1 };

/** Type a query and let its debounced search (and facets) finish. */
async function search(store: ReturnType<typeof useSearchStore>, text: string) {
  store.query = text;
  await new Promise((resolve) => setTimeout(resolve, 200));
  await flushSearchQueue();
}

describe("useSearchStore clearAll", () => {
  beforeEach(() => {
    setupPinia();
    resetAllMocks();
    setupDefaultMocks();
  });

  it("swaps the cleared query's facet counts for the whole index's", async () => {
    const store = useSearchStore();
    mocks.searchContent.mockResolvedValue(found);
    mocks.getSearchFacets.mockImplementation((query?: string) =>
      Promise.resolve(
        query
          ? { ...emptyFacets, byContentType: [["user_message", 1]], totalMatches: 1 }
          : { ...emptyFacets, byContentType: [["user_message", 40]], totalMatches: 90 },
      ),
    );
    await search(store, "retry");
    expect(store.facets?.byContentType).toEqual([["user_message", 1]]);

    store.clearAll();
    await flushSearchQueue();

    expect(store.query).toBe("");
    expect(mocks.getSearchFacets).toHaveBeenLastCalledWith(undefined, expect.any(Object));
    expect(store.facets?.byContentType).toEqual([["user_message", 40]]);
    // The browse landing shows stats, not a search of everything.
    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
  });

  it("drops a search still in flight so it can't refill the cleared results", async () => {
    const store = useSearchStore();
    mocks.searchContent.mockResolvedValueOnce(found);
    await search(store, "retry");

    const late = createDeferred<typeof found>();
    mocks.searchContent.mockReturnValueOnce(late.promise);
    await search(store, "retrying");
    expect(store.loading).toBe(true);

    store.clearAll();
    await flushSearchQueue();
    late.resolve(found);
    await flushSearchQueue();

    expect(store.query).toBe("");
    expect(store.results).toEqual([]);
    expect(store.totalCount).toBe(0);
    expect(store.loading).toBe(false);
  });

  it("cancels a debounced search that hasn't started yet", async () => {
    const store = useSearchStore();
    store.query = "retry";
    await flushSearchQueue();
    // Cleared inside the debounce window: no search runs, not even of nothing.
    store.clearAll();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushSearchQueue();

    expect(mocks.searchContent).not.toHaveBeenCalled();
    expect(store.results).toEqual([]);
  });
});
