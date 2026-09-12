import { setupPinia } from "@tracepilot/test-utils";
import { ErrorAlert } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import { reactive } from "vue";
import MetricsTab from "../MetricsTab.vue";

const store = reactive({
  sessionId: "retry-session",
  shutdownMetrics: {},
  turns: [],
  loaded: new Set(["metrics", "turns"]),
  metricsError: null,
  turnsError: "Failed to refresh agent activity",
  loadShutdownMetrics: vi.fn(),
  loadTurns: vi.fn(),
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
