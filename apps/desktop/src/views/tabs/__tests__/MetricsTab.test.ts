import { setupPinia } from "@tracepilot/test-utils";
import { EmptyState, ErrorAlert } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { reactive } from "vue";
import MetricsTokens from "@/components/metrics/MetricsTokens.vue";
import { NAVIGATE_SESSION_TAB_KEY } from "@/composables/useSessionTabNavigation";
import { resetSessionTabViews, useSessionTabViews } from "@/composables/useSessionTabViews";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import MetricsTab from "../MetricsTab.vue";

const store = reactive({
  sessionId: "retry-session",
  detail: null as { id: string; source?: "claudeCode" } | null,
  shutdownMetrics: {},
  turns: [],
  loaded: new Set(["metrics", "turns"]),
  metricsError: null,
  turnsError: "Failed to refresh agent activity",
  loadShutdownMetrics: vi.fn(),
  loadTurns: vi.fn(),
  promptCache: null,
  promptCacheError: null,
  loadPromptCache: vi.fn(),
});
vi.mock("@/composables/useSessionDetailContext", () => ({ useSessionDetailContext: () => store }));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  resetSessionTabViews();
});

it("retries a failed activity refresh even when turns were previously loaded", async () => {
  setupPinia();
  store.loadTurns.mockImplementation(async () => {
    // Same cache guard as the real section loader: retry must invalidate it.
    if (store.loaded.has("turns")) return;
    store.turnsError = "";
    store.loaded.add("turns");
  });
  const wrapper = mount(MetricsTab, {
    global: {
      stubs: {
        MetricsAgents: true,
        SubagentPanel: true,
        MetricsSessionActivity: true,
        MetricsCodeChanges: true,
      },
    },
  });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Agents")
    ?.trigger("click");
  expect(store.turnsError).not.toBe("");
  wrapper.getComponent(ErrorAlert).vm.$emit("retry");
  expect(store.turnsError).toBe("");
  expect(store.loaded.has("turns")).toBe(true);
  wrapper.unmount();
});

it("distinguishes loading metrics from a completed empty response", async () => {
  setupPinia();
  store.loaded.delete("metrics");
  store.shutdownMetrics = null as unknown as typeof store.shutdownMetrics;
  const wrapper = mount(MetricsTab, { global: { stubs: { SubagentPanel: true } } });
  expect(wrapper.get('[role="status"]').text()).toContain("Loading session metrics");
  expect(wrapper.findComponent(EmptyState).exists()).toBe(false);
  store.loaded.add("metrics");
  await wrapper.vm.$nextTick();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.getComponent(EmptyState).text()).toContain("No shutdown metrics");
  wrapper.unmount();
});

it("presents a Claude Code session in USD without AI Credit columns", async () => {
  setupPinia();
  store.sessionId = "claude-session";
  store.detail = { id: "claude-session", source: "claudeCode" };
  store.loaded.add("metrics");
  store.shutdownMetrics = {
    costAmount: 0.42,
    costUnit: "usd",
    costBasis: "providerEstimate",
    coverage: { partial: true, snapshotLine: 9, recordedCalls: 4, tailCalls: 0 },
    modelMetrics: {
      "claude-opus-4-6": {
        requests: { count: 4 },
        usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 10 },
      },
    },
  } as unknown as typeof store.shutdownMetrics;
  const wrapper = mount(MetricsTab, {
    global: { stubs: { SubagentPanel: true, MetricsSessionActivity: true } },
  });
  expect(wrapper.get('[data-testid="metrics-kpis"]').text()).toContain("$0.42");
  expect(wrapper.text()).toContain("Claude Code estimate");
  expect(wrapper.text()).toContain("USD at API rates");
  expect(wrapper.text()).not.toMatch(/AI Credits|Legacy/);
  store.shutdownMetrics = null as unknown as typeof store.shutdownMetrics;
  await wrapper.vm.$nextTick();
  expect(wrapper.getComponent(EmptyState).text()).toContain("No model usage has been recorded");
  wrapper.unmount();
  store.detail = null;
  store.sessionId = "retry-session";
});

it("reopens on a remembered By agent view and loads the turns it needs", () => {
  setupPinia();
  store.sessionId = "retry-session";
  store.loaded = new Set(["metrics"]);
  store.shutdownMetrics = {};
  store.turnsError = null as unknown as string;
  store.loadTurns.mockReset();
  useSessionTabViews().value.metrics = "agent";
  const wrapper = mount(MetricsTab, {
    global: { stubs: { SubagentPanel: true, MetricsSessionActivity: true } },
  });
  const agents = wrapper.findAll("button").find((button) => button.text() === "Agents");
  expect(agents?.attributes("aria-checked")).toBe("true");
  expect(store.loadTurns).toHaveBeenCalledTimes(1);
  expect(wrapper.text()).toContain("Loading agent activity");
  wrapper.unmount();
});

it("opens the Context tab in place in tab mode and by route in route mode", () => {
  setupPinia();
  store.sessionId = "context-session";
  store.loaded = new Set(["metrics"]);
  store.shutdownMetrics = {
    modelMetrics: {
      "claude-opus-4-6": {
        requests: { count: 1 },
        usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    },
  } as unknown as typeof store.shutdownMetrics;
  const stubs = { SubagentPanel: true, MetricsSessionActivity: true, MetricsTokens: true };
  const navigate = vi.fn();
  vi.mocked(pushRoute).mockClear();

  // Tab mode: SessionDetailTabView provides the navigator; its panels have no route.
  const tabMode = mount(MetricsTab, {
    global: { stubs, provide: { [NAVIGATE_SESSION_TAB_KEY as symbol]: navigate } },
  });
  tabMode.getComponent(MetricsTokens).vm.$emit("openContext");
  expect(navigate).toHaveBeenCalledWith("context");
  expect(pushRoute).not.toHaveBeenCalled();
  tabMode.unmount();

  // Route mode provides no navigator, so the link pushes the Context route.
  const routeMode = mount(MetricsTab, { global: { stubs } });
  routeMode.getComponent(MetricsTokens).vm.$emit("openContext");
  expect(pushRoute).toHaveBeenCalledWith(undefined, ROUTE_NAMES.sessionContext, {
    params: { id: "context-session" },
  });
  routeMode.unmount();
  store.sessionId = "retry-session";
});
