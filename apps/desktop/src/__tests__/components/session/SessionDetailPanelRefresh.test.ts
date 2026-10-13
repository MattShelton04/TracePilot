import { flushPromises } from "@vue/test-utils";
import { createPinia, type Pinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RUNNING_SESSION_POLL_MS } from "@/composables/useRunningSessionPoll";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import { createStore, mountPanel } from "./sessionDetailPanelFixtures";

// The panel's running-state checks, auto-refresh and running-session poll.
const mocks = vi.hoisted(() => ({
  getSessionLiveness: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({ getSessionLiveness: mocks.getSessionLiveness });
});

describe("SessionDetailPanel refreshing", () => {
  // Every mount and store lookup names this test's pinia. Calling any store
  // action makes its pinia the active one, and earlier tests leave actions
  // running on real timers (the sdk store's 500 ms auto-connect calls
  // `prefs.isFeatureEnabled`). One firing during a later test's `await`
  // re-activated the old pinia, so a panel mounted without this pinia read
  // the old test's preferences (auto-refresh off).
  let pinia: Pinia;
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    mocks.getSessionLiveness.mockResolvedValue({ state: "idle" });
  });

  async function autoRefreshCalls(): Promise<SessionDetailContext> {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const prefs = usePreferencesStore(pinia);
      await flushPromises(); // let config hydration finish before overriding it
      prefs.autoRefreshEnabled = true;
      prefs.autoRefreshIntervalSeconds = 5;
      const store = createStore();
      mountPanel(pinia, store, { refreshEnabled: true });
      await flushPromises();
      await vi.advanceTimersByTimeAsync(30_000);
      return store;
    } finally {
      vi.useRealTimers();
    }
  }

  it("keeps auto-refreshing a session that still exists", async () => {
    const store = await autoRefreshCalls();
    expect(vi.mocked(store.refreshIfSourceChanged).mock.calls.length).toBeGreaterThan(0);
  });

  it("pauses auto-refresh once the open session no longer exists", async () => {
    mocks.getSessionLiveness.mockRejectedValue({
      code: "CORE",
      message: "Session not found: session-1",
    });
    const store = await autoRefreshCalls();
    expect(store.refreshIfSourceChanged).not.toHaveBeenCalled();
    expect(mocks.getSessionLiveness).toHaveBeenCalledTimes(1);
  });

  async function runningPoll(source: "copilot" | "claudeCode", autoRefreshSeconds?: number) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const prefs = usePreferencesStore(pinia);
      // Config hydration must finish first, or it resets these preferences.
      await prefs.whenReady;
      await flushPromises();
      if (autoRefreshSeconds) {
        prefs.autoRefreshEnabled = true;
        prefs.autoRefreshIntervalSeconds = autoRefreshSeconds;
      }
      const store = createStore();
      store.detail = { ...store.detail!, source };
      // Only sources that record it report what the process is doing.
      const status = source === "claudeCode" ? "busy" : null;
      mocks.getSessionLiveness.mockResolvedValue({ state: "running", pid: 7, status });
      const wrapper = mountPanel(pinia, store, { refreshEnabled: true });
      await flushPromises();
      await vi.advanceTimersByTimeAsync(RUNNING_SESSION_POLL_MS * 2);
      const polls = () => vi.mocked(store.refreshIfSourceChanged).mock.calls.length;
      const refreshes = () => vi.mocked(store.refreshAll).mock.calls.length;
      const whileRunning = polls();
      const autoWhileRunning = refreshes();
      const badge = wrapper.find(".active-badge-inline");
      const label = badge.exists() ? badge.text() : null;
      mocks.getSessionLiveness.mockResolvedValue({ state: "idle" });
      await vi.advanceTimersByTimeAsync(RUNNING_SESSION_POLL_MS * 4);
      const afterIdle = polls();
      const autoAfterIdle = refreshes();
      wrapper.unmount();
      return { whileRunning, afterIdle, autoWhileRunning, autoAfterIdle, label };
    } finally {
      vi.useRealTimers();
    }
  }

  it("refreshes a running Claude Code session until it goes idle", async () => {
    const { whileRunning, afterIdle, label } = await runningPoll("claudeCode");
    expect(label).toBe("● Busy");
    expect(whileRunning).toBe(2);
    // The poll that saw it go idle refreshed once more, then polling stopped.
    expect(afterIdle).toBe(3);
  });

  it("lets the running poll alone refresh a running Claude Code session with auto-refresh on", async () => {
    const { whileRunning, afterIdle, autoWhileRunning, autoAfterIdle } = await runningPoll(
      "claudeCode",
      3,
    );
    expect(whileRunning).toBe(2);
    expect(autoWhileRunning).toBe(0);
    // Auto-refresh takes over once idle, skipping sections with an unchanged source.
    expect(afterIdle).toBeGreaterThan(3);
    expect(autoAfterIdle).toBe(0);
  });

  it("keeps auto-refreshing a running Copilot session on its interval", async () => {
    const { whileRunning, autoWhileRunning } = await runningPoll("copilot", 3);
    expect(whileRunning).toBe(0);
    expect(autoWhileRunning).toBe(2);
  });

  it("never polls a running Copilot session, which refreshes from the live stream", async () => {
    const { whileRunning, afterIdle, label } = await runningPoll("copilot");
    expect(label).toBe("● Active");
    expect(whileRunning).toBe(0);
    expect(afterIdle).toBe(0);
  });

  it("ignores a running answer for a session the panel has left", async () => {
    let answerFirst: (value: unknown) => void = () => {};
    mocks.getSessionLiveness
      .mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValue({ state: "idle" });
    const wrapper = mountPanel(pinia);
    await flushPromises();
    await wrapper.setProps({ sessionId: "session-2" });
    await flushPromises();
    answerFirst({ state: "running", pid: 7, status: "busy" });
    await flushPromises();

    expect(mocks.getSessionLiveness).toHaveBeenLastCalledWith("session-2");
    expect(wrapper.find(".active-badge-inline").exists()).toBe(false);
    expect(wrapper.emitted("update:isActive")).toEqual([[false]]);
    wrapper.unmount();
  });
});
