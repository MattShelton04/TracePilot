import { setupPinia } from "@tracepilot/test-utils";
import { EmptyState, ErrorAlert } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import { reactive } from "vue";
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
        MetricsAgentBreakdown: true,
        SubagentPanel: true,
        MetricsStatCards: true,
        MetricsSessionActivity: true,
        MetricsTokenBudget: true,
        MetricsCodeChanges: true,
      },
    },
  });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "By agent")
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
  expect(wrapper.text()).toContain("Est. Cost (USD)");
  expect(wrapper.text()).toContain("Claude Code estimate");
  expect(wrapper.text()).not.toMatch(/AI Credits|Legacy/);
  store.shutdownMetrics = null as unknown as typeof store.shutdownMetrics;
  await wrapper.vm.$nextTick();
  expect(wrapper.getComponent(EmptyState).text()).toContain("No model usage has been recorded");
  wrapper.unmount();
  store.detail = null;
  store.sessionId = "retry-session";
});
