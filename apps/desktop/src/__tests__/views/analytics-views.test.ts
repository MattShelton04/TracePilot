import { setupPinia } from "@tracepilot/test-utils";
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
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

  it("leads with sessions, tokens, cost, model time and errors", async () => {
    const wrapper = await mountDashboard();
    const kpis = wrapper.get('[data-testid="analytics-kpis"]').text();
    expect(kpis).toContain("Sessions");
    expect(kpis).toContain("10 runs");
    expect(kpis).toContain("2.5M");
    // Payloads that predate sources are Copilot's: 160 AI Credits at $0.01 each.
    expect(kpis).toContain("Cost");
    expect(kpis).toContain("$1.60");
    expect(kpis).not.toContain("AI Credits");
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
    expect(mix).toContain("$0.96");
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
    expect(wrapper.text()).toContain("No session recorded model time.");
  });
});

const radio = (root: ReturnType<VueWrapper["get"]>, label: string) =>
  root.findAll('[role="radio"]').find((b) => b.text() === label);

const storedViews = () =>
  JSON.parse(localStorage.getItem("tracepilot-analytics-dashboard-views") ?? "{}");

const tooltips = () =>
  [...document.body.querySelectorAll('[role="tooltip"]')].map((t) => t.textContent ?? "");

describe("ToolAnalysisView", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    resetAnalyticsDashboardViews();
  });

  async function mountTools(data: unknown = FIXTURE_TOOL_ANALYSIS) {
    mockGetToolAnalysis.mockResolvedValue(data);
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);
    await flushPromises();
    return wrapper;
  }

  it("leads with calls, failures, tool time split by kind, and tools used", async () => {
    const wrapper = await mountTools();
    const kpis = wrapper.get('[data-testid="tool-kpis"]').text();
    expect(kpis).toContain("Tool calls");
    expect(kpis).toContain("50");
    expect(kpis).toContain("25 a day on 2 of");
    // 3 failed calls of 50.
    expect(kpis).toContain("6%");
    expect(kpis).toContain("3 calls");
    // Subagents and ask_user hold most of the time, so they read apart.
    expect(kpis).toMatch(/5% tools · 81% subagents · 14% waiting on you/);
    expect(kpis).toContain("Tools used");
    expect(wrapper.findAll(".stat-card")).toHaveLength(0);
  }, 10_000);

  it("charts calls per day and remembers another metric and style", async () => {
    const wrapper = await mountTools();
    const panel = wrapper.get('[data-testid="tool-calls-per-day"]');
    expect(
      panel.find('[aria-label="Tool calls per day, failed calls stacked on top"]').exists(),
    ).toBe(true);
    expect(panel.text()).toContain("Busiest");

    await radio(panel, "Tool time")?.trigger("click");
    await radio(panel, "Lines")?.trigger("click");
    await flushPromises();
    expect(panel.find('[aria-label="Tool time per day"]').exists()).toBe(true);
    expect(storedViews()).toMatchObject({ toolsMetric: "time", toolsStyle: "lines" });
  });

  it("ranks tools by calls, re-sorts by failure rate, and labels subagents and waits", async () => {
    const wrapper = await mountTools();
    const panel = wrapper.get('[data-testid="tool-rank"]');
    const names = () =>
      panel
        .findAll('[data-testid="tool-rank-row"]')
        .map((row) => row.get(".tool-rank__name").text());
    expect(names()[0]).toMatch(/^edit/);
    expect(panel.text()).toContain("subagent");
    expect(panel.text()).toContain("waits on you");

    await radio(panel, "Failure rate")?.trigger("click");
    await flushPromises();
    // Read: 2 of 16 failed (12.5%) outranks edit: 1 of 30.
    expect(names()[0]).toMatch(/^Read/);
    expect(storedViews()).toMatchObject({ toolsSort: "failures" });
  });

  it("explains each tool row on hover and expands native tools", async () => {
    const wrapper = await mountTools();
    const panel = wrapper.get('[data-testid="tool-rank"]');
    expect(tooltips().some((t) => t.startsWith("Read (view): 16 calls · 2 failed (13%)"))).toBe(
      true,
    );

    await panel.get('[aria-label="Show native tools for Read"]').trigger("click");
    expect(panel.findAll(".tool-rank__native")).toHaveLength(1);

    // A click anywhere on the row toggles it too.
    const read = panel
      .findAll('[data-testid="tool-rank-row"]')
      .find((row) => row.text().startsWith("Read"));
    await read?.get(".ad-track").trigger("click");
    expect(panel.findAll(".tool-rank__native")).toHaveLength(0);
  });

  it("lists every tool in a scrolling body", async () => {
    const wrapper = await mountTools();
    const panel = wrapper.get('[data-testid="tool-rank"]');
    expect(panel.findAll('.tool-rank__body [data-testid="tool-rank-row"]')).toHaveLength(
      FIXTURE_TOOL_ANALYSIS.tools.length,
    );
    expect(panel.text()).not.toContain("Show all");
  });

  it("shows when tools run with weekday and hour totals", async () => {
    const wrapper = await mountTools();
    const heat = wrapper.get('[data-testid="tool-heatmap"]');
    expect(heat.text()).toContain("When tools run");
    expect(heat.text()).toContain("Mon");
    expect(heat.text()).toContain("Sun");
    expect(heat.findAll(".tool-heat .tool-heat__cell")).toHaveLength(168);
    const counts = heat.findAll(".tool-heat .tool-heat__cell").map((cell) => cell.text());
    expect(counts.filter(Boolean).length).toBeGreaterThan(0);
    expect(counts).not.toContain("0");
    expect(heat.text()).toContain("Busiest");
  });

  it("empties each panel on its own for a range without calls", async () => {
    const wrapper = await mountTools({
      ...FIXTURE_TOOL_ANALYSIS,
      totalCalls: 0,
      tools: [],
      activityHeatmap: [],
      callsByDay: [],
    });
    const kpis = wrapper.get('[data-testid="tool-kpis"]').text();
    expect(kpis).toContain("No tool calls");
    expect(kpis).toContain("No timed calls");
    expect(kpis).not.toContain("0ms");
    expect(wrapper.get('[data-testid="tool-calls-per-day"]').text()).toContain("No tool calls");
    expect(wrapper.get('[data-testid="tool-rank"]').text()).toContain("No tools used");
    expect(wrapper.get('[data-testid="tool-heatmap"]').text()).toContain("No tool calls");
  });

  it("shows error state on failure", async () => {
    mockGetToolAnalysis.mockRejectedValue(new Error("Parse error"));
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("Failed to load tool analysis");
    expect(wrapper.text()).toContain("Parse error");
  });
});

describe("CodeImpactView", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    resetAnalyticsDashboardViews();
  });

  async function mountCode(data: unknown = FIXTURE_CODE_IMPACT) {
    mockGetCodeImpact.mockResolvedValue(data);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);
    await flushPromises();
    return wrapper;
  }

  it("leads with lines added, removed, a coloured net change and files touched", async () => {
    const wrapper = await mountCode();
    const kpis = wrapper.get('[data-testid="code-kpis"]');
    expect(kpis.text()).toContain("+1,000");
    expect(kpis.text()).toContain("−300");
    expect(kpis.text()).toContain("3.3 added per line removed");
    expect(kpis.get(".code-kpis__net").text()).toBe("+700");
    expect(kpis.get(".code-kpis__net").classes()).toContain("code-kpis__net--up");
    expect(kpis.text()).toContain("15 modifications");
    expect(wrapper.findAll(".stat-card")).toHaveLength(0);
  });

  it("colours a shrinking codebase as a loss", async () => {
    const wrapper = await mountCode({ ...FIXTURE_CODE_IMPACT, netChange: -200 });
    const net = wrapper.get(".code-kpis__net");
    expect(net.text()).toBe("−200");
    expect(net.classes()).toContain("code-kpis__net--down");
    expect(wrapper.get('[data-testid="code-kpis"]').text()).toContain("code shrank");
  });

  it("charts lines per day and remembers the style", async () => {
    const wrapper = await mountCode();
    const panel = wrapper.get('[data-testid="code-changes-per-day"]');
    expect(panel.find('[aria-label="Lines added and removed per day"]').exists()).toBe(true);
    expect(panel.text()).toContain("Busiest");
    await radio(panel, "Lines")?.trigger("click");
    await flushPromises();
    expect(storedViews()).toMatchObject({ codeStyle: "lines" });
  });

  it("splits modifications by file type", async () => {
    const wrapper = await mountCode();
    const types = wrapper.get('[data-testid="code-file-types"]').text();
    expect(types).toContain(".ts");
    expect(types).toContain(".vue");
    expect(types).toContain("67%");
    expect(types).toContain("15 modifications");
  });

  it("lists most-modified files name first, by sessions, with the full path on hover", async () => {
    const wrapper = await mountCode();
    const rows = wrapper.findAll('[data-testid="code-file-row"]');
    expect(rows[0].text()).toContain("index.ts");
    expect(rows[0].text()).toContain("…/desktop/src");
    expect(rows[0].text()).toContain("4");
    expect(rows[1].text()).toContain("App.vue");
    expect(tooltips()).toContain("C:\\repo\\apps\\desktop\\src\\index.ts · modified in 4 sessions");
  });

  it("empties each panel on its own for a range without changes", async () => {
    const wrapper = await mountCode({
      filesModified: 0,
      linesAdded: 0,
      linesRemoved: 0,
      netChange: 0,
      fileTypeBreakdown: [],
      mostModifiedFiles: [],
      changesByDay: [],
    });
    const kpis = wrapper.get('[data-testid="code-kpis"]').text();
    expect(kpis).toContain("No line changes reported");
    expect(kpis).not.toMatch(/[+−]0/);
    expect(wrapper.get('[data-testid="code-changes-per-day"]').text()).toContain("No line changes");
    expect(wrapper.get('[data-testid="code-file-types"]').text()).toContain("No files modified");
    expect(wrapper.get('[data-testid="code-files"]').text()).toContain("No files modified");
    expect(wrapper.text()).not.toContain("No file list recorded");
  });

  it("says no file list was recorded when lines changed without one", async () => {
    // A Claude Code cost snapshot, or edits made through a shell, report line
    // totals without the files: the file count is unknown, not zero.
    const wrapper = await mountCode({
      filesModified: 0,
      linesAdded: 4,
      linesRemoved: 1,
      netChange: 3,
      fileTypeBreakdown: [],
      mostModifiedFiles: [],
      changesByDay: [{ date: "2026-10-16", additions: 4, deletions: 1 }],
    });
    const kpis = wrapper.get('[data-testid="code-kpis"]');
    const files = kpis.findAll(".kpi").find((kpi) => kpi.text().includes("Files touched"));
    expect(files?.text()).toContain("—");
    expect(files?.text()).toContain("No file list recorded");
    expect(kpis.text()).not.toContain("No files modified");
    for (const id of ["code-file-types", "code-files"]) {
      const text = wrapper.get(`[data-testid="${id}"]`).text();
      expect(text).toContain("No file list recorded");
      expect(text).toContain("recorded the line counts above but not which files changed");
      expect(text).not.toContain("No files modified");
      expect(text).not.toContain("recorded a file change");
    }
  });

  it("shows error state on failure", async () => {
    mockGetCodeImpact.mockRejectedValue(new Error("disk error"));
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain("Failed to load code impact data");
    expect(wrapper.text()).toContain("disk error");
  });
});
