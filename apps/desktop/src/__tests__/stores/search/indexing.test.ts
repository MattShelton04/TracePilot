import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import { createFacetsSlice } from "../../../stores/search/facets";
import { createIndexingSlice } from "../../../stores/search/indexing";
import { createMaintenanceSlice } from "../../../stores/search/maintenance";
import { createQuerySlice } from "../../../stores/search/query";

const mockRebuildSearchIndex = vi.fn();
const mockGetSearchFacets = vi.fn();
const mockGetSearchStats = vi.fn();
const mockGetSearchRepositories = vi.fn();
const mockGetSearchToolNames = vi.fn();
const mockFtsHealth = vi.fn();
const safeListenMock = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    rebuildSearchIndex: (...args: unknown[]) => mockRebuildSearchIndex(...args),
    getSearchFacets: (...args: unknown[]) => mockGetSearchFacets(...args),
    getSearchStats: (...args: unknown[]) => mockGetSearchStats(...args),
    getSearchRepositories: (...args: unknown[]) => mockGetSearchRepositories(...args),
    getSearchToolNames: (...args: unknown[]) => mockGetSearchToolNames(...args),
    ftsHealth: (...args: unknown[]) => mockFtsHealth(...args),
    ftsIntegrityCheck: vi.fn(),
    ftsOptimize: vi.fn(),
  });
});

vi.mock("@/utils/tauriEvents", () => ({
  safeListen: (...args: unknown[]) => safeListenMock(...args),
}));

vi.mock("@/utils/logger", () => ({
  logWarn: vi.fn(),
}));

function setup(opts?: { viewMounted?: boolean }) {
  const scope = effectScope();
  const listeners = new Map<string, (ev: { payload: unknown }) => void>();
  safeListenMock.mockImplementation(
    async (name: string, cb: (ev: { payload: unknown }) => void) => {
      listeners.set(name, cb);
      return () => listeners.delete(name);
    },
  );

  const built = scope.run(() => {
    const q = createQuerySlice();
    const f = createFacetsSlice(q);
    const m = createMaintenanceSlice();
    const scheduleSearch = vi.fn();
    const executeSearch = vi.fn(async () => {});
    const indexing = createIndexingSlice({
      query: q,
      facets: f,
      maintenance: m,
      scheduleSearch,
      executeSearch,
      getViewMounted: () => opts?.viewMounted ?? true,
    });
    return { q, f, m, indexing, scheduleSearch, executeSearch };
  }) as {
    q: ReturnType<typeof createQuerySlice>;
    f: ReturnType<typeof createFacetsSlice>;
    m: ReturnType<typeof createMaintenanceSlice>;
    indexing: ReturnType<typeof createIndexingSlice>;
    scheduleSearch: ReturnType<typeof vi.fn>;
    executeSearch: ReturnType<typeof vi.fn>;
  };
  return { ...built, listeners, dispose: () => scope.stop() };
}

describe("search/indexing slice", () => {
  beforeEach(() => {
    mockRebuildSearchIndex.mockReset();
    mockGetSearchFacets.mockReset().mockResolvedValue({
      byContentType: [],
      byRepository: [],
      byToolName: [],
    });
    mockGetSearchStats.mockReset().mockResolvedValue({
      totalRows: 0,
      indexedSessions: 0,
      totalSessions: 0,
      contentTypeCounts: [],
    });
    mockGetSearchRepositories.mockReset().mockResolvedValue([]);
    mockGetSearchToolNames.mockReset().mockResolvedValue([]);
    mockFtsHealth.mockReset().mockResolvedValue(null);
    safeListenMock.mockReset();
  });

  it("rebuild() sets rebuilding, refreshes stats/facets/options, and skips executeSearch when idle", async () => {
    mockRebuildSearchIndex.mockResolvedValue(undefined);
    const { indexing, executeSearch, dispose } = setup();
    try {
      const p = indexing.rebuild();
      expect(indexing.rebuilding.value).toBe(true);
      await p;
      expect(indexing.rebuilding.value).toBe(false);
      expect(mockRebuildSearchIndex).toHaveBeenCalledTimes(1);
      expect(mockGetSearchStats).toHaveBeenCalledTimes(1);
      expect(executeSearch).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("rebuild() short-circuits while indexing is already in progress", async () => {
    const { indexing, dispose } = setup();
    try {
      indexing.searchIndexing.value = true;
      await indexing.rebuild();
      expect(mockRebuildSearchIndex).not.toHaveBeenCalled();
      expect(indexing.rebuilding.value).toBe(false);
    } finally {
      dispose();
    }
  });

  it("initEventListeners wires SEARCH_INDEXING_* events and updates state", async () => {
    const { indexing, listeners, dispose } = setup();
    try {
      await indexing.initEventListeners();
      const started = Array.from(listeners.keys()).find((k) => /started/i.test(k));
      const progress = Array.from(listeners.keys()).find((k) => /progress/i.test(k));
      expect(started).toBeTruthy();
      expect(progress).toBeTruthy();

      listeners.get(started!)?.({ payload: null });
      expect(indexing.searchIndexing.value).toBe(true);

      listeners.get(progress!)?.({ payload: { percent: 42 } });
      expect(indexing.searchIndexingProgress.value).toEqual({ percent: 42 });
    } finally {
      dispose();
    }
  });

  it("SEARCH_INDEXING_FINISHED triggers scheduleSearch when a query is active", async () => {
    const { indexing, q, listeners, scheduleSearch, dispose } = setup();
    try {
      await indexing.initEventListeners();
      q.query.value = "anything";
      indexing.searchIndexing.value = true;
      const finished = Array.from(listeners.keys()).find((k) => /finished/i.test(k));
      listeners.get(finished!)?.({ payload: null });
      expect(indexing.searchIndexing.value).toBe(false);
      expect(scheduleSearch).toHaveBeenCalledWith(false);
    } finally {
      dispose();
    }
  });

  it("SEARCH_INDEXING_FINISHED is a no-op when view is unmounted", async () => {
    const { indexing, listeners, scheduleSearch, dispose } = setup({ viewMounted: false });
    try {
      await indexing.initEventListeners();
      const finished = Array.from(listeners.keys()).find((k) => /finished/i.test(k));
      listeners.get(finished!)?.({ payload: null });
      expect(scheduleSearch).not.toHaveBeenCalled();
      expect(mockGetSearchStats).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});
