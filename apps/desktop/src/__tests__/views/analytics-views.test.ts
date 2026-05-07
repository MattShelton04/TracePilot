import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

// ── Lazy-load view components so mocks are in place ───────────
async function loadAnalyticsDashboard() {
  const mod = await import("../../views/AnalyticsDashboardView.vue");
  return mod.default;
}

async function loadToolAnalysis() {
  const mod = await import("../../views/ToolAnalysisView.vue");
  return mod.default;
}

async function loadCodeImpact() {
  const mod = await import("../../views/CodeImpactView.vue");
  return mod.default;
}

// ── Tests ─────────────────────────────────────────────────────

describe("AnalyticsDashboardView", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
  });

  it("renders stat cards with analytics data", async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("10"); // totalSessions
    expect(wrapper.text()).toContain("2.5M"); // totalTokens
    expect(wrapper.text()).toContain("$1.60"); // copilotCost
    expect(wrapper.text()).toContain("Legacy Copilot Cost");
    expect(wrapper.text()).toContain("Direct API Estimate");
  }, 10_000);

  it("renders duration stats section", async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("API Duration");
    expect(wrapper.text()).toContain("Average");
    expect(wrapper.text()).toContain("Median");
    expect(wrapper.text()).toContain("P95");
  });

  it("renders productivity metrics section", async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("Productivity Metrics");
    expect(wrapper.text()).toContain("8.5"); // avgTurnsPerSession
    expect(wrapper.text()).toContain("4.2"); // avgToolCallsPerTurn
    expect(wrapper.text()).toContain("Tokens / API Second");
  });

  it("renders cache efficiency section", async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("Cache Efficiency");
    expect(wrapper.text()).toContain("Cache Hit Rate");
    expect(wrapper.text()).toContain("24%");
    expect(wrapper.text()).toContain("Cached Tokens");
  });

  it("renders request count in model distribution legend", async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("180 req");
    expect(wrapper.text()).toContain("120 req");
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
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.find('[class*="stub"]').exists()).toBe(false);
  });

  it("does not show hardcoded trend percentages", async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).not.toContain("↑ 12%");
    expect(wrapper.text()).not.toContain("↑ 18%");
    expect(wrapper.text()).not.toContain("↓ 3%");
  });

  it("renders SVG charts when data has multiple points", async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    const svgs = wrapper.findAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  it("renders model distribution donut chart", async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("Model Distribution");
    expect(wrapper.text()).toContain("gpt-4");
    expect(wrapper.text()).toContain("claude-3");
    expect(wrapper.text()).toContain("60%");
    expect(wrapper.text()).toContain("40%");
  });

  it("handles data without duration stats gracefully", async () => {
    const dataWithoutDuration = {
      ...FIXTURE_ANALYTICS,
      apiDurationStats: undefined,
      productivityMetrics: undefined,
    };
    mockGetAnalytics.mockResolvedValue(dataWithoutDuration);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("10");
    expect(wrapper.text()).not.toContain("API Duration");
  });

  it("renders the cost basis toggle with both options and defaults to legacy", async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    // Panel title reflects the legacy default.
    expect(wrapper.text()).toContain("Legacy Copilot Cost Trend");
    expect(wrapper.text()).not.toContain("Direct API Cost Trend");

    const radios = wrapper.findAll('[role="radio"]');
    const legacyBtn = radios.find((b) => b.text().includes("Legacy Copilot"));
    const directBtn = radios.find((b) => b.text().includes("Direct API"));
    expect(legacyBtn).toBeTruthy();
    expect(directBtn).toBeTruthy();
    expect(legacyBtn!.attributes("aria-checked")).toBe("true");
    expect(directBtn!.attributes("aria-checked")).toBe("false");

    // Default chart aria label reflects the legacy basis.
    const chartSvg = wrapper
      .findAll("svg")
      .find((s) => /legacy Copilot cost trend/i.test(s.attributes("aria-label") ?? ""));
    expect(chartSvg).toBeTruthy();
  });

  it("switches the cost graph to the direct API basis when toggled", async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    const directBtn = wrapper
      .findAll('[role="radio"]')
      .find((b) => b.text().includes("Direct API"));
    expect(directBtn).toBeTruthy();
    await directBtn!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Direct API Cost Trend");
    expect(wrapper.text()).not.toContain("Legacy Copilot Cost Trend");
    expect(directBtn!.attributes("aria-checked")).toBe("true");

    const chartSvg = wrapper
      .findAll("svg")
      .find((s) => /direct API cost trend/i.test(s.attributes("aria-label") ?? ""));
    expect(chartSvg).toBeTruthy();
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
