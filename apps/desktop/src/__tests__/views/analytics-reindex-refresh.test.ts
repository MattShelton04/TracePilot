// biome-ignore-all assist/source/organizeImports: mocks must be registered before the view imports.
import { createDeferred, setupPinia } from "@tracepilot/test-utils";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const mocks = vi.hoisted(() => ({
  getAnalytics: vi.fn(),
  getToolAnalysis: vi.fn(),
  getCodeImpact: vi.fn(),
  agentsUsageSummary: vi.fn(),
  skillsUsageSummary: vi.fn(),
}));
const listeners = vi.hoisted(() => new Map<string, () => void>());

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    checkConfigExists: vi.fn().mockResolvedValue(false),
    getConfig: vi.fn().mockResolvedValue(null),
    skillsListAll: vi.fn().mockResolvedValue({ skills: [], diagnostics: [] }),
    getAnalytics: (...args: unknown[]) => mocks.getAnalytics(...args),
    getToolAnalysis: (...args: unknown[]) => mocks.getToolAnalysis(...args),
    getCodeImpact: (...args: unknown[]) => mocks.getCodeImpact(...args),
    agentsUsageSummary: (...args: unknown[]) => mocks.agentsUsageSummary(...args),
    skillsUsageSummary: (...args: unknown[]) => mocks.skillsUsageSummary(...args),
  });
});
vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn(async (event: string, handler: () => void) => {
    listeners.set(event, handler);
    return () => listeners.delete(event);
  }),
}));

import { IPC_EVENTS } from "@tracepilot/client";
import { agentUsage } from "@tracepilot/client/mock";
import AnalyticsDashboardView from "../../views/AnalyticsDashboardView.vue";
import CodeImpactView from "../../views/CodeImpactView.vue";
import ToolAnalysisView from "../../views/ToolAnalysisView.vue";
import { FIXTURE_ANALYTICS, FIXTURE_CODE_IMPACT, FIXTURE_TOOL_ANALYSIS } from "./analyticsFixtures";

enableAutoUnmount(afterEach);
const mountOptions = { global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } } };

const AGENTS = {
  totalRuns: 4,
  totalSessions: 2,
  failedRuns: 0,
  cancelledRuns: 0,
  incompleteRuns: 0,
  maxDepth: 1,
  peakParallelism: 1,
  runsWithCredits: 0,
  totalOwnNanoAiu: 0,
  mainAgentSelections: [],
  agents: [agentUsage("explore", { runs: 4 })],
};
const SKILLS = {
  totalUses: 0,
  totalSessions: 0,
  unknownTriggerUses: 0,
  fallbackUses: 0,
  totalContentTokens: 0,
  usesWithContent: 0,
  skills: [],
};

const pages = [
  {
    name: "AnalyticsDashboardView",
    view: AnalyticsDashboardView,
    fetch: mocks.getAnalytics,
    data: FIXTURE_ANALYTICS,
  },
  {
    name: "ToolAnalysisView",
    view: ToolAnalysisView,
    fetch: mocks.getToolAnalysis,
    data: FIXTURE_TOOL_ANALYSIS,
  },
  {
    name: "CodeImpactView",
    view: CodeImpactView,
    fetch: mocks.getCodeImpact,
    data: FIXTURE_CODE_IMPACT,
  },
];

describe("analytics pages when a reindex finishes", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    listeners.clear();
    mocks.agentsUsageSummary.mockResolvedValue(AGENTS);
    mocks.skillsUsageSummary.mockResolvedValue(SKILLS);
  });

  it.each(pages)("$name keeps its layout while it refreshes", async ({ view, fetch, data }) => {
    fetch.mockResolvedValueOnce(data);
    const wrapper = mount(view, mountOptions);
    await flushPromises();
    const loaded = wrapper.text();
    expect(wrapper.find(".loading-overlay").exists()).toBe(false);

    const refreshed = createDeferred<typeof data>();
    fetch.mockReturnValueOnce(refreshed.promise);
    listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();
    await nextTick();
    await nextTick();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".loading-overlay").exists()).toBe(false);
    expect(wrapper.text()).toBe(loaded);

    refreshed.resolve(data);
    await flushPromises();
    expect(wrapper.find(".loading-overlay").exists()).toBe(false);
  });

  it("refreshes the dashboard's agent and skill panels in place", async () => {
    mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const wrapper = mount(AnalyticsDashboardView, mountOptions);
    await flushPromises();
    expect(mocks.agentsUsageSummary).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("explore");

    const refreshed = createDeferred<typeof AGENTS>();
    mocks.agentsUsageSummary.mockReturnValueOnce(refreshed.promise);
    listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();
    await nextTick();

    expect(mocks.agentsUsageSummary).toHaveBeenCalledTimes(2);
    expect(mocks.skillsUsageSummary).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain("Loading agent runs");
    expect(wrapper.text()).toContain("explore");

    refreshed.resolve({ ...AGENTS, agents: [agentUsage("reviewer", { runs: 4 })] });
    await flushPromises();
    expect(wrapper.text()).toContain("reviewer");
  });
});
