import { setupPinia } from "@tracepilot/test-utils";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalyticsDashboardViews } from "../../composables/useAnalyticsDashboardViews";
import AnalyticsDashboardView from "../../views/AnalyticsDashboardView.vue";
import CodeImpactView from "../../views/CodeImpactView.vue";
import ToolAnalysisView from "../../views/ToolAnalysisView.vue";
import { FIXTURE_ANALYTICS, FIXTURE_CODE_IMPACT, FIXTURE_TOOL_ANALYSIS } from "./analyticsFixtures";

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

// ── Tests ─────────────────────────────────────────────────────

describe("AnalyticsDashboardView", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    resetAnalyticsDashboardViews();
  });

  async function mountDashboard(data: unknown = FIXTURE_ANALYTICS) {
    mockGetAnalytics.mockResolvedValue(data);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);
    await flushPromises();
    return wrapper;
  }

  it("leads with sessions, tokens, AI Credits, model time and errors", async () => {
    const wrapper = await mountDashboard();
    const kpis = wrapper.get('[data-testid="analytics-kpis"]').text();
    expect(kpis).toContain("Sessions");
    expect(kpis).toContain("10 runs");
    expect(kpis).toContain("2.5M");
    // Payloads that predate sources are Copilot's, so cost reads in AI Credits.
    expect(kpis).toContain("AI Credits");
    expect(kpis).toContain("160");
    expect(kpis).toContain("$1.60");
    expect(kpis).toContain("Model time / session");
    expect(kpis).toContain("20m");
    expect(kpis).toContain("3 rate limits");
  }, 10_000);

  it("shows model time on a log strip with the pace figures", async () => {
    const wrapper = await mountDashboard();
    const pace = wrapper.get('[data-testid="analytics-pace"]').text();
    expect(pace).toContain("8 of 10 sessions timed");
    expect(pace).toContain("median");
    expect(pace).toContain("p95");
    expect(pace).toContain("8.5");
    expect(pace).toContain("4.2");
    expect(pace).toContain("Output speed");
  });

  it("lists models by share of tokens with their cost", async () => {
    const wrapper = await mountDashboard();
    const mix = wrapper.get('[data-testid="analytics-model-mix"]').text();
    expect(mix).toContain("gpt-4");
    expect(mix).toContain("claude-3");
    expect(mix).toContain("60%");
    expect(mix).toContain("40%");
    expect(mix).toContain("96 AIC");
  });

  it("charts cost per day by default and remembers another metric", async () => {
    const wrapper = await mountDashboard();
    const activity = wrapper.get('[data-testid="analytics-activity"]');
    const radio = (label: string) =>
      activity.findAll('[role="radio"]').find((b) => b.text() === label);
    expect(radio("Cost")?.attributes("aria-checked")).toBe("true");
    expect(activity.find('[aria-label="Cost per day"]').exists()).toBe(true);

    await radio("Tokens")?.trigger("click");
    await radio("Lines")?.trigger("click");
    await flushPromises();
    expect(activity.find('[aria-label="Tokens per day"]').exists()).toBe(true);
    expect(
      JSON.parse(localStorage.getItem("tracepilot-analytics-dashboard-views") ?? "{}"),
    ).toMatchObject({ activityMetric: "tokens", activityStyle: "lines" });
  });

  it("gives Copilot's cost card the legacy premium figure", async () => {
    const wrapper = await mountDashboard();
    const card = wrapper.get('[data-source="copilot"]').text();
    expect(card).toContain("160 AIC");
    expect(card).toContain("observed billing");
    expect(card).toContain("40 req");
  });

  it("shows error state with retry button", async () => {
    mockGetAnalytics.mockRejectedValue(new Error("Backend unavailable"));
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("Failed to load analytics");
    expect(wrapper.text()).toContain("Backend unavailable");
    expect(wrapper.find(".error-state button").text()).toContain("Retry");
  });

  it("does not render StubBanner", async () => {
    const wrapper = await mountDashboard();
    expect(wrapper.find('[class*="stub"]').exists()).toBe(false);
  });

  it("handles data without duration stats gracefully", async () => {
    const wrapper = await mountDashboard({
      ...FIXTURE_ANALYTICS,
      apiDurationStats: undefined,
    });
    expect(wrapper.text()).toContain("No model timing recorded");
    expect(wrapper.text()).toContain("No session in this range recorded model time.");
  });
});

describe("ToolAnalysisView", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
  });

  it("renders tool analysis stat cards", async () => {
    mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("50"); // totalCalls
    expect(wrapper.text()).toContain("edit"); // mostUsedTool
    expect(wrapper.text()).toContain("95%"); // successRate
  });

  it("renders tool table with sorted tools", async () => {
    mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("edit");
    expect(wrapper.text()).toContain("view");
    expect(wrapper.text()).toContain("30"); // edit callCount
    expect(wrapper.text()).toContain("20"); // view callCount
  });

  it("shows error state on failure", async () => {
    mockGetToolAnalysis.mockRejectedValue(new Error("Parse error"));
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("Failed to load tool analysis");
    expect(wrapper.text()).toContain("Parse error");
  });

  it("does not render StubBanner", async () => {
    mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.find('[class*="stub"]').exists()).toBe(false);
  });

  it("renders heatmap grid", async () => {
    mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("Activity Heatmap");
    expect(wrapper.text()).toContain("Mon");
    expect(wrapper.text()).toContain("Sun");
  });
});

describe("CodeImpactView", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
  });

  it("renders code impact stat cards", async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("15"); // filesModified
    expect(wrapper.text()).toContain("1,000"); // linesAdded
    expect(wrapper.text()).toContain("300"); // linesRemoved
    expect(wrapper.text()).toContain("700"); // netChange
  });

  it("renders file type breakdown", async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain(".ts");
    expect(wrapper.text()).toContain(".vue");
  });

  it("renders most modified files", async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("src/index.ts");
    expect(wrapper.text()).toContain("src/App.vue");
  });

  it("shows error state on failure", async () => {
    mockGetCodeImpact.mockRejectedValue(new Error("disk error"));
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("Failed to load code impact data");
    expect(wrapper.text()).toContain("disk error");
  });

  it("does not render StubBanner", async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.find('[class*="stub"]').exists()).toBe(false);
  });

  it("renders changes over time chart", async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("Changes Over Time");
    const svgs = wrapper.findAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  it("shows timeline details when hovering the code chart", async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);
    await flushPromises();

    const svgWrapper = wrapper.find(".code-timeline-chart svg");
    const svg = svgWrapper.element as SVGSVGElement;
    Object.defineProperty(svg, "createSVGPoint", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        matrixTransform: () => ({ x: 365, y: 100 }),
      }),
    });
    Object.defineProperty(svg, "getScreenCTM", {
      configurable: true,
      value: () => ({ inverse: () => ({}) }),
    });

    await svgWrapper.trigger("mousemove", { clientX: 100, clientY: 100 });
    await flushPromises();

    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain("+300 / -80");
    wrapper.unmount();
  });

  it("strides dense date labels in the changes chart", async () => {
    const changesByDay = Array.from({ length: 30 }, (_, index) => ({
      date: `2025-01-${String(index + 1).padStart(2, "0")}`,
      additions: index + 1,
      deletions: index,
    }));
    mockGetCodeImpact.mockResolvedValue({ ...FIXTURE_CODE_IMPACT, changesByDay });
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    const xLabels = wrapper
      .findAll(".code-timeline-chart .chart-label")
      .filter((label) => label.attributes("text-anchor") === "middle");
    expect(xLabels.length).toBeGreaterThan(0);
    expect(xLabels.length).toBeLessThanOrEqual(8);
  });

  it("shows positive net change with correct label", async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("+700");
    expect(wrapper.text()).toContain("Net positive");
  });

  it("shows negative net change with correct label", async () => {
    const negativeData = { ...FIXTURE_CODE_IMPACT, netChange: -200 };
    mockGetCodeImpact.mockResolvedValue(negativeData);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("-200");
    expect(wrapper.text()).toContain("Net negative");
    expect(wrapper.text()).not.toContain("Net positive");
  });

  it("shows most modified files as session frequency", async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    // Should show "100 sessions" not "+100"
    expect(wrapper.text()).toContain("session");
    expect(wrapper.text()).not.toMatch(/\+100/);
  });
});
