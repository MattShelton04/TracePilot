import { describe, expect, it } from "vitest";
import { effectScope } from "vue";
import { createQuerySlice } from "../../../stores/search/query";

function inScope<T>(fn: () => T): { value: T; dispose: () => void } {
  const scope = effectScope();
  const value = scope.run(fn) as T;
  return { value, dispose: () => scope.stop() };
}

describe("search/query slice", () => {
  it("exposes default state with no active filters, no results, and relevance sort", () => {
    const { value: q, dispose } = inScope(() => createQuerySlice());
    try {
      expect(q.query.value).toBe("");
      expect(q.page.value).toBe(1);
      expect(q.pageSize.value).toBe(50);
      expect(q.sortBy.value).toBe("relevance");
      expect(q.results.value).toEqual([]);
      expect(q.hasResults.value).toBe(false);
      expect(q.hasQuery.value).toBe(false);
      expect(q.isBrowseMode.value).toBe(true);
      expect(q.hasActiveFilters.value).toBe(false);
      expect(q.totalPages.value).toBe(0);
      expect(q.groupedResults.value).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("flags hasActiveFilters when any filter is set and clearFilters resets them", () => {
    const { value: q, dispose } = inScope(() => createQuerySlice());
    try {
      q.contentTypes.value = ["error"];
      q.repository.value = "myrepo";
      q.sortBy.value = "newest";
      q.page.value = 4;
      expect(q.hasActiveFilters.value).toBe(true);

      q.clearFilters();

      expect(q.contentTypes.value).toEqual([]);
      expect(q.repository.value).toBeNull();
      expect(q.sortBy.value).toBe("relevance");
      expect(q.page.value).toBe(1);
      expect(q.hasActiveFilters.value).toBe(false);
    } finally {
      dispose();
    }
  });

  it("parseDateRange rejects from>to and invalid dates", () => {
    const { value: q, dispose } = inScope(() => createQuerySlice());
    try {
      q.dateFrom.value = "2025-12-31";
      q.dateTo.value = "2025-01-01";
      const badRange = q.parseDateRange();
      expect(badRange.error).toContain("From date cannot be after To date");

      q.dateFrom.value = "not-a-date";
      q.dateTo.value = null;
      const badDate = q.parseDateRange();
      expect(badDate.error).toContain("not a valid date");

      q.dateFrom.value = "2025-01-01";
      q.dateTo.value = "2025-12-31";
      const ok = q.parseDateRange();
      expect(ok.error).toBeUndefined();
      expect(typeof ok.dateFromUnix).toBe("number");
      expect(typeof ok.dateToUnix).toBe("number");
    } finally {
      dispose();
    }
  });

  it("groupedResults buckets SearchResult[] by sessionId preserving order", () => {
    const { value: q, dispose } = inScope(() => createQuerySlice());
    try {
      const r = (id: string, sid: string, summary: string | null = null) =>
        ({
          id,
          sessionId: sid,
          sessionSummary: summary,
          sessionRepository: null,
          sessionBranch: null,
        }) as never;
      q.results.value = [r("1", "s1", "A"), r("2", "s2"), r("3", "s1")];

      const groups = q.groupedResults.value;
      expect(groups).toHaveLength(2);
      expect(groups[0]?.sessionId).toBe("s1");
      expect(groups[0]?.sessionSummary).toBe("A");
      expect(groups[0]?.results.map((x) => x.id)).toEqual(["1", "3"]);
      expect(groups[1]?.sessionId).toBe("s2");
      expect(groups[1]?.results.map((x) => x.id)).toEqual(["2"]);
    } finally {
      dispose();
    }
  });

  it("pagination helpers clamp within range and respect hasMore", () => {
    const { value: q, dispose } = inScope(() => createQuerySlice());
    try {
      q.totalCount.value = 120; // 120 / 50 = 3 pages
      q.setPage(99);
      expect(q.page.value).toBe(3);
      q.setPage(-5);
      expect(q.page.value).toBe(1);

      q.hasMore.value = true;
      q.nextPage();
      expect(q.page.value).toBe(2);
      q.prevPage();
      expect(q.page.value).toBe(1);

      q.hasMore.value = false;
      q.page.value = 1;
      q.nextPage();
      expect(q.page.value).toBe(1); // blocked by hasMore=false
    } finally {
      dispose();
    }
  });
});
