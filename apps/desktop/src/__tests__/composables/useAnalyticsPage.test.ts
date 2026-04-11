import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

// ── Mock client ───────────────────────────────────────────────
const { mockGetAnalytics, mockGetToolAnalysis, mockGetCodeImpact } = vi.hoisted(() => ({
  mockGetAnalytics: vi.fn().mockResolvedValue({
    totalSessions: 0,
    totalTokens: 0,
    totalCost: 0,
    totalPremiumRequests: 0,
    averageHealthScore: 0,
    tokenUsageByDay: [],
    activityPerDay: [],
    modelDistribution: [],
    costByDay: [],
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
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    getAnalytics: (...args: unknown[]) => mockGetAnalytics(...args),
    getToolAnalysis: (...args: unknown[]) => mockGetToolAnalysis(...args),
    getCodeImpact: (...args: unknown[]) => mockGetCodeImpact(...args),
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
// ── Import after mocks are in place ───────────────────────────
import { useAnalyticsStore } from "../../stores/analytics";

describe("useAnalyticsPage", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    mountCallbacks = [];
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
    expect(fetchSpy).toHaveBeenCalledWith();
  });

  it("calls the named fetch method with force:true when selectedRepo changes", async () => {
    const store = useAnalyticsStore();
    const fetchSpy = vi.spyOn(store, "fetchToolAnalysis").mockResolvedValue(undefined);

    useAnalyticsPage("fetchToolAnalysis");

    store.setRepo("my-repo");
    await nextTick();

    expect(fetchSpy).toHaveBeenCalledWith({ force: true });
  });

  it("calls the named fetch method with force:true when dateRange changes", async () => {
    const store = useAnalyticsStore();
    const fetchSpy = vi.spyOn(store, "fetchCodeImpact").mockResolvedValue(undefined);

    useAnalyticsPage("fetchCodeImpact");

    store.setTimeRange("7d");
    await nextTick();

    expect(fetchSpy).toHaveBeenCalledWith({ force: true });
  });
});
