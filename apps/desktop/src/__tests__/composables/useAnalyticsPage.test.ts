import { setupPinia } from "@tracepilot/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

// ── Mock client ───────────────────────────────────────────────
const { mockGetAnalytics, mockGetToolAnalysis, mockGetCodeImpact, mockListSessions } = vi.hoisted(
  () => ({
    mockListSessions: vi.fn().mockResolvedValue([]),
    mockGetAnalytics: vi.fn().mockResolvedValue({
      totalSessions: 0,
      totalTokens: 0,
      totalCost: 0,
      totalPremiumRequests: 0,
      tokenUsageByDay: [],
      activityPerDay: [],
      modelDistribution: [],
      costByDay: [],
      modelUsageByDay: [],
      sessionsWithErrors: 0,
      totalRateLimits: 0,
      totalCompactions: 0,
      totalTruncations: 0,
      incidentsByDay: [],
    }),
    mockGetToolAnalysis: vi.fn().mockResolvedValue({
      totalCalls: 0,
      successRate: 0,
      avgDurationMs: 0,
      mostUsedTool: "",
      tools: [],
      activityHeatmap: [],
    }),
    mockGetCodeImpact: vi.fn().mockResolvedValue({
      filesModified: 0,
      linesAdded: 0,
      linesRemoved: 0,
      netChange: 0,
      fileTypeBreakdown: [],
      mostModifiedFiles: [],
      changesByDay: [],
    }),
  }),
);

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    getAnalytics: (...args: unknown[]) => mockGetAnalytics(...args),
    getToolAnalysis: (...args: unknown[]) => mockGetToolAnalysis(...args),
    getCodeImpact: (...args: unknown[]) => mockGetCodeImpact(...args),
    listSessions: (...args: unknown[]) => mockListSessions(...args),
  });
});

// ── Track onMounted callbacks manually ────────────────────────
let mountCallbacks: (() => void)[] = [];
vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue");
  return {
    ...actual,
    onMounted: (cb: () => void) => {
      mountCallbacks.push(cb);
    },
  };
});

import { useAnalyticsPage } from "../../composables/useAnalyticsPage";
import { STORAGE_KEYS } from "../../config/storageKeys";
// ── Import after mocks are in place ───────────────────────────
import { useAnalyticsStore } from "../../stores/analytics";

describe("useAnalyticsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    setupPinia();
    vi.clearAllMocks();
    mountCallbacks = [];
  });

  // Mount callbacks start background prefetching; stop it so it can't run
  // after the test environment is torn down.
  afterEach(() => {
    useAnalyticsStore().cancelPrefetch();
  });

  it("returns the analytics store instance", () => {
    const { store } = useAnalyticsPage("fetchAnalytics");
    expect(store).toBe(useAnalyticsStore());
  });

  it("calls fetchAvailableRepos and the named fetch method on mount", async () => {
    const store = useAnalyticsStore();
    const reposSpy = vi.spyOn(store, "fetchAvailableRepos").mockResolvedValue(undefined);
    const fetchSpy = vi.spyOn(store, "fetchAnalytics").mockResolvedValue(undefined);

    useAnalyticsPage("fetchAnalytics");

    // Simulate mount
    for (const cb of mountCallbacks) await cb();

    expect(reposSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith({ background: true });
  });

  it("refetches (using the per-filter cache) when selectedRepo changes", async () => {
    const store = useAnalyticsStore();
    const fetchSpy = vi.spyOn(store, "fetchToolAnalysis").mockResolvedValue(undefined);

    useAnalyticsPage("fetchToolAnalysis");

    store.setRepo("my-repo");
    await nextTick();

    expect(fetchSpy).toHaveBeenCalledWith({ background: true });
  });

  it("refetches (using the per-filter cache) when dateRange changes", async () => {
    const store = useAnalyticsStore();
    const fetchSpy = vi.spyOn(store, "fetchCodeImpact").mockResolvedValue(undefined);

    useAnalyticsPage("fetchCodeImpact");

    store.setTimeRange("7d");
    await nextTick();

    expect(fetchSpy).toHaveBeenCalledWith({ background: true });
  });

  it("loads once, without a remembered repository the session list no longer has", async () => {
    localStorage.setItem(
      STORAGE_KEYS.analyticsFilters,
      JSON.stringify({ repo: "org/gone", source: null, range: "all" }),
    );
    let resolveSessions: (sessions: unknown[]) => void = () => {};
    mockListSessions.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSessions = resolve;
      }),
    );

    const { store } = useAnalyticsPage("fetchAnalytics");
    for (const cb of mountCallbacks) cb();
    await nextTick();
    expect(mockGetAnalytics).not.toHaveBeenCalled();

    resolveSessions([{ id: "s1", repository: "org/app", source: "copilot" }]);
    await vi.waitFor(() => expect(mockGetAnalytics).toHaveBeenCalled());
    await nextTick();

    expect(store.selectedRepo).toBeNull();
    expect(mockGetAnalytics).toHaveBeenCalledOnce();
    expect(mockGetAnalytics.mock.calls[0][0]).toMatchObject({ repo: undefined });
  });

  it("keeps a remembered repository the session list still has", async () => {
    localStorage.setItem(
      STORAGE_KEYS.analyticsFilters,
      JSON.stringify({ repo: "org/app", source: null, range: "all" }),
    );
    mockListSessions.mockResolvedValueOnce([
      { id: "s1", repository: "org/app", source: "copilot" },
    ]);

    const { store } = useAnalyticsPage("fetchAnalytics");
    for (const cb of mountCallbacks) cb();
    await vi.waitFor(() => expect(mockGetAnalytics).toHaveBeenCalled());
    await nextTick();

    expect(store.selectedRepo).toBe("org/app");
    expect(mockGetAnalytics).toHaveBeenCalledOnce();
    expect(mockGetAnalytics.mock.calls[0][0]).toMatchObject({ repo: "org/app" });
  });

  it("refetches once in the background when a reindex bumps dataRevision", async () => {
    const store = useAnalyticsStore();
    const fetchSpy = vi.spyOn(store, "fetchAnalytics").mockResolvedValue(undefined);

    useAnalyticsPage("fetchAnalytics");

    store.dataRevision += 1;
    await nextTick();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith({ background: true });
  });
});
