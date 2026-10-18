import { setupPinia } from "@tracepilot/test-utils";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalyticsDashboardViews } from "../../composables/useAnalyticsDashboardViews";
import { useAnalyticsStore } from "../../stores/analytics";
import AnalyticsDashboardView from "../../views/AnalyticsDashboardView.vue";
import CodeImpactView from "../../views/CodeImpactView.vue";
import ToolAnalysisView from "../../views/ToolAnalysisView.vue";
import { FIXTURE_ANALYTICS, FIXTURE_CODE_IMPACT, FIXTURE_TOOL_ANALYSIS } from "./analyticsFixtures";

// Page subtitles say what the numbers cover: the range, repository and source.

// ── Mock client ───────────────────────────────────────────────
const mockGetAnalytics = vi.fn();
const mockGetToolAnalysis = vi.fn();
const mockGetCodeImpact = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    // Preferences store hydrates on creation — keep false/null to match
    // pre-refactor behavior and avoid config-driven side effects in tests
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

// ── LoadingOverlay stub ───────────────────────────────────────
const LoadingOverlayStub = {
  name: "LoadingOverlay",
  props: { loading: Boolean, message: String },
  template: '<div v-if="loading" class="loading-stub">Loading…</div><slot v-else />',
};

const RouterLinkStub = { template: "<a><slot /></a>", props: ["to"] };

const globalStubs = {
  global: {
    stubs: { LoadingOverlay: LoadingOverlayStub, RouterLink: RouterLinkStub },
  },
};

enableAutoUnmount(afterEach);

// Hoisted mocks apply to static imports, keeping first import compilation outside test deadlines.
async function loadAnalyticsDashboard() {
  return AnalyticsDashboardView;
}

async function loadToolAnalysis() {
  return ToolAnalysisView;
}

async function loadCodeImpact() {
  return CodeImpactView;
}

describe("analytics page subtitles", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    resetAnalyticsDashboardViews();
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
  });

  it.each([
    ["Analytics", loadAnalyticsDashboard],
    ["Tools", loadToolAnalysis],
    ["Code", loadCodeImpact],
  ])("%s names a folder-only project by its folder, as the filter lists it", async (_, load) => {
    const wrapper = mount(await load(), globalStubs);
    await flushPromises();
    const store = useAnalyticsStore();

    store.setRepo("project:harbor");
    await flushPromises();
    expect(wrapper.text()).toContain(" in harbor");
    expect(wrapper.text()).not.toContain("project:harbor");

    store.setRepo("example/orchard");
    await flushPromises();
    expect(wrapper.text()).toContain(" in example/orchard");
  });

  it.each([
    [1, "Aggregate metrics across 1 session in harbor"],
    [10, "Aggregate metrics across 10 sessions in harbor"],
  ])("Analytics agrees the noun with %i session(s)", async (totalSessions, subtitle) => {
    mockGetAnalytics.mockResolvedValue({ ...FIXTURE_ANALYTICS, totalSessions });
    const wrapper = mount(await loadAnalyticsDashboard(), globalStubs);
    await flushPromises();
    useAnalyticsStore().setRepo("project:harbor");
    await flushPromises();
    expect(wrapper.text()).toContain(subtitle);
  });

  it.each([
    ["all", 12, "Aggregate metrics across all 12 sessions"],
    ["month-to-date", 6, "Aggregate metrics across 6 sessions this month"],
    ["30d", 1, "Aggregate metrics across 1 session in the past 30 days"],
    ["7d", 0, "No sessions in the past 7 days"],
    ["all", 0, "No sessions"],
  ] as const)("Analytics names the %s range in its subtitle (%i sessions)", async (range, totalSessions, subtitle) => {
    mockGetAnalytics.mockResolvedValue({ ...FIXTURE_ANALYTICS, totalSessions });
    const wrapper = mount(await loadAnalyticsDashboard(), globalStubs);
    await flushPromises();
    useAnalyticsStore().setTimeRange(range);
    await flushPromises();
    expect(wrapper.get(".page-subtitle").text()).toBe(subtitle);
  });

  it.each([
    ["Tools", loadToolAnalysis, "all", "Performance and usage metrics across all tool invocations"],
    [
      "Tools",
      loadToolAnalysis,
      "30d",
      "Performance and usage metrics across tool invocations in the past 30 days",
    ],
    [
      "Tools",
      loadToolAnalysis,
      "month-to-date",
      "Performance and usage metrics across tool invocations this month",
    ],
    ["Code", loadCodeImpact, "all", "Code changes and file modifications across all sessions"],
    [
      "Code",
      loadCodeImpact,
      "30d",
      "Code changes and file modifications across sessions in the past 30 days",
    ],
  ] as const)("%s says 'all' only when no range narrows it (%s)", async (_, load, range, subtitle) => {
    const wrapper = mount(await load(), globalStubs);
    await flushPromises();
    useAnalyticsStore().setTimeRange(range);
    await flushPromises();
    expect(wrapper.get(".page-subtitle").text()).toBe(subtitle);
  });

  it.each([
    [
      "Tools",
      loadToolAnalysis,
      "Performance and usage metrics across tool invocations in harbor in the past 7 days",
    ],
    [
      "Code",
      loadCodeImpact,
      "Code changes and file modifications across sessions in harbor in the past 7 days",
    ],
  ] as const)("%s names the repository and the range together", async (_, load, subtitle) => {
    const wrapper = mount(await load(), globalStubs);
    await flushPromises();
    const store = useAnalyticsStore();
    store.setRepo("project:harbor");
    store.setTimeRange("7d");
    await flushPromises();
    expect(wrapper.get(".page-subtitle").text()).toBe(subtitle);
  });

  it("claims no count while the first result loads", async () => {
    mockGetAnalytics.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(await loadAnalyticsDashboard(), globalStubs);
    await flushPromises();
    expect(wrapper.get(".page-subtitle").text()).toBe("Aggregate metrics across sessions");
  });

  it("names the range and the repository together", async () => {
    mockGetAnalytics.mockResolvedValue({ ...FIXTURE_ANALYTICS, totalSessions: 0 });
    const wrapper = mount(await loadAnalyticsDashboard(), globalStubs);
    await flushPromises();
    const store = useAnalyticsStore();
    store.setRepo("project:harbor");
    store.setTimeRange("7d");
    await flushPromises();
    expect(wrapper.get(".page-subtitle").text()).toBe("No sessions in harbor in the past 7 days");
  });
});
