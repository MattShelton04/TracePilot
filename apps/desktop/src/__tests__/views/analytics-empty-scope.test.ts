import { setupPinia } from "@tracepilot/test-utils";
import type {
  AnalyticsData,
  CodeImpactData,
  SessionSource,
  ToolAnalysisData,
} from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalyticsDashboardViews } from "../../composables/useAnalyticsDashboardViews";
import { useAnalyticsStore } from "../../stores/analytics";
import type { AnalyticsTimeRange } from "../../utils/analyticsFilters";
import AnalyticsDashboardView from "../../views/AnalyticsDashboardView.vue";
import CodeImpactView from "../../views/CodeImpactView.vue";
import ToolAnalysisView from "../../views/ToolAnalysisView.vue";
import { FIXTURE_ANALYTICS, FIXTURE_TOOL_ANALYSIS } from "./analyticsFixtures";

const mockGetAnalytics = vi.fn();
const mockGetToolAnalysis = vi.fn();
const mockGetCodeImpact = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    checkConfigExists: vi.fn().mockResolvedValue(false),
    getConfig: vi.fn().mockResolvedValue(null),
    skillsListAll: vi.fn().mockResolvedValue({ skills: [], diagnostics: [] }),
    skillsUsageSummary: vi.fn().mockResolvedValue({
      totalUses: 0,
      totalSessions: 0,
      unknownTriggerUses: 0,
      fallbackUses: 0,
      totalContentTokens: 0,
      usesWithContent: 0,
      skills: [],
    }),
    getAnalytics: (...args: unknown[]) => mockGetAnalytics(...args),
    getToolAnalysis: (...args: unknown[]) => mockGetToolAnalysis(...args),
    getCodeImpact: (...args: unknown[]) => mockGetCodeImpact(...args),
  });
});

const globalStubs = {
  global: {
    stubs: {
      LoadingOverlay: {
        props: { loading: Boolean, message: String },
        template: '<div v-if="loading">Loading…</div><slot v-else />',
      },
      RouterLink: { template: "<a><slot /></a>", props: ["to"] },
    },
  },
};

enableAutoUnmount(afterEach);

const EMPTY_ANALYTICS: AnalyticsData = {
  ...FIXTURE_ANALYTICS,
  totalSessions: 0,
  totalTokens: 0,
  totalCost: 0,
  totalPremiumRequests: 0,
  totalNanoAiu: 0,
  sessionsWithObservedAiCredits: 0,
  tokenUsageByDay: [],
  activityPerDay: [],
  modelDistribution: [],
  costByDay: [],
  modelUsageByDay: [],
  // Payloads from before model timing was recorded omit it.
  apiDurationStats: undefined as unknown as AnalyticsData["apiDurationStats"],
  cacheStats: {
    totalCacheReadTokens: 0,
    totalInputTokens: 0,
    cacheHitRate: 0,
    nonCachedInputTokens: 0,
  },
  sessionsWithErrors: 0,
  totalRateLimits: 0,
  totalCompactions: 0,
  totalTruncations: 0,
  incidentsByDay: [],
};

const EMPTY_TOOLS: ToolAnalysisData = {
  ...FIXTURE_TOOL_ANALYSIS,
  totalCalls: 0,
  tools: [],
  activityHeatmap: [],
  callsByDay: [],
};

const EMPTY_CODE: CodeImpactData = {
  filesModified: 0,
  linesAdded: 0,
  linesRemoved: 0,
  netChange: 0,
  fileTypeBreakdown: [],
  mostModifiedFiles: [],
  changesByDay: [],
};

interface Scope {
  range: AnalyticsTimeRange;
  repo?: string;
  source?: SessionSource;
}

/**
 * Each case: the filters, then the source and scope words every empty state
 * should carry. The Activity sentence is spelled out so the table reads as copy.
 */
const CASES: [string, Scope, string, string, string][] = [
  ["nothing filtered", { range: "all" }, "", "", "No sessions ended."],
  [
    "a repository and a source over all time",
    { range: "all", repo: "project:harbor", source: "copilot" },
    "Copilot ",
    " in harbor",
    "No Copilot sessions ended in harbor.",
  ],
  [
    "a repository over a range",
    { range: "7d", repo: "project:harbor" },
    "",
    " in harbor in the past 7 days",
    "No sessions ended in harbor in the past 7 days.",
  ],
  [
    "a source this month",
    { range: "month-to-date", source: "claudeCode" },
    "Claude Code ",
    " this month",
    "No Claude Code sessions ended this month.",
  ],
  [
    "a range only",
    { range: "30d" },
    "",
    " in the past 30 days",
    "No sessions ended in the past 30 days.",
  ],
];

async function mountWith(view: object, scope: Scope) {
  const wrapper = mount(view, globalStubs);
  await flushPromises();
  const store = useAnalyticsStore();
  store.setRepo(scope.repo ?? null);
  store.setSource(scope.source ?? null);
  store.setTimeRange(scope.range);
  await flushPromises();
  return wrapper;
}

/** Never blame a range for what a repository or source filter emptied. */
function expectNoRangeBlame(text: string) {
  expect(text).not.toContain("any session");
  expect(text).not.toContain("this range");
}

describe("analytics empty states name the filters that emptied them", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    resetAnalyticsDashboardViews();
    mockGetAnalytics.mockResolvedValue(EMPTY_ANALYTICS);
    mockGetToolAnalysis.mockResolvedValue(EMPTY_TOOLS);
    mockGetCodeImpact.mockResolvedValue(EMPTY_CODE);
  });

  it.each(CASES)("Analytics, %s", async (_, scope, s, x, activity) => {
    const wrapper = await mountWith(AnalyticsDashboardView, scope);
    const panel = (id: string) => wrapper.get(`[data-testid="${id}"]`).text();
    expect(panel("analytics-activity")).toContain(activity);
    expect(panel("analytics-cost")).toContain(`No ${s}usage${x}.`);
    expect(panel("analytics-incidents")).toContain(`No ${s}sessions ended${x}.`);
    expect(wrapper.text()).toContain(`No ${s}model calls were recorded${x}.`);
    expect(wrapper.text()).toContain(`No ${s}model usage${x}.`);
    expect(panel("analytics-cache")).toContain(`No ${s}model input${x}.`);
    expect(panel("analytics-pace")).toContain(`No ${s}session${x} recorded model time.`);
    expect(wrapper.text()).toContain(`No ${s}skill uses were indexed${x}.`);
    expectNoRangeBlame(wrapper.text());
  });

  it.each(CASES)("Tools, %s", async (_, scope, s, x) => {
    const wrapper = await mountWith(ToolAnalysisView, scope);
    const panel = (id: string) => wrapper.get(`[data-testid="${id}"]`).text();
    expect(panel("tool-calls-per-day")).toContain(`No ${s}sessions with tool calls ended${x}.`);
    expect(panel("tool-rank")).toContain(`No ${s}tool calls were recorded${x}.`);
    expect(panel("tool-heatmap")).toContain(`No ${s}session${x} called a tool.`);
    expect(panel("tool-kpis")).toContain("No tool calls");
    expectNoRangeBlame(wrapper.text());
  });

  it.each(CASES)("Code, %s", async (_, scope, s, x) => {
    const wrapper = await mountWith(CodeImpactView, scope);
    const panel = (id: string) => wrapper.get(`[data-testid="${id}"]`).text();
    expect(panel("code-changes-per-day")).toContain(
      `No ${s}session${x} reported lines added or removed.`,
    );
    expect(panel("code-file-types")).toContain(`No ${s}session${x} recorded a file change.`);
    expect(panel("code-files")).toContain(`No ${s}session${x} recorded a file change.`);
    expectNoRangeBlame(wrapper.text());
  });
});
