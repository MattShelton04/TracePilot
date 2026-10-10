import { readFileSync } from "node:fs";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, type Pinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SessionDetailPanel from "@/components/session/SessionDetailPanel.vue";
import { RUNNING_SESSION_POLL_MS } from "@/composables/useRunningSessionPoll";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";
import { makeTimeline, makeWindow } from "@/utils/__tests__/promptCacheFixtures";

const mocks = vi.hoisted(() => ({
  getSessionLiveness: vi.fn(),
  openInExplorer: vi.fn(),
  resumeSessionInTerminal: vi.fn(),
  copy: vi.fn(),
}));

vi.mock("@tracepilot/ui", async (original) => {
  const module = await original<typeof import("@tracepilot/ui")>();
  const { ref } = await import("vue");
  return { ...module, useClipboard: () => ({ copy: mocks.copy, copied: ref(false) }) };
});

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getSessionLiveness: mocks.getSessionLiveness,
    openInExplorer: mocks.openInExplorer,
    resumeSessionInTerminal: mocks.resumeSessionInTerminal,
  });
});

function createStore(): SessionDetailContext {
  return {
    sessionId: "session-1",
    detail: {
      id: "session-1",
      summary: "Explorer Layout Session",
      repository: "MattShelton04/TracePilot",
      branch: "main",
      hostType: "cli",
      eventCount: 4,
      turnCount: 2,
      hasPlan: false,
      hasCheckpoints: false,
    },
    turns: [],
    turnsVersion: 0,
    events: null,
    todos: null,
    checkpoints: null,
    plan: null,
    shutdownMetrics: null,
    incidents: null,
    loading: false,
    error: null,
    loaded: new Set(["detail"]),
    turnsError: null,
    eventsError: null,
    todosError: null,
    checkpointsError: null,
    planError: null,
    metricsError: null,
    incidentsError: null,
    promptCache: null,
    promptCacheError: null,
    pendingCheckpointFocus: null,
    focusCheckpoint: vi.fn(),
    loadDetail: vi.fn(),
    loadTurns: vi.fn(),
    loadEvents: vi.fn(),
    loadTodos: vi.fn(),
    loadCheckpoints: vi.fn(),
    loadPlan: vi.fn(),
    loadShutdownMetrics: vi.fn(),
    loadIncidents: vi.fn(),
    loadPromptCache: vi.fn(),
    reset: vi.fn(),
    refreshAll: vi.fn(),
    refreshIfSourceChanged: vi.fn(),
    prefetchSession: vi.fn(),
  } as unknown as SessionDetailContext;
}

describe("SessionDetailPanel", () => {
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

  it("keeps Explorer fill-content mode inside the standard constrained page shell", () => {
    const wrapper = mount(SessionDetailPanel, {
      global: { plugins: [pinia] },
      props: {
        store: createStore(),
        sessionId: "session-1",
        router: null,
        tabMode: "local",
        activeSubTab: "explorer",
        fillContent: true,
        refreshEnabled: false,
      },
      slots: {
        default: '<div class="explorer-slot">Explorer</div>',
      },
    });

    expect(wrapper.find(".page-content.explorer-mode").exists()).toBe(true);
    expect(wrapper.find(".page-content-inner").exists()).toBe(true);
    expect(wrapper.find(".page-content-fluid").exists()).toBe(false);
  });

  it("preserves the constrained shell width when Explorer switches the shell to flex layout", () => {
    const css = readFileSync("src/styles/features/session-explorer.css", "utf8");

    expect(css).toMatch(
      /\.page-content\.explorer-mode \.page-content-inner\s*\{[^}]*width:\s*100%;/s,
    );
  });

  async function autoRefreshCalls(): Promise<SessionDetailContext> {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const prefs = usePreferencesStore(pinia);
      await flushPromises(); // let config hydration finish before overriding it
      prefs.autoRefreshEnabled = true;
      prefs.autoRefreshIntervalSeconds = 5;
      const store = createStore();
      mount(SessionDetailPanel, {
        global: { plugins: [pinia] },
        props: {
          store,
          sessionId: "session-1",
          tabMode: "local",
          activeSubTab: "overview",
          refreshEnabled: true,
        },
      });
      await flushPromises();
      await vi.advanceTimersByTimeAsync(30_000);
      return store;
    } finally {
      vi.useRealTimers();
    }
  }

  it("keeps auto-refreshing a session that still exists", async () => {
    const store = await autoRefreshCalls();
    expect(vi.mocked(store.refreshAll).mock.calls.length).toBeGreaterThan(0);
  });

  it("pauses auto-refresh once the open session no longer exists", async () => {
    mocks.getSessionLiveness.mockRejectedValue({
      code: "CORE",
      message: "Session not found: session-1",
    });
    const store = await autoRefreshCalls();
    expect(store.refreshAll).not.toHaveBeenCalled();
    expect(mocks.getSessionLiveness).toHaveBeenCalledTimes(1);
  });

  it("shows recorded cache expiry beside resume controls for an ended session", async () => {
    const prefs = usePreferencesStore(pinia);
    prefs.featureFlags.promptCacheInsights = true;
    const store = createStore();
    store.promptCache = makeTimeline([
      makeWindow({
        outcome: "sessionEnded",
        resumeAt: null,
        expiresAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      }),
    ]);
    const wrapper = mount(SessionDetailPanel, {
      global: { plugins: [pinia] },
      props: {
        store,
        sessionId: "session-1",
        tabMode: "local",
        activeSubTab: "overview",
        refreshEnabled: false,
      },
    });
    await flushPromises();

    expect(wrapper.find(".active-badge-inline").exists()).toBe(false);
    expect(wrapper.get('[data-testid="prompt-cache-chip"]').text()).toContain(
      "Cache expired 12m ago",
    );
    expect(wrapper.text()).toContain("Resume");

    prefs.featureFlags.promptCacheInsights = false;
    await wrapper.setProps({ sessionId: "session-2" });
    expect(wrapper.find('[data-testid="prompt-cache-chip"]').exists()).toBe(false);
    wrapper.unmount();
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
      const wrapper = mount(SessionDetailPanel, {
        global: { plugins: [pinia] },
        props: {
          store,
          sessionId: "session-1",
          tabMode: "local",
          activeSubTab: "overview",
          refreshEnabled: true,
        },
      });
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
    expect(afterIdle).toBe(3);
    // Auto-refresh takes over once the session is idle.
    expect(autoAfterIdle).toBeGreaterThan(0);
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
    const wrapper = mount(SessionDetailPanel, {
      global: { plugins: [pinia] },
      props: {
        store: createStore(),
        sessionId: "session-1",
        tabMode: "local",
        activeSubTab: "overview",
        refreshEnabled: false,
      },
    });
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

  function mountForSource(source?: "copilot" | "claudeCode") {
    const store = createStore();
    if (source) store.detail = { ...store.detail!, source, hostType: null };
    return mount(SessionDetailPanel, {
      global: { plugins: [pinia] },
      props: {
        store,
        sessionId: "session-1",
        tabMode: "local",
        activeSubTab: "overview",
        refreshEnabled: false,
      },
    });
  }

  it("marks a Claude Code session waiting for input apart from a busy one", async () => {
    const header = async (status: "busy" | "waiting") => {
      mocks.getSessionLiveness.mockResolvedValue({ state: "running", pid: 7, status });
      const wrapper = mountForSource("claudeCode");
      await flushPromises();
      const badge = wrapper.get(".active-badge-inline");
      const result = {
        text: badge.text(),
        warning: badge.classes().includes("badge-warning"),
        dot: wrapper.get(".active-dot").classes().includes("active-dot--waiting"),
      };
      wrapper.unmount();
      return result;
    };
    expect(await header("busy")).toEqual({ text: "● Busy", warning: false, dot: false });
    expect(await header("waiting")).toEqual({ text: "● Waiting", warning: true, dot: true });
  });

  it("keeps every tab and Copilot action for a session without a source", async () => {
    const wrapper = mountForSource();
    await flushPromises();

    const tabs = wrapper.findAll("[role='tab']").map((t) => t.text());
    const text = wrapper.text();
    expect(tabs).toHaveLength(8);
    expect(text).toContain("Copy Resume Command");
    expect(text).toContain("Resume in Terminal");
    expect(text).toContain("Open Folder");
    expect(text).toContain("cli");
    expect(text).not.toContain("Claude Code");
    wrapper.unmount();
  });

  it("resumes a Copilot session through the configured CLI command", async () => {
    const prefs = usePreferencesStore(pinia);
    // Config hydration must finish first, or it resets these preferences.
    await prefs.whenReady;
    await flushPromises();
    prefs.cliCommand = "gh copilot";
    const wrapper = mountForSource("copilot");
    await flushPromises();

    await wrapper.get('[title="Copy: gh copilot --resume session-1"]').trigger("click");
    expect(mocks.copy).toHaveBeenCalledWith("gh copilot --resume session-1");
    await wrapper.get('[title="Resume session session-1 in a new terminal"]').trigger("click");
    expect(mocks.resumeSessionInTerminal).toHaveBeenCalledWith("session-1", "gh copilot");
    wrapper.unmount();
  });

  it("resumes a Claude Code session through its own CLI command, not Copilot's", async () => {
    const prefs = usePreferencesStore(pinia);
    // Config hydration must finish first, or it resets these preferences.
    await prefs.whenReady;
    await flushPromises();
    prefs.cliCommand = "gh copilot";
    prefs.claudeCliCommand = "npx claude";
    const wrapper = mountForSource("claudeCode");
    await flushPromises();

    await wrapper.get('[title="Copy: npx claude --resume session-1"]').trigger("click");
    expect(mocks.copy).toHaveBeenCalledWith("npx claude --resume session-1");
    await wrapper.get('[title="Resume session session-1 in a new terminal"]').trigger("click");
    // The backend picks the Claude Code CLI; the Copilot preference is not sent.
    expect(mocks.resumeSessionInTerminal).toHaveBeenCalledWith("session-1", undefined);
    wrapper.unmount();
  });

  it("asks before resuming a Claude Code session that is running elsewhere", async () => {
    mocks.getSessionLiveness.mockResolvedValue({ state: "running", pid: 7, status: "waiting" });
    const wrapper = mountForSource("claudeCode");
    await flushPromises();

    await wrapper.get('[title="Resume session session-1 in a new terminal"]').trigger("click");
    expect(mocks.resumeSessionInTerminal).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Session is active elsewhere");
    const anyway = wrapper.findAll("button").find((b) => b.text() === "Resume Anyway");
    await anyway!.trigger("click");
    expect(mocks.resumeSessionInTerminal).toHaveBeenCalledWith("session-1", undefined);
    wrapper.unmount();
  });

  it("hides Copilot-only tabs and actions for a Claude Code session", async () => {
    const wrapper = mountForSource("claudeCode");
    await flushPromises();

    const tabs = wrapper.findAll("[role='tab']").map((t) => t.text());
    const text = wrapper.text();
    expect(tabs.map((t) => t.replace(/\d+$/, "").trim())).toEqual([
      "Overview",
      "Conversation",
      "Events",
      "Metrics",
      "Context",
      "Explorer",
      "Timeline",
    ]);
    expect(text).toContain("Copy Resume Command");
    const copyButton = wrapper.get('[title="Copy: claude --resume session-1"]');
    await copyButton.trigger("click");
    expect(mocks.copy).toHaveBeenCalledWith("claude --resume session-1");
    expect(text).toContain("Resume in Terminal");
    expect(text).not.toContain("Open Folder");
    expect(wrapper.get('[title="Session source"]').text()).toBe("Claude Code");
    wrapper.unmount();
  });

  it("shows a folder chip from the cwd only when the session has no repository", async () => {
    const header = async (detail: { repository: string | null; cwd: string | null }) => {
      const wrapper = mountForSource("claudeCode");
      const store = wrapper.props("store");
      await wrapper.setProps({ store: { ...store, detail: { ...store.detail!, ...detail } } });
      await flushPromises();
      const chip = wrapper.find('[data-testid="session-project-chip"]');
      const result = {
        chip: chip.exists() ? chip.text() : null,
        title: chip.exists() ? chip.attributes("title") : null,
        icon: chip.exists() && chip.find("svg").exists(),
        badges: wrapper.findAll(".detail-badges .badge").map((b) => b.text()),
      };
      wrapper.unmount();
      return result;
    };

    expect(await header({ repository: null, cwd: "/work/synthetic/orchard/" })).toEqual({
      chip: "orchard",
      title: "/work/synthetic/orchard/",
      icon: true,
      badges: ["Claude Code", "orchard", "main"],
    });
    expect(await header({ repository: "org/app", cwd: "/work/app" })).toMatchObject({
      chip: null,
      badges: ["Claude Code", "org/app", "main"],
    });
    expect(await header({ repository: null, cwd: null })).toMatchObject({
      chip: null,
      badges: ["Claude Code", "main"],
    });
  });

  it("keeps Claude Code gating when the detail omits a source the list knows", async () => {
    useSessionsStore(pinia).sessions = [
      { id: "session-1", source: "claudeCode", isRunning: false },
    ] as never;
    const wrapper = mountForSource();
    await flushPromises();

    const tabs = wrapper.findAll("[role='tab']");
    expect(tabs).toHaveLength(7);
    expect(wrapper.find('[title="Copy: claude --resume session-1"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Resume in Terminal");
    expect(wrapper.text()).not.toContain("Open Folder");
    expect(wrapper.get('[title="Session source"]').text()).toBe("Claude Code");
    wrapper.unmount();
  });
});
