import { readFileSync } from "node:fs";
import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SessionDetailPanel from "@/components/session/SessionDetailPanel.vue";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import { makeTimeline, makeWindow } from "@/utils/__tests__/promptCacheFixtures";

const mocks = vi.hoisted(() => ({
  isSessionRunning: vi.fn(),
  openInExplorer: vi.fn(),
  resumeSessionInTerminal: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    isSessionRunning: mocks.isSessionRunning,
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
    prefetchSession: vi.fn(),
  } as unknown as SessionDetailContext;
}

describe("SessionDetailPanel", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    mocks.isSessionRunning.mockResolvedValue(false);
  });

  it("keeps Explorer fill-content mode inside the standard constrained page shell", () => {
    const wrapper = mount(SessionDetailPanel, {
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

  it("shows recorded cache expiry beside resume controls for an ended session", async () => {
    const prefs = usePreferencesStore();
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
});
