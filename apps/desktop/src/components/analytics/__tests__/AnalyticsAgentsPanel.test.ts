import { agentsUsageSummary } from "@tracepilot/client";
import { agentUsage as usage } from "@tracepilot/client/mock";
import { setupPinia } from "@tracepilot/test-utils";
import type { AgentUsageSummary } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useAnalyticsStore } from "@/stores/analytics";
import AnalyticsAgentsPanel from "../AnalyticsAgentsPanel.vue";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("@/__tests__/mocks/client");
  return createClientMock({
    checkConfigExists: vi.fn().mockResolvedValue(false),
    getConfig: vi.fn().mockResolvedValue(null),
    agentsUsageSummary: vi.fn(),
  });
});
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));
enableAutoUnmount(afterEach);

const summary: AgentUsageSummary = {
  totalRuns: 100,
  totalSessions: 20,
  failedRuns: 8,
  cancelledRuns: 2,
  incompleteRuns: 3,
  maxDepth: 2,
  peakParallelism: 4,
  runsWithCredits: 0,
  totalOwnNanoAiu: 0,
  mainAgentSelections: [],
  agents: [usage("reviewer", { runs: 20 }), usage("explore", { runs: 80 })],
};

const getStore = () => useAnalyticsStore();

beforeEach(() => {
  vi.clearAllMocks();
  setupPinia();
  getStore().setTimeRange("custom", "2026-09-01");
  vi.mocked(agentsUsageSummary).mockResolvedValue(summary);
});

describe("AnalyticsAgentsPanel", () => {
  it("shows range tiles, credit coverage, outcomes and agents ranked by runs", async () => {
    const wrapper = mount(AnalyticsAgentsPanel);
    await flushPromises();
    expect(agentsUsageSummary).toHaveBeenCalledWith(
      expect.objectContaining({ fromDate: "2026-09-01", repo: undefined, source: undefined }),
    );
    // Runs, failed share, deepest nesting and own credits, as in Skills' header.
    expect(wrapper.findAll(".agents-panel__value").map((el) => el.text())).toEqual([
      "100",
      "10%",
      "2",
      "—",
    ]);
    expect(wrapper.text()).toContain("20 sessions");
    expect(wrapper.text()).toContain("no metrics ledger");
    expect(wrapper.findAll(".agents-panel__name").map((el) => el.text())).toEqual([
      "explore",
      "reviewer",
    ]);
    expect(wrapper.text()).toContain("Incomplete");
    await wrapper.get(".agents-panel__row").trigger("click");
    expect(pushRoute).toHaveBeenCalledWith(expect.anything(), ROUTE_NAMES.agentsManager, {
      query: { q: "explore" },
    });
  });

  it("counts runs that never reported in ended sessions as No final report", async () => {
    vi.mocked(agentsUsageSummary).mockResolvedValue({ ...summary, unreportedRuns: 4 });
    const wrapper = mount(AnalyticsAgentsPanel);
    await flushPromises();
    const legend = wrapper.findAll(".ad-usage__item").map((el) => el.text());
    expect(legend).toEqual([
      expect.stringContaining("Completed83"),
      expect.stringContaining("Failed or cancelled10"),
      expect.stringContaining("Incomplete3"),
      expect.stringContaining("No final report4"),
    ]);
  });

  it("omits No final report when no run is unreported", async () => {
    const wrapper = mount(AnalyticsAgentsPanel);
    await flushPromises();
    expect(wrapper.text()).not.toContain("No final report");
    expect(wrapper.findAll(".ad-usage__item")[0].text()).toContain("Completed87");
  });

  it("displays the ledger denominator when credits are available", async () => {
    vi.mocked(agentsUsageSummary).mockResolvedValue({
      ...summary,
      runsWithCredits: 25,
      totalOwnNanoAiu: 1_000_000_000,
    });
    const wrapper = mount(AnalyticsAgentsPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("25 of 100 runs");
    expect(wrapper.findAll(".agents-panel__value")[3].text()).not.toBe("—");
  });

  it.each([
    "success",
    "error",
  ])("ignores a stale %s after repository selection changes", async (outcome) => {
    let resolve!: (value: AgentUsageSummary) => void;
    let reject!: (error: Error) => void;
    vi.mocked(agentsUsageSummary).mockReturnValueOnce(
      new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      }),
    );
    const wrapper = mount(AnalyticsAgentsPanel);
    getStore().selectedRepo = "tracepilot/app";
    await flushPromises();
    if (outcome === "success") resolve({ ...summary, totalRuns: 999 });
    else reject(new Error("stale failure"));
    await flushPromises();
    expect(wrapper.findAll(".agents-panel__value")[0].text()).toBe("100");
    expect(wrapper.find("[role=alert]").exists()).toBe(false);
  });

  it("refetches for the selected source", async () => {
    mount(AnalyticsAgentsPanel);
    await flushPromises();
    getStore().selectedSource = "claudeCode";
    await flushPromises();
    expect(agentsUsageSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ fromDate: "2026-09-01", source: "claudeCode" }),
    );
  });

  it("serves a filter it has already loaded from the cache", async () => {
    mount(AnalyticsAgentsPanel);
    await flushPromises();
    getStore().selectedSource = "claudeCode";
    await flushPromises();
    getStore().selectedSource = null;
    await flushPromises();
    expect(agentsUsageSummary).toHaveBeenCalledTimes(2);
  });

  it("keeps the current figures on screen while another filter loads", async () => {
    const wrapper = mount(AnalyticsAgentsPanel);
    await flushPromises();
    let resolve!: (value: AgentUsageSummary) => void;
    vi.mocked(agentsUsageSummary).mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    getStore().selectedRepo = "tracepilot/app";
    await flushPromises();
    expect(getStore().agentsSummaryRefreshing).toBe(true);
    expect(wrapper.findAll(".agents-panel__value")[0].text()).toBe("100");
    resolve({ ...summary, totalRuns: 7 });
    await flushPromises();
    expect(wrapper.findAll(".agents-panel__value")[0].text()).toBe("7");
  });

  it("shows empty and error states", async () => {
    vi.mocked(agentsUsageSummary).mockResolvedValueOnce({ ...summary, totalRuns: 0, agents: [] });
    const wrapper = mount(AnalyticsAgentsPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("No agent runs");
    vi.mocked(agentsUsageSummary).mockRejectedValueOnce(new Error("Index unavailable"));
    getStore().selectedRepo = "another/repo";
    await flushPromises();
    expect(wrapper.get("[role=alert]").text()).toBe("Index unavailable");
  });
});
