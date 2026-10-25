// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { emptySearchResponse, mocks, resetAllMocks, setupDefaultMocks } from "./setup";
import { useSearchStore } from "../../../stores/search";

const found = { ...emptySearchResponse, totalCount: 3 };

describe("useSearchStore – recent searches while typing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setupPinia();
    resetAllMocks();
    setupDefaultMocks();
    mocks.searchContent.mockResolvedValue(found);
  });

  afterEach(() => {
    useSearchStore().$dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
    localStorage.clear();
  });

  /** Type one character at a time, slowly enough that every prefix searches. */
  async function typeSlowly(text: string, from = "") {
    const store = useSearchStore();
    for (let i = from.length + 1; i <= text.length; i++) {
      store.query = text.slice(0, i);
      await nextTick();
      await vi.advanceTimersByTimeAsync(300);
    }
  }

  it("keeps one entry for a query typed a letter at a time", async () => {
    const store = useSearchStore();
    await typeSlowly("refactor");

    expect(mocks.searchContent).toHaveBeenCalledTimes("refactor".length);
    expect(store.recentSearches.map((s) => s.query)).toEqual(["refactor"]);
  });

  it("keeps earlier history when a new query is typed", async () => {
    const store = useSearchStore();
    await typeSlowly("auth");
    await vi.advanceTimersByTimeAsync(10_000); // reading the results
    store.query = "";
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    await typeSlowly("plugin");

    expect(store.recentSearches.map((s) => s.query)).toEqual(["plugin", "auth"]);
  });
});
