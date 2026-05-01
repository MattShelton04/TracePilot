// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { emptyFacets, mocks, resetAllMocks } from "./setup";
import { useSearchStore } from "../../../stores/search";

describe("useSearchStore – scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupPinia();
    resetAllMocks();

    mocks.searchContent.mockResolvedValue({
      results: [],
      totalCount: 0,
      hasMore: false,
      latencyMs: 42,
    });
    mocks.getSearchFacets.mockResolvedValue(null);
    mocks.getSearchStats.mockResolvedValue(null);
    mocks.getSearchRepositories.mockResolvedValue([]);
    mocks.getSearchToolNames.mockResolvedValue([]);
    mocks.rebuildSearchIndex.mockResolvedValue(undefined);
    mocks.ftsIntegrityCheck.mockResolvedValue(undefined);
    mocks.ftsOptimize.mockResolvedValue(undefined);
    mocks.ftsHealth.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces query changes while resetting page without duplicate immediate searches", async () => {
    const store = useSearchStore();
    store.page = 3;

    store.query = "hello";

    vi.advanceTimersByTime(149);
    expect(mocks.searchContent).not.toHaveBeenCalled();

    vi.runAllTimers();
    await nextTick();
    await Promise.resolve();

    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
    const [_query, options] = mocks.searchContent.mock.calls[0];
    expect(_query).toBe("hello");
    expect(options?.offset).toBe(0); // page reset to 1
    expect(store.page).toBe(1);
  });

  it("still triggers immediate search when user paginates", async () => {
    const store = useSearchStore();
    mocks.searchContent.mockResolvedValue({
      results: [],
      totalCount: 120,
      hasMore: true,
      latencyMs: 5,
    });

    store.query = "hello";

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();
    mocks.searchContent.mockClear();

    store.setPage(2);
    await nextTick(); // allow watcher to fire
    await vi.runAllTimersAsync();
    await nextTick(); // allow scheduleSearch's nextTick to run executeSearch
    await Promise.resolve(); // allow executeSearch to await searchContent

    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
    const [_query, options] = mocks.searchContent.mock.calls[0];
    expect(options?.offset).toBe(50); // (page 2 - 1) * 50
  });

  it("prevents search when From date is invalid", async () => {
    const store = useSearchStore();
    store.dateFrom = "not-a-date";
    store.query = "hello";

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();

    expect(mocks.searchContent).not.toHaveBeenCalled();
    expect(store.error).toBe("Invalid date filter: From date is not a valid date.");
    expect(store.results).toEqual([]);
    expect(store.totalCount).toBe(0);
    expect(store.hasMore).toBe(false);
    expect(store.latencyMs).toBe(0);
  });

  it("prevents search when From date is after To date", async () => {
    const store = useSearchStore();
    store.dateFrom = "2025-01-02T00:00:00.000Z";
    store.dateTo = "2025-01-01T00:00:00.000Z";
    store.query = "hello";

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();

    expect(mocks.searchContent).not.toHaveBeenCalled();
    expect(store.error).toBe("Invalid date filter: From date cannot be after To date.");
  });

  it("prevents search when To date is invalid", async () => {
    const store = useSearchStore();
    store.dateTo = "not-a-date";
    store.query = "hello";

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();

    expect(mocks.searchContent).not.toHaveBeenCalled();
    expect(store.error).toBe("Invalid date filter: To date is not a valid date.");
    expect(store.loading).toBe(false);
  });

  it("triggers an immediate search when contentTypes is replaced (no query change)", async () => {
    // Regression: shallowRef filter arrays must be replaced wholesale (not
    // mutated via splice/push) for the filter watcher in stores/search.ts
    // to fire. If the sidebar falls back to splice/push, filter toggles
    // won't re-run the search until the query changes — the bug this
    // test guards against.
    const store = useSearchStore();

    // Replace the array wholesale, the way the sidebar now does.
    store.contentTypes = ["tool_call"];

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();

    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
    const [, options] = mocks.searchContent.mock.calls[0];
    expect(options.contentTypes).toEqual(["tool_call"]);
  });

  it("passes unix timestamps for valid date range", async () => {
    const store = useSearchStore();
    store.dateFrom = "2025-01-01T00:00:00.000Z";
    store.dateTo = "2025-01-02T00:00:00.000Z";
    store.query = "hello";

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();

    expect(mocks.searchContent).toHaveBeenCalled();
    const latestCall = mocks.searchContent.mock.calls[mocks.searchContent.mock.calls.length - 1];
    const [, options] = latestCall;
    expect(options?.dateFromUnix).toBe(1735689600);
    expect(options?.dateToUnix).toBe(1735776000);
  });

  it("treats whitespace date filters as unset", async () => {
    const store = useSearchStore();
    store.dateFrom = "   ";
    store.dateTo = "\n\t";
    store.query = "hello";

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();

    expect(mocks.searchContent).toHaveBeenCalled();
    const latestCall = mocks.searchContent.mock.calls[mocks.searchContent.mock.calls.length - 1];
    const [, options] = latestCall;
    expect(options?.dateFromUnix).toBeUndefined();
    expect(options?.dateToUnix).toBeUndefined();
  });

  it("accepts overflow dates (JS Date auto-corrects e.g. Feb 31 → Mar 3)", async () => {
    // Documents known behavior: new Date("2025-02-31") auto-corrects to Mar 3.
    // This is accepted by the current validation (not rejected as invalid).
    const store = useSearchStore();
    store.dateFrom = "2025-02-31";
    store.query = "hello";

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();

    expect(mocks.searchContent).toHaveBeenCalled();
    const latestCall = mocks.searchContent.mock.calls[mocks.searchContent.mock.calls.length - 1];
    const [, options] = latestCall;
    // Feb 31 auto-corrects to Mar 3 — verify it produces a valid unix timestamp
    expect(options?.dateFromUnix).toBeDefined();
    expect(typeof options?.dateFromUnix).toBe("number");
  });

  it("skips facets fetch and logs warning when date filters are invalid", async () => {
    const store = useSearchStore();
    store.facets = emptyFacets;
    store.dateTo = "invalid-date";

    await store.fetchFacets("hello");

    expect(mocks.getSearchFacets).not.toHaveBeenCalled();
    expect(store.facets).toBeNull();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "[search] Skipping search facets fetch due to invalid date filter:",
      "Invalid date filter: To date is not a valid date.",
    );
  });
});
