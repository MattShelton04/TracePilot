import type { FileCheckpoint } from "@tracepilot/client";
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
  fileHistory: [] as FileCheckpoint[],
  loaded: new Set<string>(),
  pendingCheckpointFocus: null,
  loadCheckpoints: vi.fn(),
  loadPlan: vi.fn(),
  loadFileHistory: vi.fn(),
  loadShutdownMetrics: vi.fn(),
  loadIncidents: vi.fn(),
  focusCheckpoint: vi.fn(),
});
vi.mock("@/composables/useSessionDetailContext", () => ({ useSessionDetailContext: () => store }));

afterEach(() => {
  store.detail = null;
  store.shutdownMetrics = null;
  store.fileHistory = [];
  store.loadFileHistory.mockClear();
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
  store.detail = {
    id: "s1",
    source: "copilot",
    hasPlan: false,
    hasCheckpoints: true,
    checkpointCount: 2,
  };
  store.shutdownMetrics = { shutdownType: "routine" };
  const { wrapper, card } = mountOverview();
  expect(card("Checkpoints")?.props("value")).toBe(2);
  expect(card("AI Credits")).toBeDefined();
  expect(card("Est. Cost (USD)")).toBeUndefined();
  expect(wrapper.text()).toContain("Shutdown Type");
  expect(wrapper.text()).toContain("Host");
  wrapper.unmount();
});

it("names API time as such and shows a dash when none was recorded", () => {
  const apiTimes = (wrapper: ReturnType<typeof mountOverview>["wrapper"]) =>
    wrapper
      .findAll("dt")
      .filter((dt) => dt.text() === "API Time")
      .map((dt) => dt.element.nextElementSibling?.textContent?.trim());

  store.detail = { id: "s1", source: "copilot", hasPlan: false, hasCheckpoints: true };
  store.shutdownMetrics = { totalApiDurationMs: 0 };
  let { wrapper } = mountOverview();
  expect(apiTimes(wrapper)).toEqual(["—", "—"]);
  expect(wrapper.findAll("dt").map((dt) => dt.text())).not.toContain("Duration");
  wrapper.unmount();

  store.shutdownMetrics = { totalApiDurationMs: 8_400 };
  ({ wrapper } = mountOverview());
  expect(apiTimes(wrapper)).toEqual(["8.4s", "8.4s"]);
  wrapper.unmount();
});

it("shows a Claude Code session's file-history checkpoints, and never asks Copilot", () => {
  store.detail = { id: "s1", source: "claudeCode", hasPlan: false, hasCheckpoints: false };
  store.fileHistory = [
    { number: 1, messageId: "m1", timestamp: null, prompt: "Add a retry.", files: [] },
  ];
  const claude = mountOverview().wrapper;
  expect(store.loadFileHistory).toHaveBeenCalled();
  expect(claude.text()).toContain("Checkpoints (1)");
  claude.unmount();

  store.loadFileHistory.mockClear();
  store.detail = { id: "s1", source: "copilot", hasPlan: false, hasCheckpoints: true };
  const copilot = mountOverview().wrapper;
  expect(store.loadFileHistory).not.toHaveBeenCalled();
  expect(copilot.text()).not.toContain("never restores");
  copilot.unmount();
});

it("lists no background tasks: they settle inline in the conversation", () => {
  store.detail = { id: "s1", source: "claudeCode", hasPlan: false, hasCheckpoints: false };
  const claude = mountOverview().wrapper;
  expect(claude.text()).not.toContain("Background Tasks");
  claude.unmount();
});

it("shows the working directory with a copy button for either source, only when recorded", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard: { writeText } });
  try {
    const path = "/work/synthetic/orchard";
    for (const source of ["claudeCode", "copilot"] as const) {
      store.detail = { id: "s1", source, cwd: path, hasPlan: false, hasCheckpoints: false };
      const { wrapper } = mountOverview();
      const value = wrapper.find('[data-testid="session-cwd"]');
      expect(value.attributes("title")).toBe(path);
      expect(value.text()).toContain("/work/synthetic/");
      expect(value.text()).toContain("orchard");
      await wrapper.find('[data-testid="session-cwd-copy"]').trigger("click");
      expect(writeText).toHaveBeenLastCalledWith(path);
      wrapper.unmount();
    }

    store.detail = { id: "s1", source: "claudeCode", hasPlan: false, hasCheckpoints: false };
    const { wrapper } = mountOverview();
    expect(wrapper.findAll("dt").map((dt) => dt.text())).not.toContain("Working directory");
    wrapper.unmount();
  } finally {
    vi.unstubAllGlobals();
  }
});
