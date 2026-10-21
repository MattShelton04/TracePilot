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

describe("useSearchStore landing after editing", () => {
  beforeEach(() => {
    setupPinia();
    resetAllMocks();
    setupDefaultMocks();
  });

  it("returns to the landing when the query is deleted, not a search of everything", async () => {
    const store = useSearchStore();
    mocks.searchContent.mockResolvedValue(found);
    mocks.getSearchFacets.mockImplementation((query?: string) =>
      Promise.resolve({ ...emptyFacets, totalMatches: query ? 1 : 90 }),
    );
    await search(store, "retry");
    expect(store.results).toHaveLength(1);

    await search(store, "");

    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
    expect(store.results).toEqual([]);
    expect(store.totalCount).toBe(0);
    expect(mocks.getSearchFacets).toHaveBeenLastCalledWith(undefined, expect.any(Object));
    expect(store.facets?.totalMatches).toBe(90);
  });

  it("drops the deleted query's search still in flight", async () => {
    const store = useSearchStore();
    const late = createDeferred<typeof found>();
    mocks.searchContent.mockReturnValueOnce(late.promise);
    await search(store, "retry");
    expect(store.loading).toBe(true);

    await search(store, "");
    late.resolve(found);
    await flushSearchQueue();

    expect(store.results).toEqual([]);
    expect(store.loading).toBe(false);
  });

  it("keeps browsing an active filter when the query is deleted", async () => {
    const store = useSearchStore();
    store.contentTypes = ["user_message"];
    await flushSearchQueue();
    await search(store, "retry");
    mocks.searchContent.mockClear();
    mocks.searchContent.mockResolvedValue(found);

    await search(store, "");

    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
    const [text, options] = mocks.searchContent.mock.calls[0];
    expect(text).toBe("");
    expect(options.contentTypes).toEqual(["user_message"]);
    expect(store.results).toHaveLength(1);
  });

  it("returns to the landing when the last browse filter is removed", async () => {
    const store = useSearchStore();
    store.repository = "acme/app";
    await flushSearchQueue();
    expect(mocks.searchContent).toHaveBeenCalledTimes(1);

    store.repository = null;
    await flushSearchQueue();

    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
  });

  it("still lists everything oldest first when that order is picked", async () => {
    const store = useSearchStore();
    store.sortBy = "oldest";
    await flushSearchQueue();

    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
    expect(mocks.searchContent.mock.calls[0][1].sortBy).toBe("oldest");
  });
});
