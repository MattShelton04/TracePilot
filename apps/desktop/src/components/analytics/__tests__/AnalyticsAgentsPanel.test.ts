import { agentsUsageSummary } from "@tracepilot/client";
import { agentUsage as usage } from "@tracepilot/client/mock";
import type { AgentUsageSummary } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import AnalyticsAgentsPanel from "../AnalyticsAgentsPanel.vue";

const { getStore } = vi.hoisted(() => ({ getStore: vi.fn() }));
vi.mock("@tracepilot/client", () => ({ agentsUsageSummary: vi.fn() }));
vi.mock("@/stores/analytics", () => ({ useAnalyticsStore: getStore }));
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

beforeEach(() => {
  vi.clearAllMocks();
  getStore.mockReturnValue(
    reactive({ dateRange: { fromDate: "2026-09-01", toDate: null }, selectedRepo: null }),
  );
  vi.mocked(agentsUsageSummary).mockResolvedValue(summary);
});

describe("AnalyticsAgentsPanel", () => {
  it("shows range metrics, credit coverage, outcomes and agents ranked by runs", async () => {
    const wrapper = mount(AnalyticsAgentsPanel);
    await flushPromises();
    expect(agentsUsageSummary).toHaveBeenCalledWith({
      fromDate: "2026-09-01",
      toDate: null,
      repo: null,
    });
    expect(wrapper.findAll(".agents-panel__value").map((el) => el.text())).toEqual([
      "100",
      "20",
      "10%",
      "—",
    ]);
    expect(wrapper.text()).toContain("credits are unavailable");
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

  it("displays the ledger denominator when credits are available", async () => {
    vi.mocked(agentsUsageSummary).mockResolvedValue({
      ...summary,
      runsWithCredits: 25,
      totalOwnNanoAiu: 1_000_000_000,
    });
    const wrapper = mount(AnalyticsAgentsPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("credits from 25 of 100 runs");
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
