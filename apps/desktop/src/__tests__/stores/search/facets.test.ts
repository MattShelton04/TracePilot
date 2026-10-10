import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import { createFacetsSlice } from "../../../stores/search/facets";
import { createQuerySlice } from "../../../stores/search/query";

const mockGetSearchFacets = vi.fn();
const mockGetSearchStats = vi.fn();
const mockGetSearchRepositories = vi.fn();
const mockGetSearchToolNames = vi.fn();
const mockLogWarn = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getSearchFacets: (...args: unknown[]) => mockGetSearchFacets(...args),
    getSearchStats: (...args: unknown[]) => mockGetSearchStats(...args),
    getSearchRepositories: (...args: unknown[]) => mockGetSearchRepositories(...args),
    getSearchToolNames: (...args: unknown[]) => mockGetSearchToolNames(...args),
  });
});

vi.mock("@/utils/logger", () => ({
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
}));

function setup() {
  const scope = effectScope();
  const build = scope.run(() => {
    const q = createQuerySlice();
    const f = createFacetsSlice(q);
    return { q, f };
  }) as { q: ReturnType<typeof createQuerySlice>; f: ReturnType<typeof createFacetsSlice> };
  return { ...build, dispose: () => scope.stop() };
}

describe("search/facets slice", () => {
  beforeEach(() => {
    mockGetSearchFacets.mockReset();
    mockGetSearchStats.mockReset();
    mockGetSearchRepositories.mockReset();
    mockGetSearchToolNames.mockReset();
    mockLogWarn.mockReset();
  });

  it("fetchStats populates stats and toggles statsLoading", async () => {
    const stats = { totalRows: 42, indexedSessions: 3, totalSessions: 5, contentTypeCounts: [] };
    mockGetSearchStats.mockResolvedValue(stats);
    const { f, dispose } = setup();
    try {
      const p = f.fetchStats();
      expect(f.statsLoading.value).toBe(true);
      await p;
      expect(f.statsLoading.value).toBe(false);
      expect(f.stats.value).toEqual(stats);
    } finally {
      dispose();
    }
  });

  it("fetchFilterOptions resolves repos + tools in parallel", async () => {
    mockGetSearchRepositories.mockResolvedValue(["repoA", "repoB"]);
    const tools = [{ name: "shell", nativeNames: ["Bash"], sources: ["claudeCode"] }];
    mockGetSearchToolNames.mockResolvedValue(tools);
    const { f, dispose } = setup();
    try {
      await f.fetchFilterOptions();
      expect(f.availableRepositories.value).toEqual(["repoA", "repoB"]);
      expect(f.availableToolNames.value).toEqual(tools);
    } finally {
      dispose();
    }
  });

  it("fetchFacets aborts with warn when date range is invalid", async () => {
    const { f, q, dispose } = setup();
    try {
      q.dateFrom.value = "2025-12-31";
      q.dateTo.value = "2025-01-01";
      f.facets.value = { byContentType: [], byRepository: [], byToolName: [] } as never;

      await f.fetchFacets();

      expect(mockGetSearchFacets).not.toHaveBeenCalled();
      expect(f.facets.value).toBeNull();
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining("Skipping search facets fetch"),
        expect.any(String),
      );
    } finally {
      dispose();
    }
  });

  it("fetchFacets forwards active filters and overrides", async () => {
    const result = { byContentType: [], byRepository: [], byToolName: [] };
    mockGetSearchFacets.mockResolvedValue(result);
    const { f, q, dispose } = setup();
    try {
      q.contentTypes.value = ["error"];
      q.repository.value = "base";
      await f.fetchFacets("boom", { repo: "other", contentTypes: ["user_message"] });

      expect(mockGetSearchFacets).toHaveBeenCalledWith(
        "boom",
        expect.objectContaining({
          contentTypes: ["user_message"],
          repositories: ["other"],
        }),
      );
      expect(f.facets.value).toStrictEqual(result);
    } finally {
      dispose();
    }
  });

  it("refetches unfiltered facets after a filtered fetch replaced them", async () => {
    const unfiltered = { byContentType: [["error", 9]], byRepository: [], byToolName: [] };
    const claudeOnly = { byContentType: [["error", 2]], byRepository: [], byToolName: [] };
    mockGetSearchFacets
      .mockResolvedValueOnce(unfiltered)
      .mockResolvedValueOnce(claudeOnly)
      .mockResolvedValueOnce(unfiltered);
    const { f, q, dispose } = setup();
    try {
      await f.fetchFacets();
      q.source.value = "claudeCode";
      await f.fetchFacets();
      expect(mockGetSearchFacets).toHaveBeenLastCalledWith(
        undefined,
        expect.objectContaining({ source: "claudeCode" }),
      );
      q.source.value = null;
      await f.fetchFacets();

      expect(mockGetSearchFacets).toHaveBeenCalledTimes(3);
      expect(f.facets.value).toStrictEqual(unfiltered);
      // A second unfiltered fetch within the TTL is still served from cache.
      await f.fetchFacets();
      expect(mockGetSearchFacets).toHaveBeenCalledTimes(3);
    } finally {
      dispose();
    }
  });
});
