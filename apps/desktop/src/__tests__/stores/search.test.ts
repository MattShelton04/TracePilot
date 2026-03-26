import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { nextTick } from "vue";
import { useSearchStore } from "../../stores/search";

const mockSearchContent = vi.fn();
const mockGetSearchFacets = vi.fn();
const mockGetSearchStats = vi.fn();
const mockGetSearchRepositories = vi.fn();
const mockGetSearchToolNames = vi.fn();
const mockRebuildSearchIndex = vi.fn();
const mockFtsIntegrityCheck = vi.fn();
const mockFtsOptimize = vi.fn();
const mockFtsHealth = vi.fn();

vi.mock("@tracepilot/client", () => ({
  searchContent: (...args: unknown[]) => mockSearchContent(...args),
  getSearchFacets: (...args: unknown[]) => mockGetSearchFacets(...args),
  getSearchStats: (...args: unknown[]) => mockGetSearchStats(...args),
  getSearchRepositories: (...args: unknown[]) => mockGetSearchRepositories(...args),
  getSearchToolNames: (...args: unknown[]) => mockGetSearchToolNames(...args),
  rebuildSearchIndex: (...args: unknown[]) => mockRebuildSearchIndex(...args),
  ftsIntegrityCheck: (...args: unknown[]) => mockFtsIntegrityCheck(...args),
  ftsOptimize: (...args: unknown[]) => mockFtsOptimize(...args),
  ftsHealth: (...args: unknown[]) => mockFtsHealth(...args),
}));

vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn().mockResolvedValue(() => {}),
}));

describe("useSearchStore – scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    mockSearchContent.mockReset();
    mockGetSearchFacets.mockReset();
    mockGetSearchStats.mockReset();
    mockGetSearchRepositories.mockReset();
    mockGetSearchToolNames.mockReset();
    mockRebuildSearchIndex.mockReset();
    mockFtsIntegrityCheck.mockReset();
    mockFtsOptimize.mockReset();
    mockFtsHealth.mockReset();

    mockSearchContent.mockResolvedValue({
      results: [],
      totalCount: 0,
      hasMore: false,
      latencyMs: 42,
    });
    mockGetSearchFacets.mockResolvedValue(null);
    mockGetSearchStats.mockResolvedValue(null);
    mockGetSearchRepositories.mockResolvedValue([]);
    mockGetSearchToolNames.mockResolvedValue([]);
    mockRebuildSearchIndex.mockResolvedValue(undefined);
    mockFtsIntegrityCheck.mockResolvedValue(undefined);
    mockFtsOptimize.mockResolvedValue(undefined);
    mockFtsHealth.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces query changes while resetting page without duplicate immediate searches", async () => {
    const store = useSearchStore();
    store.page = 3;

    store.query = "hello";

    vi.advanceTimersByTime(149);
    expect(mockSearchContent).not.toHaveBeenCalled();

    vi.runAllTimers();
    await nextTick();
    await Promise.resolve();

    expect(mockSearchContent).toHaveBeenCalledTimes(1);
    const [_query, options] = mockSearchContent.mock.calls[0];
    expect(_query).toBe("hello");
    expect(options?.offset).toBe(0); // page reset to 1
    expect(store.page).toBe(1);
  });

  it("still triggers immediate search when user paginates", async () => {
    const store = useSearchStore();
    mockSearchContent.mockResolvedValue({
      results: [],
      totalCount: 120,
      hasMore: true,
      latencyMs: 5,
    });

    store.query = "hello";

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();
    mockSearchContent.mockClear();

    store.setPage(2);
    await nextTick(); // allow watcher to fire
    await vi.runAllTimersAsync();
    await nextTick(); // allow scheduleSearch's nextTick to run executeSearch
    await Promise.resolve(); // allow executeSearch to await searchContent

    expect(mockSearchContent).toHaveBeenCalledTimes(1);
    const [_query, options] = mockSearchContent.mock.calls[0];
    expect(options?.offset).toBe(50); // (page 2 - 1) * 50
  });
});
