import type { FileCheckpoint } from "@tracepilot/client";
import { setupPinia } from "@tracepilot/test-utils";
import type { SessionDetail, SessionIncident, ShutdownMetrics } from "@tracepilot/types";
import { KPI } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { reactive } from "vue";
import OverviewTab from "../OverviewTab.vue";

const store = reactive({
  sessionId: "s1",
  detail: null as SessionDetail | null,
  shutdownMetrics: null as ShutdownMetrics | null,
  incidents: [] as SessionIncident[],
  checkpoints: [],
  plan: null,
  fileHistory: [] as FileCheckpoint[],
  turnActivity: [] as (number | null)[],
  turnActivityError: null as string | null,
  loaded: new Set<string>(),
  pendingCheckpointFocus: null,
  loadCheckpoints: vi.fn(),
  loadPlan: vi.fn(),
  loadFileHistory: vi.fn(),
  loadShutdownMetrics: vi.fn(),
  loadIncidents: vi.fn(),
  loadTurnActivity: vi.fn(),
  focusCheckpoint: vi.fn(),
});
vi.mock("@/composables/useSessionDetailContext", () => ({ useSessionDetailContext: () => store }));

afterEach(() => {
  store.detail = null;
  store.shutdownMetrics = null;
  store.incidents = [];
  store.fileHistory = [];
  store.turnActivity = [];
  store.loaded = new Set();
  store.loadFileHistory.mockClear();
});

function mountOverview() {
  setupPinia();
  const wrapper = mount(OverviewTab, { global: { stubs: { CheckpointTimeline: true } } });
  const kpis = wrapper.findAllComponents(KPI);
  return { wrapper, kpi: (label: string) => kpis.find((k) => k.props("label") === label) };
}

it("shows a Claude Code session's labelled USD estimate and recorded calls", () => {
  store.detail = {
    id: "s1",
    source: "claudeCode",
    hasPlan: false,
    hasCheckpoints: false,
    turnCount: 2,
  };
  store.shutdownMetrics = {
    costAmount: 0.42,
    costUnit: "usd",
    costBasis: "providerEstimate",
    coverage: { partial: true, snapshotLine: 9, recordedCalls: 4, tailCalls: 2 },
  };
  const { wrapper, kpi } = mountOverview();
  const cost = kpi("Est. cost");
  expect(cost?.props("value")).toBe("$0.42");
  expect(cost?.text()).toContain("Claude Code estimate");
  expect(cost?.text()).toContain("partial");
  expect(kpi("Model calls")?.props("value")).toBe("4");
  expect(kpi("Model calls")?.text()).toContain("2.0 per turn");
  expect(kpi("Checkpoints")).toBeUndefined();
  expect(kpi("AI credits")).toBeUndefined();
  expect(wrapper.get('[data-testid="outcome-exit"]').text()).toContain("Not running");
  expect(wrapper.find(".host-chip").exists()).toBe(false);
  wrapper.unmount();
});

it("keeps Copilot's checkpoints, credits, exit record and host", () => {
  store.detail = {
    id: "s1",
    source: "copilot",
    hasPlan: false,
    hasCheckpoints: true,
    checkpointCount: 2,
    hostType: "github",
  };
  store.shutdownMetrics = { shutdownType: "routine" };
  const { wrapper, kpi } = mountOverview();
  expect(kpi("Checkpoints")?.props("value")).toBe("2");
  expect(kpi("AI credits")).toBeDefined();
  expect(kpi("Est. cost")).toBeUndefined();
  expect(wrapper.get('[data-testid="outcome-exit"]').text()).toContain("Ended normally");
  expect(wrapper.get(".host-chip").text()).toBe("github");
  wrapper.unmount();

  store.shutdownMetrics = null;
  const bare = mountOverview().wrapper;
  expect(bare.get('[data-testid="outcome-exit"]').text()).toContain("No exit record");
  bare.unmount();
});

it("shows lines changed in place of checkpoints when the session recorded them", () => {
  store.detail = { id: "s1", source: "copilot", hasPlan: false, hasCheckpoints: true };
  store.shutdownMetrics = {
    codeChanges: {
      linesAdded: 712,
      linesRemoved: 200,
      filesModified: ["/r/a.ts", "/r/docs/b.md"],
    },
  };
  const { wrapper, kpi } = mountOverview();
  const changes = kpi("Code changes");
  expect(changes?.text()).toContain("+712");
  expect(changes?.text()).toContain("−200");
  expect(changes?.text()).toContain("2 files changed");
  expect(kpi("Checkpoints")).toBeUndefined();
  wrapper.unmount();
});

it("counts files when a session lists changed files without line counts", () => {
  store.detail = { id: "s1", source: "claudeCode", hasPlan: false, hasCheckpoints: false };
  store.shutdownMetrics = { codeChanges: { filesModified: ["/r/a.ts", "/r/b.ts"] } };
  let { wrapper, kpi } = mountOverview();
  expect(kpi("Code changes")?.props("value")).toBe("2");
  expect(kpi("Code changes")?.text()).toContain("No line counts recorded");
  expect(wrapper.get('[data-testid="outcome-changes"]').text()).toContain("2 files");
  wrapper.unmount();

  store.shutdownMetrics = { codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: [] } };
  ({ wrapper, kpi } = mountOverview());
  expect(kpi("Code changes")).toBeUndefined();
  expect(wrapper.get('[data-testid="outcome-changes"]').text()).toContain("None recorded");
  wrapper.unmount();
});

it("puts the session's span on the duration tile and names model time as such", () => {
  store.detail = {
    id: "s1",
    source: "copilot",
    hasPlan: false,
    hasCheckpoints: true,
    createdAt: "2026-07-17T09:05:30Z",
    updatedAt: "2026-07-17T09:36:47Z",
  };
  store.shutdownMetrics = { totalApiDurationMs: 0 };
  let { wrapper, kpi } = mountOverview();
  expect(kpi("Duration")?.props("value")).toBe("31m 17s");
  expect(kpi("Duration")?.text()).toContain("No model timing recorded");
  wrapper.unmount();

  store.shutdownMetrics = { totalApiDurationMs: 8_400 };
  ({ wrapper, kpi } = mountOverview());
  expect(kpi("Duration")?.text()).toContain("8.4s waiting on the model");
  expect(wrapper.get('[data-testid="outcome-time"]').text()).toContain("Everything else");
  wrapper.unmount();
});

it("counts incidents by kind, with rate limits split out of errors", () => {
  store.detail = { id: "s1", source: "copilot", hasPlan: false, hasCheckpoints: true };
  store.incidents = [
    {
      eventType: "error",
      sourceEventType: "session.error",
      severity: "error",
      summary: "Rate limit hit",
      detailJson: { errorType: "rate_limit" },
    },
    {
      eventType: "compaction",
      sourceEventType: "session.compaction_complete",
      severity: "info",
      summary: "c",
    },
  ];
  const { wrapper } = mountOverview();
  const tile = wrapper.get('[data-testid="outcome-incidents"]').text();
  expect(tile).toContain("2 incidents");
  expect(tile).toContain("1 rate limit · 1 compaction");
  wrapper.unmount();
});

it("loads turn activity and draws a bar per time bin", () => {
  store.detail = {
    id: "s1",
    source: "copilot",
    hasPlan: false,
    hasCheckpoints: true,
    createdAt: "2026-07-17T09:00:00Z",
    updatedAt: "2026-07-17T09:30:00Z",
  };
  const start = Date.parse("2026-07-17T09:00:00Z");
  store.turnActivity = [start, start + 60_000, null, start + 20 * 60_000];
  store.loaded = new Set(["activity"]);
  const { wrapper } = mountOverview();
  expect(store.loadTurnActivity).toHaveBeenCalled();
  const chart = wrapper.get('[data-testid="session-activity"]');
  expect(chart.findAll(".activity__bar")).toHaveLength(16);
  expect(chart.get('[role="img"]').attributes("aria-label")).toContain("3 turns");
  wrapper.unmount();

  store.turnActivity = [null, null];
  const untimed = mountOverview().wrapper;
  expect(untimed.text()).toContain("These turns have no timestamps.");
  untimed.unmount();
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
    expect(wrapper.find('[data-testid="session-cwd"]').exists()).toBe(false);
    wrapper.unmount();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("names a Claude Code model as cards do, with the recorded id as the tooltip", () => {
  for (const [source, shown] of [
    ["claudeCode", "claude-opus-5.5"],
    ["copilot", "claude-opus-5-5"],
  ] as const) {
    store.detail = {
      id: "s1",
      source,
      currentModel: "claude-opus-5-5",
      hasPlan: false,
      hasCheckpoints: false,
    };
    const { wrapper } = mountOverview();
    const info = wrapper.get('[data-testid="session-model"]');
    expect(info.text()).toBe(shown);
    expect(info.attributes("title")).toBe("claude-opus-5-5");
    wrapper.unmount();
  }
});

it("shows the recorded effort, and says Claude Code's is not recorded rather than a default", () => {
  for (const [source, effort, shown] of [
    ["claudeCode", "high", "High"],
    ["copilot", "xhigh", "Extra high"],
    ["claudeCode", null, "Not recorded"],
    ["copilot", null, "Model default"],
  ] as const) {
    store.detail = {
      id: "s1",
      source,
      currentModel: "claude-opus-5-5",
      currentReasoningEffort: effort,
      hasPlan: false,
      hasCheckpoints: false,
    };
    const { wrapper } = mountOverview();
    const shownEffort = wrapper.get('[data-testid="session-effort"]');
    expect(shownEffort.text()).toBe(shown);
    expect(shownEffort.find(".effort__bars").exists()).toBe(shown !== "Not recorded");
    wrapper.unmount();
  }
});
