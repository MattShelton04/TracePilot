import { setupPinia } from "@tracepilot/test-utils";
import type { SessionDetail, ShutdownMetrics } from "@tracepilot/types";
import { StatCard } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { reactive } from "vue";
import OverviewTab from "../OverviewTab.vue";

const store = reactive({
  sessionId: "s1",
  detail: null as SessionDetail | null,
  shutdownMetrics: null as ShutdownMetrics | null,
  incidents: [],
  checkpoints: [],
  plan: null,
  loaded: new Set<string>(),
  pendingCheckpointFocus: null,
  loadCheckpoints: vi.fn(),
  loadPlan: vi.fn(),
  loadShutdownMetrics: vi.fn(),
  loadIncidents: vi.fn(),
  focusCheckpoint: vi.fn(),
});
vi.mock("@/composables/useSessionDetailContext", () => ({ useSessionDetailContext: () => store }));

afterEach(() => {
  store.detail = null;
  store.shutdownMetrics = null;
});

function mountOverview() {
  setupPinia();
  const wrapper = mount(OverviewTab, { global: { stubs: { CheckpointTimeline: true } } });
  const cards = wrapper.findAllComponents(StatCard);
  return { wrapper, card: (label: string) => cards.find((c) => c.props("label") === label) };
}

it("shows a Claude Code session's labelled USD estimate and recorded requests", () => {
  store.detail = { id: "s1", source: "claudeCode", hasPlan: false, hasCheckpoints: false };
  store.shutdownMetrics = {
    costAmount: 0.42,
    costUnit: "usd",
    costBasis: "providerEstimate",
    coverage: { partial: true, snapshotLine: 9, recordedCalls: 4, tailCalls: 0 },
  };
  const { wrapper, card } = mountOverview();
  expect(card("Est. Cost (USD)")?.props()).toMatchObject({
    value: "$0.42",
    trend: "Claude Code estimate",
  });
  expect(card("Recorded Requests")?.props("value")).toBe(4);
  expect(card("Checkpoints")).toBeUndefined();
  expect(card("AI Credits")).toBeUndefined();
  expect(wrapper.text()).not.toMatch(/Shutdown Type|Host/);
  wrapper.unmount();
});

it("keeps the Copilot cards and rows", () => {
  store.detail = { id: "s1", hasPlan: false, hasCheckpoints: true, checkpointCount: 2 };
  store.shutdownMetrics = { shutdownType: "routine" };
  const { wrapper, card } = mountOverview();
  expect(card("Checkpoints")?.props("value")).toBe(2);
  expect(card("AI Credits")).toBeDefined();
  expect(card("Est. Cost (USD)")).toBeUndefined();
  expect(wrapper.text()).toContain("Shutdown Type");
  expect(wrapper.text()).toContain("Host");
  wrapper.unmount();
});
