import type { BackgroundTask } from "@tracepilot/client";
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
  backgroundTasks: [] as BackgroundTask[],
  loaded: new Set<string>(),
  pendingCheckpointFocus: null,
  loadCheckpoints: vi.fn(),
  loadPlan: vi.fn(),
  loadBackgroundTasks: vi.fn(),
  loadShutdownMetrics: vi.fn(),
  loadIncidents: vi.fn(),
  focusCheckpoint: vi.fn(),
});
vi.mock("@/composables/useSessionDetailContext", () => ({ useSessionDetailContext: () => store }));

afterEach(() => {
  store.detail = null;
  store.shutdownMetrics = null;
  store.backgroundTasks = [];
  store.loadBackgroundTasks.mockClear();
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

const failedShell: BackgroundTask = {
  id: "bg_suite",
  kind: "shell",
  status: "failed",
  description: "Run the slow suite",
  summary: 'Background command "Run the slow suite" failed (exit code 1)',
  toolCallId: "toolu_suite",
  startedAt: "2026-03-20T11:50:00.000Z",
  finishedAt: "2026-03-20T11:55:00.000Z",
  durationMs: null,
  totalTokens: null,
  toolCalls: null,
};

it("lists a Claude Code session's background tasks", () => {
  store.detail = { id: "s1", source: "claudeCode", hasPlan: false, hasCheckpoints: false };
  store.backgroundTasks = [
    failedShell,
    {
      ...failedShell,
      id: "agent1",
      kind: "agent",
      status: "completed",
      description: "Map the indexer",
      summary: null,
      durationMs: 120000,
      totalTokens: 48200,
      toolCalls: 1,
    },
  ];
  const { wrapper } = mountOverview();
  expect(store.loadBackgroundTasks).toHaveBeenCalled();
  const rows = wrapper.findAll('[data-testid="background-task"]');
  expect(rows).toHaveLength(2);
  expect(wrapper.text()).toContain("Background Tasks (2)");
  expect(rows[0].text()).toContain("Run the slow suite");
  expect(rows[0].text()).toContain("Failed");
  expect(rows[1].text()).toContain("Completed");
  expect(rows[1].text()).toContain("1 tool call");
  wrapper.unmount();
});

it("hides background tasks when a session has none, and never asks Copilot", () => {
  store.detail = { id: "s1", source: "claudeCode", hasPlan: false, hasCheckpoints: false };
  const claude = mountOverview().wrapper;
  expect(claude.text()).not.toContain("Background Tasks");
  claude.unmount();

  store.loadBackgroundTasks.mockClear();
  store.detail = { id: "s1", hasPlan: false, hasCheckpoints: true };
  store.backgroundTasks = [failedShell];
  const copilot = mountOverview().wrapper;
  expect(store.loadBackgroundTasks).not.toHaveBeenCalled();
  expect(copilot.text()).not.toContain("Background Tasks");
  copilot.unmount();
});
