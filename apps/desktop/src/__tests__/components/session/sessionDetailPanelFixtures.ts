/**
 * Shared fixtures for the SessionDetailPanel tests. Each test file still
 * declares its own `vi.mock` calls, which Vitest hoists per file.
 */
import { mount } from "@vue/test-utils";
import type { Pinia } from "pinia";
import { vi } from "vitest";
import SessionDetailPanel from "@/components/session/SessionDetailPanel.vue";
import type { SessionDetailContext } from "@/composables/useSessionDetail";

export function createStore(): SessionDetailContext {
  return {
    sessionId: "session-1",
    detail: {
      id: "session-1",
      folder: "/home/demo/.copilot/session-state/session-1",
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
    pullRequests: [],
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
    loadPullRequests: vi.fn(),
    reset: vi.fn(),
    refreshAll: vi.fn(),
    refreshIfSourceChanged: vi.fn(),
    prefetchSession: vi.fn(),
  } as unknown as SessionDetailContext;
}

export const CLAUDE_PROJECT_FOLDER = "/home/demo/.claude/projects/-work-synthetic-orchard";

/** Mounts the panel in local tab mode on the overview, with auto-refresh paused. */
export function mountPanel(
  pinia: Pinia,
  store: SessionDetailContext = createStore(),
  props: { refreshEnabled?: boolean } = {},
) {
  return mount(SessionDetailPanel, {
    global: { plugins: [pinia] },
    props: {
      store,
      sessionId: "session-1",
      tabMode: "local",
      activeSubTab: "overview",
      refreshEnabled: false,
      ...props,
    },
  });
}

/** Mounts the panel for a session of `source` (none: the detail omits it). */
export function mountForSource(pinia: Pinia, source?: "copilot" | "claudeCode") {
  const store = createStore();
  if (source) store.detail = { ...store.detail!, source, hostType: null };
  if (source === "claudeCode") store.detail = { ...store.detail!, folder: CLAUDE_PROJECT_FOLDER };
  return mountPanel(pinia, store);
}
