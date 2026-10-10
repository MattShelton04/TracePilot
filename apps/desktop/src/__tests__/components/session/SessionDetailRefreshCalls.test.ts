import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import SessionDetailPanel from "@/components/session/SessionDetailPanel.vue";
import { RUNNING_SESSION_POLL_MS } from "@/composables/useRunningSessionPoll";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import OverviewTab from "@/views/tabs/OverviewTab.vue";

// Counts the IPC calls behind an open Overview: one fetch per section on
// open, and only what can change on each running-session tick.
const mocks = vi.hoisted(() => ({
  getSessionDetail: vi.fn(),
  getSessionTurns: vi.fn(),
  getSessionCheckpoints: vi.fn(),
  getSessionPlan: vi.fn(),
  getSessionFileHistory: vi.fn(),
  getShutdownMetrics: vi.fn(),
  getSessionIncidents: vi.fn(),
  getSessionTodos: vi.fn(),
  getSessionPromptCache: vi.fn(),
  checkSessionFreshness: vi.fn(),
  getSessionLiveness: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock(mocks);
});

const SESSION_ID = "session-1";
const calls = (name: keyof typeof mocks) => mocks[name].mock.calls.length;

describe("Overview IPC calls", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.getSessionTurns.mockResolvedValue({ turns: [], eventsFileSize: 1, eventsFileMtime: 1 });
    mocks.getSessionCheckpoints.mockResolvedValue([]);
    mocks.getSessionPlan.mockResolvedValue(null);
    mocks.getSessionFileHistory.mockResolvedValue([]);
    mocks.getShutdownMetrics.mockResolvedValue(null);
    mocks.getSessionIncidents.mockResolvedValue([]);
    mocks.getSessionTodos.mockResolvedValue(null);
    mocks.getSessionPromptCache.mockResolvedValue({ timeline: null });
    mocks.checkSessionFreshness.mockResolvedValue({
      eventsFileSize: 1,
      eventsFileMtime: 1,
      sourceVersion: "v1",
    });
  });

  async function openOverview(source: "copilot" | "claudeCode", running: boolean) {
    mocks.getSessionDetail.mockResolvedValue({ id: SESSION_ID, source, eventCount: 4 });
    mocks.getSessionLiveness.mockResolvedValue(
      running ? { state: "running", pid: 7, status: "busy" } : { state: "idle" },
    );
    await usePreferencesStore().whenReady;
    const store = useSessionDetailStore() as unknown as SessionDetailContext;
    const wrapper = mount(SessionDetailPanel, {
      props: {
        store,
        sessionId: SESSION_ID,
        tabMode: "local",
        activeSubTab: "overview",
        refreshEnabled: true,
      },
      slots: { default: () => h(OverviewTab) },
    });
    await flushPromises();
    return wrapper;
  }

  it("fetches each Copilot Overview section once on open", async () => {
    const wrapper = await openOverview("copilot", false);
    expect(calls("getSessionDetail")).toBe(1);
    expect(calls("getSessionPlan")).toBe(1);
    expect(calls("getSessionCheckpoints")).toBe(1);
    expect(calls("getSessionIncidents")).toBe(1);
    expect(calls("getShutdownMetrics")).toBe(1);
    wrapper.unmount();
  });

  it("never asks a running Claude Code session for checkpoints it cannot have", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const wrapper = await openOverview("claudeCode", true);
      expect(calls("getSessionDetail")).toBe(1);
      expect(calls("getSessionPlan")).toBe(1);
      expect(calls("getSessionFileHistory")).toBe(1);
      expect(calls("getSessionCheckpoints")).toBe(0);

      // Let the first tick record the source version, then count steady ticks.
      await vi.advanceTimersByTimeAsync(RUNNING_SESSION_POLL_MS);
      vi.clearAllMocks();
      const ticks = 5;
      await vi.advanceTimersByTimeAsync(RUNNING_SESSION_POLL_MS * ticks);
      expect(calls("checkSessionFreshness")).toBe(ticks);
      expect(calls("getSessionIncidents")).toBe(ticks);
      expect(calls("getSessionCheckpoints")).toBe(0);
      expect(calls("getSessionTodos")).toBe(0);
      // The source is unchanged, so nothing built from it is fetched again.
      expect(calls("getSessionDetail")).toBe(0);
      expect(calls("getSessionPlan")).toBe(0);
      expect(calls("getSessionFileHistory")).toBe(0);
      expect(calls("getShutdownMetrics")).toBe(0);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
