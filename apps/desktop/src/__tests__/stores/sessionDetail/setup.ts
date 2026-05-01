import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, vi } from "vitest";
import type { useSessionDetailStore } from "@/stores/sessionDetail";

export { createDeferred } from "@tracepilot/test-utils";

const hoistedMocks = vi.hoisted(() => ({
  getSessionDetail: vi.fn(),
  getSessionTurns: vi.fn(),
  getSessionEvents: vi.fn(),
  getSessionTodos: vi.fn(),
  getSessionCheckpoints: vi.fn(),
  getSessionPlan: vi.fn(),
  getShutdownMetrics: vi.fn(),
  getSessionIncidents: vi.fn(),
  checkSessionFreshness: vi.fn(),
}));

export const mocks = hoistedMocks;

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getSessionDetail: (...args: unknown[]) => hoistedMocks.getSessionDetail(...args),
    getSessionTurns: (...args: unknown[]) => hoistedMocks.getSessionTurns(...args),
    getSessionEvents: (...args: unknown[]) => hoistedMocks.getSessionEvents(...args),
    getSessionTodos: (...args: unknown[]) => hoistedMocks.getSessionTodos(...args),
    getSessionCheckpoints: (...args: unknown[]) => hoistedMocks.getSessionCheckpoints(...args),
    getSessionPlan: (...args: unknown[]) => hoistedMocks.getSessionPlan(...args),
    getShutdownMetrics: (...args: unknown[]) => hoistedMocks.getShutdownMetrics(...args),
    getSessionIncidents: (...args: unknown[]) => hoistedMocks.getSessionIncidents(...args),
    checkSessionFreshness: (...args: unknown[]) => hoistedMocks.checkSessionFreshness(...args),
  });
});

export const SESSION_ID = "abc-123";
export const FIXTURE_DETAIL = {
  id: SESSION_ID,
  repository: "test-repo",
  branch: "main",
  createdAt: "2026-03-01T00:00:00Z",
  updatedAt: "2026-03-01T01:00:00Z",
  eventCount: 42,
  turnCount: 10,
  checkpointCount: 2,
};
export const FIXTURE_EVENTS_MTIME = 1_700_000_000_000;
export const FIXTURE_TURNS = {
  turns: [{ turnIndex: 0, userMessage: "hello", assistantMessages: [], toolCalls: [] }],
  eventsFileSize: 1024,
  eventsFileMtime: FIXTURE_EVENTS_MTIME,
};
export const FIXTURE_EVENTS = { events: [], totalCount: 0, hasMore: false, allEventTypes: [] };
export const FIXTURE_TODOS = { todos: [], deps: [] };
export const FIXTURE_CHECKPOINTS = [{ number: 1, content: "checkpoint" }];
export const FIXTURE_PLAN = { plan: "do the thing" };
export const FIXTURE_METRICS = { totalPremiumRequests: 5, currentModel: "gpt-4" };
export const FIXTURE_INCIDENTS = [{ severity: "warning", summary: "rate limit" }];
export const ZERO_FRESHNESS = { eventsFileSize: 0, eventsFileMtime: null };
export const buildFreshness = (size: number, mtime = FIXTURE_EVENTS_MTIME) => ({
  eventsFileSize: size,
  eventsFileMtime: mtime,
});

export function setupSessionDetailStoreTest() {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();

    // Default: all succeed
    hoistedMocks.getSessionDetail.mockResolvedValue(FIXTURE_DETAIL);
    hoistedMocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
    hoistedMocks.getSessionEvents.mockResolvedValue(FIXTURE_EVENTS);
    hoistedMocks.getSessionTodos.mockResolvedValue(FIXTURE_TODOS);
    hoistedMocks.getSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
    hoistedMocks.getSessionPlan.mockResolvedValue(FIXTURE_PLAN);
    hoistedMocks.getShutdownMetrics.mockResolvedValue(FIXTURE_METRICS);
    hoistedMocks.getSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);
    hoistedMocks.checkSessionFreshness.mockResolvedValue(ZERO_FRESHNESS);
  });
}

export async function fullyLoadSession(
  store: ReturnType<typeof useSessionDetailStore>,
  id: string,
) {
  await store.loadDetail(id);
  await store.loadTurns();
  await store.loadCheckpoints();
  await store.loadPlan();
  await store.loadShutdownMetrics();
  await store.loadIncidents();
}
