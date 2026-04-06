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
const mockLogWarn = vi.fn();

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

vi.mock("@/utils/logger", () => ({
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
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
  mockLogWarn.mockReset();
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

  it("prevents search when From date is invalid", async () => {
    const store = useSearchStore();
    store.dateFrom = "not-a-date";
    store.query = "hello";

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();

    expect(mockSearchContent).not.toHaveBeenCalled();
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

    expect(mockSearchContent).not.toHaveBeenCalled();
    expect(store.error).toBe("Invalid date filter: From date must be before or equal to To date.");
  });

  it("prevents search when To date is invalid", async () => {
    const store = useSearchStore();
    store.dateTo = "not-a-date";
    store.query = "hello";

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();

    expect(mockSearchContent).not.toHaveBeenCalled();
    expect(store.error).toBe("Invalid date filter: To date is not a valid date.");
    expect(store.loading).toBe(false);
  });

  it("passes unix timestamps for valid date range", async () => {
    const store = useSearchStore();
    store.dateFrom = "2025-01-01T00:00:00.000Z";
    store.dateTo = "2025-01-02T00:00:00.000Z";
    store.query = "hello";

    await vi.runAllTimersAsync();
    await nextTick();
    await Promise.resolve();

    expect(mockSearchContent).toHaveBeenCalled();
    const latestCall = mockSearchContent.mock.calls[mockSearchContent.mock.calls.length - 1];
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

    expect(mockSearchContent).toHaveBeenCalled();
    const latestCall = mockSearchContent.mock.calls[mockSearchContent.mock.calls.length - 1];
    const [, options] = latestCall;
    expect(options?.dateFromUnix).toBeUndefined();
    expect(options?.dateToUnix).toBeUndefined();
  });

  it("skips facets fetch and logs warning when date filters are invalid", async () => {
    const store = useSearchStore();
    store.facets = emptyFacets;
    store.dateTo = "invalid-date";

    await store.fetchFacets("hello");

    expect(mockGetSearchFacets).not.toHaveBeenCalled();
    expect(store.facets).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      "[search] Skipping search facets fetch due to invalid date filter:",
      "Invalid date filter: To date is not a valid date.",
    );
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

describe("useSearchStore FTS maintenance", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetAllMocks();
    setupDefaultMocks();
  });

  // ── runIntegrityCheck ──────────────────────────────────────────

  it("runIntegrityCheck sets maintenanceMessage on success", async () => {
    mockFtsIntegrityCheck.mockResolvedValue("integrity_check: 1 row(s) ok");
    const store = useSearchStore();
    await store.runIntegrityCheck();
    expect(store.maintenanceMessage).toBe("integrity_check: 1 row(s) ok");
  });

  it("runIntegrityCheck clears maintenanceMessage before running", async () => {
    const store = useSearchStore();
    store.maintenanceMessage = "previous message";
    mockFtsIntegrityCheck.mockResolvedValue("ok");
    await store.runIntegrityCheck();
    expect(store.maintenanceMessage).toBe("ok");
  });

  it("runIntegrityCheck sets Error-prefixed message using toErrorMessage on failure", async () => {
    mockFtsIntegrityCheck.mockRejectedValue(new Error("index corrupted"));
    const store = useSearchStore();
    await store.runIntegrityCheck();
    // toErrorMessage(new Error("index corrupted")) = "index corrupted"
    expect(store.maintenanceMessage).toBe("Error: index corrupted");
  });

  it("runIntegrityCheck handles non-Error thrown values without [object Object]", async () => {
    mockFtsIntegrityCheck.mockRejectedValue({ message: "constraint violation" });
    const store = useSearchStore();
    await store.runIntegrityCheck();
    // toErrorMessage extracts the .message property from thrown objects
    expect(store.maintenanceMessage).toBe("Error: constraint violation");
    expect(store.maintenanceMessage).not.toContain("[object Object]");
  });

  // ── runOptimize ────────────────────────────────────────────────

  it("runOptimize sets maintenanceMessage on success", async () => {
    mockFtsOptimize.mockResolvedValue("optimize complete");
    const store = useSearchStore();
    await store.runOptimize();
    expect(store.maintenanceMessage).toBe("optimize complete");
  });

  it("runOptimize refreshes health info after a successful run", async () => {
    mockFtsOptimize.mockResolvedValue("done");
    mockFtsHealth.mockResolvedValue({ inSync: true, indexedSessions: 5, totalSessions: 5, totalContentRows: 100, pendingSessions: 0, dbSizeBytes: 1024 });
    const store = useSearchStore();
    await store.runOptimize();
    expect(mockFtsHealth).toHaveBeenCalledTimes(1);
  });

  it("runOptimize sets Error-prefixed message using toErrorMessage on failure", async () => {
    mockFtsOptimize.mockRejectedValue(new Error("write lock held"));
    const store = useSearchStore();
    await store.runOptimize();
    // toErrorMessage(new Error("write lock held")) = "write lock held"
    expect(store.maintenanceMessage).toBe("Error: write lock held");
  });

  it("runOptimize does not refresh health when optimize fails", async () => {
    mockFtsOptimize.mockRejectedValue(new Error("failed"));
    const store = useSearchStore();
    await store.runOptimize();
    expect(mockFtsHealth).not.toHaveBeenCalled();
  });

  it("runOptimize handles non-Error thrown values without [object Object]", async () => {
    mockFtsOptimize.mockRejectedValue({ message: "database busy" });
    const store = useSearchStore();
    await store.runOptimize();
    expect(store.maintenanceMessage).toBe("Error: database busy");
    expect(store.maintenanceMessage).not.toContain("[object Object]");
  });

  it("runIntegrityCheck handles null rejection with fallback message", async () => {
    mockFtsIntegrityCheck.mockRejectedValue(null);
    const store = useSearchStore();
    await store.runIntegrityCheck();
    // toErrorMessage(null) = "Unknown error"
    expect(store.maintenanceMessage).toBe("Error: Unknown error");
  });

  it("runOptimize handles thrown string values", async () => {
    mockFtsOptimize.mockRejectedValue("permission denied");
    const store = useSearchStore();
    await store.runOptimize();
    // toErrorMessage("permission denied") = "permission denied" (String fallback)
    expect(store.maintenanceMessage).toBe("Error: permission denied");
  });
});
