import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentSearch } from "../../composables/useRecentSearches";
import { useRecentSearches } from "../../composables/useRecentSearches";

// ── localStorage mock ─────────────────────────────────────────
let storageMap: Record<string, string> = {};

const mockStorage = {
  getItem: vi.fn((key: string) => storageMap[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storageMap[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete storageMap[key];
  }),
  clear: vi.fn(() => {
    storageMap = {};
  }),
  get length() {
    return Object.keys(storageMap).length;
  },
  key: vi.fn((index: number) => Object.keys(storageMap)[index] ?? null),
};

beforeEach(() => {
  storageMap = {};
  vi.stubGlobal("localStorage", mockStorage);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRecentSearches", () => {
  it("initializes with an empty list when localStorage is empty", () => {
    const { recentSearches } = useRecentSearches();
    expect(recentSearches.value).toEqual([]);
  });

  it("loads existing searches from localStorage", () => {
    const saved: RecentSearch[] = [
      { query: "hello", timestamp: 1000, resultCount: 5 },
      { query: "world", timestamp: 2000, resultCount: 10 },
    ];
    storageMap["tracepilot-recent-searches"] = JSON.stringify(saved);

    const { recentSearches } = useRecentSearches();
    expect(recentSearches.value).toEqual(saved);
  });

  it("handles malformed localStorage data gracefully", () => {
    storageMap["tracepilot-recent-searches"] = "{not valid json";

    const { recentSearches } = useRecentSearches();
    expect(recentSearches.value).toEqual([]);
  });

  it("handles non-array localStorage data gracefully", () => {
    storageMap["tracepilot-recent-searches"] = JSON.stringify({ not: "an array" });

    const { recentSearches } = useRecentSearches();
    expect(recentSearches.value).toEqual([]);
  });

  describe("addRecentSearch", () => {
    it("adds a new search to the top of the list", () => {
      const { recentSearches, addRecentSearch } = useRecentSearches();

      addRecentSearch("first query", 5);
      addRecentSearch("second query", 10);

      expect(recentSearches.value).toHaveLength(2);
      expect(recentSearches.value[0].query).toBe("second query");
      expect(recentSearches.value[1].query).toBe("first query");
    });

    it("promotes duplicate queries to the top and updates result count", () => {
      const { recentSearches, addRecentSearch } = useRecentSearches();

      addRecentSearch("first", 5);
      addRecentSearch("second", 10);
      addRecentSearch("first", 20);

      expect(recentSearches.value).toHaveLength(2);
      expect(recentSearches.value[0].query).toBe("first");
      expect(recentSearches.value[0].resultCount).toBe(20);
      expect(recentSearches.value[1].query).toBe("second");
    });

    it("persists to localStorage after adding", () => {
      const { addRecentSearch } = useRecentSearches();

      addRecentSearch("test", 3);

      expect(mockStorage.setItem).toHaveBeenCalledWith(
        "tracepilot-recent-searches",
        expect.any(String),
      );

      const saved = JSON.parse(storageMap["tracepilot-recent-searches"]);
      expect(saved).toHaveLength(1);
      expect(saved[0].query).toBe("test");
    });

    it("respects maxItems limit", () => {
      const { recentSearches, addRecentSearch } = useRecentSearches({ maxItems: 3 });

      addRecentSearch("a", 1);
      addRecentSearch("b", 2);
      addRecentSearch("c", 3);
      addRecentSearch("d", 4);

      expect(recentSearches.value).toHaveLength(3);
      expect(recentSearches.value.map((s) => s.query)).toEqual(["d", "c", "b"]);
    });
  });

  describe("removeRecentSearch", () => {
    it("removes a specific search by query", () => {
      const { recentSearches, addRecentSearch, removeRecentSearch } = useRecentSearches();

      addRecentSearch("keep", 1);
      addRecentSearch("remove", 2);

      removeRecentSearch("remove");

      expect(recentSearches.value).toHaveLength(1);
      expect(recentSearches.value[0].query).toBe("keep");
    });

    it("persists to localStorage after removing", () => {
      const { addRecentSearch, removeRecentSearch } = useRecentSearches();

      addRecentSearch("keep", 1);
      addRecentSearch("remove", 2);
      mockStorage.setItem.mockClear();

      removeRecentSearch("remove");

      expect(mockStorage.setItem).toHaveBeenCalled();
      const saved = JSON.parse(storageMap["tracepilot-recent-searches"]);
      expect(saved).toHaveLength(1);
    });

    it("is a no-op when query does not exist", () => {
      const { recentSearches, addRecentSearch, removeRecentSearch } = useRecentSearches();

      addRecentSearch("existing", 1);
      removeRecentSearch("nonexistent");

      expect(recentSearches.value).toHaveLength(1);
    });
  });

  describe("clearRecentSearches", () => {
    it("removes all searches", () => {
      const { recentSearches, addRecentSearch, clearRecentSearches } = useRecentSearches();

      addRecentSearch("a", 1);
      addRecentSearch("b", 2);

      clearRecentSearches();

      expect(recentSearches.value).toEqual([]);
    });

    it("persists empty state to localStorage", () => {
      const { addRecentSearch, clearRecentSearches } = useRecentSearches();

      addRecentSearch("a", 1);
      mockStorage.setItem.mockClear();

      clearRecentSearches();

      const saved = JSON.parse(storageMap["tracepilot-recent-searches"]);
      expect(saved).toEqual([]);
    });
  });

  describe("custom options", () => {
    it("uses custom storageKey", () => {
      const key = "custom-key";
      const saved: RecentSearch[] = [{ query: "stored", timestamp: 100, resultCount: 1 }];
      storageMap[key] = JSON.stringify(saved);

      const { recentSearches } = useRecentSearches({ storageKey: key });
      expect(recentSearches.value).toEqual(saved);
    });

    it("uses default maxItems of 10", () => {
      const { recentSearches, addRecentSearch } = useRecentSearches();

      for (let i = 0; i < 15; i++) {
        addRecentSearch(`q${i}`, i);
      }

      expect(recentSearches.value).toHaveLength(10);
    });
  });
});
