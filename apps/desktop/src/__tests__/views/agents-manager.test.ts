import {
  agentCatalog as catalog,
  agentDefinition as definition,
  agentUsage as usage,
} from "@tracepilot/client/mock";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, reactive, ref } from "vue";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { buildAgentEntries } from "@/utils/agents/entries";
import { buildAgentInsights } from "@/utils/agents/insights";
import AgentsManagerView from "@/views/agents/AgentsManagerView.vue";

const { getStore, getRoute } = vi.hoisted(() => ({ getStore: vi.fn(), getRoute: vi.fn() }));
vi.mock("@/stores/agents", () => ({ useAgentsStore: getStore }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: getRoute }));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  getRoute.mockReturnValue({ query: {} });
});

const SUMMARY = {
  totalRuns: 10,
  totalSessions: 3,
  failedRuns: 1,
  cancelledRuns: 0,
  incompleteRuns: 0,
  maxDepth: 2,
  peakParallelism: 3,
  runsWithCredits: 0,
  totalOwnNanoAiu: 0,
  agents: [usage("reviewer", { runs: 10, failed: 1, completed: 9 })],
  mainAgentSelections: [],
};

function mountView(overrides: Record<string, unknown> = {}) {
  const loaded = catalog([definition("reviewer")]);
  const scope = ref("all");
  const store = reactive({
    catalog: loaded,
    usage: SUMMARY,
    range: "30d",
    catalogLoading: false,
    usageLoading: false,
    error: null as string | null,
    usageError: null as string | null,
    scope,
    flags: new Set<string>(),
    search: "",
    sort: "runs",
    entries: computed(() => buildAgentEntries(loaded, SUMMARY, "30d")),
    filteredEntries: computed(() => buildAgentEntries(loaded, SUMMARY, "30d")),
    insights: computed(() => buildAgentInsights(buildAgentEntries(loaded, SUMMARY, "30d"))),
    scopeCounts: { builtin: 0, personal: 1, project: 0, plugin: 0, unresolved: 0 },
    hasCustomAgents: true,
    loadAll: vi.fn(),
    setRange: vi.fn(),
    toggleFlag: vi.fn(),
    applyInsight: vi.fn(),
    clearFilters: vi.fn(),
    createAgent: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  });
  getStore.mockReturnValue(store);
  return { store, wrapper: mount(AgentsManagerView, { attachTo: document.body }) };
}

describe("AgentsManagerView", () => {
  it("applies and persistently dismisses actionable insights", async () => {
    const insight = {
      id: "unused",
      tone: "info",
      text: "One unused agent",
      filter: { flag: "unused" },
    };
    const { store, wrapper } = mountView({ insights: [insight] });
    await wrapper.get(".agents-insights__action").trigger("click");
    expect(store.applyInsight).toHaveBeenCalledWith(insight);
    await wrapper.get('.agents-insights [aria-label="Dismiss"]').trigger("click");
    expect(wrapper.find(".agents-insights").exists()).toBe(false);
    wrapper.unmount();
    expect(
      mountView({ insights: [insight] })
        .wrapper.find(".agents-insights")
        .exists(),
    ).toBe(false);
  });
  it("applies agent deep links and clears filters on initial and subsequent navigation", async () => {
    const route = reactive({ query: { q: "reviewer" } });
    getRoute.mockReturnValue(route);
    const { store } = mountView({ scope: "builtin", flags: new Set(["unused"]) });
    expect(store.clearFilters).toHaveBeenCalledOnce();
    expect(store.search).toBe("reviewer");
    route.query.q = "explore";
    await flushPromises();
    expect(store.clearFilters).toHaveBeenCalledTimes(2);
    expect(store.search).toBe("explore");
  });

  it("loads definitions and usage on mount and renders a card per agent", async () => {
    const { store, wrapper } = mountView();
    await flushPromises();
    expect(store.loadAll).toHaveBeenCalled();
    expect(wrapper.findAll(".agent-card")).toHaveLength(1);
    expect(wrapper.text()).toContain("reviewer");
  });

  it("summarises the range in the stats strip", async () => {
    const { wrapper } = mountView();
    await flushPromises();
    const strip = wrapper.get(".stats-strip").text();
    expect(strip).toContain("10 runs");
    expect(strip).toContain("10% failed or cancelled");
    // The installed CLI version belongs to a definition's source, not to a
    // page-level chip that repeats on every screen.
    expect(strip).not.toContain("CLI 1.0.79");
  });

  it("opens the detail page for the card that was clicked", async () => {
    const { wrapper } = mountView();
    await flushPromises();
    await wrapper.get(".definition-card__open").trigger("click");
    expect(pushRoute).toHaveBeenCalledWith(expect.anything(), ROUTE_NAMES.agentEditor, {
      query: { id: "/defs/reviewer.agent.md" },
    });
  });

  it("hands flag chips to the store rather than filtering locally", async () => {
    const { store, wrapper } = mountView();
    await flushPromises();
    const chip = wrapper.findAll(".flag-chip").find((b) => b.text() === "Model mismatch");
    await chip!.trigger("click");
    expect(store.toggleFlag).toHaveBeenCalledWith("mismatch");
  });

  it("keeps showing definitions when usage is unavailable", async () => {
    const { wrapper } = mountView({ usage: null, usageError: "index missing" });
    await flushPromises();
    expect(wrapper.text()).toContain("index missing");
    expect(wrapper.findAll(".agent-card")).toHaveLength(1);
  });

  it("makes overrides read-only when settings.json has an unexpected shape", async () => {
    const loaded = catalog([definition("reviewer")], { shapeError: "subagents is a string." });
    const { wrapper } = mountView({ catalog: loaded });
    await flushPromises();
    expect(wrapper.text()).toContain("Overrides are read-only");
  });
});
