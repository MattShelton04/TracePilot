import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { BROWSE_PRESETS, useSearchStore } from "../../stores/search";

const mockSearchContent = vi.fn();
const mockGetSearchFacets = vi.fn();
const mockGetSearchStats = vi.fn();
const mockGetSearchRepositories = vi.fn();
const mockGetSearchToolNames = vi.fn();
const mockRebuildSearchIndex = vi.fn();
const mockFtsIntegrityCheck = vi.fn();
const mockFtsOptimize = vi.fn();
const mockFtsHealth = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    searchContent: (...args: unknown[]) => mockSearchContent(...args),
    getSearchFacets: (...args: unknown[]) => mockGetSearchFacets(...args),
    getSearchStats: (...args: unknown[]) => mockGetSearchStats(...args),
    getSearchRepositories: (...args: unknown[]) => mockGetSearchRepositories(...args),
    getSearchToolNames: (...args: unknown[]) => mockGetSearchToolNames(...args),
    rebuildSearchIndex: (...args: unknown[]) => mockRebuildSearchIndex(...args),
    ftsIntegrityCheck: (...args: unknown[]) => mockFtsIntegrityCheck(...args),
    ftsOptimize: (...args: unknown[]) => mockFtsOptimize(...args),
    ftsHealth: (...args: unknown[]) => mockFtsHealth(...args),
  });
});

vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn().mockResolvedValue(() => {}),
}));

const emptySearchResponse = {
  results: [],
  totalCount: 0,
  hasMore: false,
  latencyMs: 5,
};

const emptyFacets = {
  byContentType: [],
  byRepository: [],
  byToolName: [],
  totalMatches: 0,
  sessionCount: 0,
};

function resetAllMocks() {
  mockSearchContent.mockReset();
  mockGetSearchFacets.mockReset();
  mockGetSearchStats.mockReset();
  mockGetSearchRepositories.mockReset();
  mockGetSearchToolNames.mockReset();
  mockRebuildSearchIndex.mockReset();
  mockFtsIntegrityCheck.mockReset();
  mockFtsOptimize.mockReset();
  mockFtsHealth.mockReset();
}

function setupDefaultMocks() {
  mockSearchContent.mockResolvedValue(emptySearchResponse);
  mockGetSearchFacets.mockResolvedValue(emptyFacets);
  mockGetSearchStats.mockResolvedValue({
    totalRows: 0,
    indexedSessions: 0,
    totalSessions: 0,
    contentTypeCounts: [],
  });
  mockGetSearchRepositories.mockResolvedValue([]);
  mockGetSearchToolNames.mockResolvedValue([]);
  mockRebuildSearchIndex.mockResolvedValue(undefined);
  mockFtsIntegrityCheck.mockResolvedValue("ok");
  mockFtsOptimize.mockResolvedValue("ok");
  mockFtsHealth.mockResolvedValue(null);
}

async function flushSearchQueue() {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useSearchStore – scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    resetAllMocks();

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

describe("useSearchStore browse presets", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetAllMocks();
    setupDefaultMocks();
  });

  // Comprehensive test for applyBrowsePreset mechanism using toolCalls as the example.
  // Verifies that presets: clear all filters, set content types, use newest sort, reset page.
  // The parameterized tests below verify each preset's specific content types.
  it("clears filters and uses newest sort when browsing tool calls", async () => {
    const store = useSearchStore();
    store.query = "error in repo";
    store.repository = "org/repo";
    store.toolName = "grep";
    store.contentTypes = ["user_message"];
    store.excludeContentTypes = ["tool_result"];
    store.sortBy = "oldest";
    store.page = 3;

    store.applyBrowsePreset(BROWSE_PRESETS.toolCalls);
    await flushSearchQueue();

    expect(store.query).toBe("");
    expect(store.repository).toBeNull();
    expect(store.toolName).toBeNull();
    expect(store.contentTypes).toEqual(["tool_call"]);
    expect(store.excludeContentTypes).toEqual([]);
    expect(store.sortBy).toBe("newest");
    expect(store.page).toBe(1);
    expect(mockSearchContent).toHaveBeenCalledTimes(1);

    const [searchQuery, options] = mockSearchContent.mock.calls[0];
    expect(searchQuery).toBe("");
    expect(options.contentTypes).toEqual(["tool_call"]);
    expect(options.repositories).toBeUndefined();
    expect(options.toolNames).toBeUndefined();
    expect(options.sortBy).toBe("newest");
  });

  it.each([
    ["errors", ["error", "tool_error"]],
    ["userMessages", ["user_message"]],
    ["reasoning", ["reasoning"]],
    ["toolResults", ["tool_result"]],
    ["subagents", ["subagent"]],
  ] as const)("applies expected content types for %s preset", async (presetKey, expectedTypes) => {
    const store = useSearchStore();
    store.applyBrowsePreset(BROWSE_PRESETS[presetKey]);
    await flushSearchQueue();

    expect(store.contentTypes).toEqual(expectedTypes);
    expect(store.sortBy).toBe("newest");
    expect(mockSearchContent).toHaveBeenCalledTimes(1);

    const [, options] = mockSearchContent.mock.calls[0];
    expect(options.contentTypes).toEqual(expectedTypes);
    expect(options.sortBy).toBe("newest");
  });
});
