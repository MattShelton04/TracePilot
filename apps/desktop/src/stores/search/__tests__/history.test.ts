import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick } from "vue";
import { createSearchHistory } from "../history";

let storage: Record<string, string> = {};

const mockStorage = {
  getItem: vi.fn((k: string) => storage[k] ?? null),
  setItem: vi.fn((k: string, v: string) => {
    storage[k] = v;
  }),
  removeItem: vi.fn((k: string) => {
    delete storage[k];
  }),
  clear: vi.fn(() => {
    storage = {};
  }),
  get length() {
    return Object.keys(storage).length;
  },
  key: vi.fn((i: number) => Object.keys(storage)[i] ?? null),
} as unknown as Storage;

beforeEach(() => {
  storage = {};
  vi.stubGlobal("localStorage", mockStorage);
});

function inScope<T>(fn: () => T): { value: T; dispose: () => void } {
  const scope = effectScope();
  const value = scope.run(fn) as T;
  return { value, dispose: () => scope.stop() };
}

describe("stores/search/history – createSearchHistory", () => {
  it("starts empty and adds new entries to the front", async () => {
    const { value: h, dispose } = inScope(() => createSearchHistory({ storageKey: "test:hist" }));
    try {
      expect(h.recentSearches.value).toEqual([]);
      h.addRecentSearch("alpha", 3);
      h.addRecentSearch("beta", 7);
      await nextTick();

      expect(h.recentSearches.value.map((s) => s.query)).toEqual(["beta", "alpha"]);
      expect(h.recentSearches.value[0]?.resultCount).toBe(7);
    } finally {
      dispose();
    }
  });

  it("dedupes by query and promotes the existing entry to the front", async () => {
    const { value: h, dispose } = inScope(() => createSearchHistory({ storageKey: "test:hist" }));
    try {
      h.addRecentSearch("alpha", 1);
      h.addRecentSearch("beta", 2);
      h.addRecentSearch("alpha", 99);
      await nextTick();

      expect(h.recentSearches.value.map((s) => s.query)).toEqual(["alpha", "beta"]);
      expect(h.recentSearches.value[0]?.resultCount).toBe(99);
    } finally {
      dispose();
    }
  });

  it("trims to maxItems (default 10)", async () => {
    const { value: h, dispose } = inScope(() =>
      createSearchHistory({ storageKey: "test:hist", maxItems: 3 }),
    );
    try {
      for (const q of ["a", "b", "c", "d", "e"]) h.addRecentSearch(q, 1);
      await nextTick();
      expect(h.recentSearches.value.map((s) => s.query)).toEqual(["e", "d", "c"]);
    } finally {
      dispose();
    }
  });

  it("removeRecentSearch removes a specific entry", async () => {
    const { value: h, dispose } = inScope(() => createSearchHistory({ storageKey: "test:hist" }));
    try {
      h.addRecentSearch("alpha", 1);
      h.addRecentSearch("beta", 2);
      h.removeRecentSearch("alpha");
      await nextTick();
      expect(h.recentSearches.value.map((s) => s.query)).toEqual(["beta"]);
    } finally {
      dispose();
    }
  });

  it("clearRecentSearches empties the list", async () => {
    const { value: h, dispose } = inScope(() => createSearchHistory({ storageKey: "test:hist" }));
    try {
      h.addRecentSearch("alpha", 1);
      h.clearRecentSearches();
      await nextTick();
      expect(h.recentSearches.value).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("persists to and rehydrates from localStorage", async () => {
    const key = "test:hist:persist";
    const { value: h1, dispose: d1 } = inScope(() => createSearchHistory({ storageKey: key }));
    h1.addRecentSearch("alpha", 1);
    h1.addRecentSearch("beta", 2);
    await nextTick();
    d1();

    const { value: h2, dispose: d2 } = inScope(() => createSearchHistory({ storageKey: key }));
    try {
      expect(h2.recentSearches.value.map((s) => s.query)).toEqual(["beta", "alpha"]);
    } finally {
      d2();
    }
  });
});
