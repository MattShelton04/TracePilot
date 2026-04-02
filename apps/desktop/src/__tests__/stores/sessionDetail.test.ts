import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionDetailStore } from "@/stores/sessionDetail";

// ── Mock client functions ──────────────────────────────────────
const mockGetSessionDetail = vi.fn();
const mockGetSessionTurns = vi.fn();
const mockGetSessionEvents = vi.fn();
const mockGetSessionTodos = vi.fn();
const mockGetSessionCheckpoints = vi.fn();
const mockGetSessionPlan = vi.fn();
const mockGetShutdownMetrics = vi.fn();
const mockGetSessionIncidents = vi.fn();
const mockCheckSessionFreshness = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    getSessionDetail: (...args: unknown[]) => mockGetSessionDetail(...args),
    getSessionTurns: (...args: unknown[]) => mockGetSessionTurns(...args),
    getSessionEvents: (...args: unknown[]) => mockGetSessionEvents(...args),
    getSessionTodos: (...args: unknown[]) => mockGetSessionTodos(...args),
    getSessionCheckpoints: (...args: unknown[]) => mockGetSessionCheckpoints(...args),
    getSessionPlan: (...args: unknown[]) => mockGetSessionPlan(...args),
    getShutdownMetrics: (...args: unknown[]) => mockGetShutdownMetrics(...args),
    getSessionIncidents: (...args: unknown[]) => mockGetSessionIncidents(...args),
    checkSessionFreshness: (...args: unknown[]) => mockCheckSessionFreshness(...args),
  });
});

// ── Fixtures ───────────────────────────────────────────────────
const SESSION_ID = "abc-123";
const FIXTURE_DETAIL = {
  id: SESSION_ID,
  repository: "test-repo",
  branch: "main",
  createdAt: "2026-03-01T00:00:00Z",
  updatedAt: "2026-03-01T01:00:00Z",
  eventCount: 42,
  turnCount: 10,
  checkpointCount: 2,
};
const FIXTURE_TURNS = {
  turns: [{ turnIndex: 0, userMessage: "hello", assistantMessages: [], toolCalls: [] }],
  eventsFileSize: 1024,
};
const FIXTURE_EVENTS = { events: [], totalCount: 0, hasMore: false, allEventTypes: [] };
const FIXTURE_TODOS = { todos: [], deps: [] };
const FIXTURE_CHECKPOINTS = [{ number: 1, content: "checkpoint" }];
const FIXTURE_PLAN = { plan: "do the thing" };
const FIXTURE_METRICS = { totalPremiumRequests: 5, currentModel: "gpt-4" };
const FIXTURE_INCIDENTS = [{ severity: "warning", summary: "rate limit" }];

describe("useSessionDetailStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Default: all succeed
    mockGetSessionDetail.mockResolvedValue(FIXTURE_DETAIL);
    mockGetSessionTurns.mockResolvedValue(FIXTURE_TURNS);
    mockGetSessionEvents.mockResolvedValue(FIXTURE_EVENTS);
    mockGetSessionTodos.mockResolvedValue(FIXTURE_TODOS);
    mockGetSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
    mockGetSessionPlan.mockResolvedValue(FIXTURE_PLAN);
    mockGetShutdownMetrics.mockResolvedValue(FIXTURE_METRICS);
    mockGetSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);
    mockCheckSessionFreshness.mockResolvedValue({ eventsFileSize: 0 });
  });

  describe("initial state", () => {
    it("has null section errors on creation", () => {
      const store = useSessionDetailStore();
      expect(store.turnsError).toBeNull();
      expect(store.eventsError).toBeNull();
      expect(store.todosError).toBeNull();
      expect(store.checkpointsError).toBeNull();
      expect(store.planError).toBeNull();
      expect(store.metricsError).toBeNull();
      expect(store.incidentsError).toBeNull();
    });

    it("starts turnsVersion at 0", () => {
      const store = useSessionDetailStore();
      expect(store.turnsVersion).toBe(0);
    });
  });

  describe("loadDetail", () => {
    it("sets error when detail fetch fails", async () => {
      mockGetSessionDetail.mockRejectedValue(new Error("Network error"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      expect(store.error).toBe("Network error");
      expect(store.detail).toBeNull();
    });

    it("clears section errors when loading a new session", async () => {
      const store = useSessionDetailStore();
      // Load first session and create a turnsError
      await store.loadDetail(SESSION_ID);
      mockGetSessionTurns.mockRejectedValue(new Error("Turn error"));
      await store.loadTurns();
      expect(store.turnsError).toBe("Turn error");

      // Load a new session — section errors should clear
      mockGetSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "other-id" });
      await store.loadDetail("other-id");
      expect(store.turnsError).toBeNull();
    });
  });

  describe("loadTurns", () => {
    it("sets turnsError on failure", async () => {
      mockGetSessionTurns.mockRejectedValue(new Error("Failed to fetch turns"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadTurns();
      expect(store.turnsError).toBe("Failed to fetch turns");
      expect(store.turns).toEqual([]);
    });

    it("clears turnsError before retrying", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      // First: fail
      mockGetSessionTurns.mockRejectedValue(new Error("Fail"));
      await store.loadTurns();
      expect(store.turnsError).toBe("Fail");

      // Retry: succeed (need to clear loaded set first, as the store would in retry)
      store.loaded.delete("turns");
      mockGetSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      await store.loadTurns();
      expect(store.turnsError).toBeNull();
      expect(store.turns).toEqual(FIXTURE_TURNS.turns);
    });

    it("handles non-Error objects in catch", async () => {
      mockGetSessionTurns.mockRejectedValue("string error");
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadTurns();
      expect(store.turnsError).toBe("string error");
    });
  });

  describe("loadEvents", () => {
    it("sets eventsError on failure", async () => {
      mockGetSessionEvents.mockRejectedValue(new Error("Events failed"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadEvents();
      expect(store.eventsError).toBe("Events failed");
    });

    it("clears eventsError on successful reload", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      mockGetSessionEvents.mockRejectedValue(new Error("Fail"));
      await store.loadEvents();
      expect(store.eventsError).toBe("Fail");

      mockGetSessionEvents.mockResolvedValue(FIXTURE_EVENTS);
      await store.loadEvents(0, 50);
      expect(store.eventsError).toBeNull();
    });
  });

  describe("loadTodos", () => {
    it("sets todosError on failure", async () => {
      mockGetSessionTodos.mockRejectedValue(new Error("Todos failed"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadTodos();
      expect(store.todosError).toBe("Todos failed");
    });
  });

  describe("loadCheckpoints", () => {
    it("sets checkpointsError on failure", async () => {
      mockGetSessionCheckpoints.mockRejectedValue(new Error("Checkpoints failed"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadCheckpoints();
      expect(store.checkpointsError).toBe("Checkpoints failed");
    });
  });

  describe("loadPlan", () => {
    it("sets planError on failure", async () => {
      mockGetSessionPlan.mockRejectedValue(new Error("Plan failed"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadPlan();
      expect(store.planError).toBe("Plan failed");
    });
  });

  describe("loadShutdownMetrics", () => {
    it("sets metricsError on failure", async () => {
      mockGetShutdownMetrics.mockRejectedValue(new Error("Metrics failed"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadShutdownMetrics();
      expect(store.metricsError).toBe("Metrics failed");
    });
  });

  describe("loadIncidents", () => {
    it("sets incidentsError on failure", async () => {
      mockGetSessionIncidents.mockRejectedValue(new Error("Incidents failed"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadIncidents();
      expect(store.incidentsError).toBe("Incidents failed");
    });
  });

  describe("reset", () => {
    it("clears all section errors", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      // Create errors in multiple sections
      mockGetSessionTurns.mockRejectedValue(new Error("T"));
      mockGetSessionTodos.mockRejectedValue(new Error("D"));
      mockGetShutdownMetrics.mockRejectedValue(new Error("M"));
      await store.loadTurns();
      await store.loadTodos();
      await store.loadShutdownMetrics();
      expect(store.turnsError).toBe("T");
      expect(store.todosError).toBe("D");
      expect(store.metricsError).toBe("M");

      store.reset();
      expect(store.turnsError).toBeNull();
      expect(store.todosError).toBeNull();
      expect(store.metricsError).toBeNull();
      expect(store.eventsError).toBeNull();
      expect(store.checkpointsError).toBeNull();
      expect(store.planError).toBeNull();
      expect(store.incidentsError).toBeNull();
    });
  });

  describe("successful load clears error", () => {
    it("clears turnsError when turns load successfully after prior failure", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      mockGetSessionTurns.mockRejectedValue(new Error("First fail"));
      await store.loadTurns();
      expect(store.turnsError).toBe("First fail");

      // Simulate retry: clear loaded, retry with success
      store.loaded.delete("turns");
      mockGetSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      await store.loadTurns();
      expect(store.turnsError).toBeNull();
      expect(store.turns.length).toBe(1);
    });
  });

  describe("refreshAll", () => {
    it("refreshes all previously loaded sections", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadTurns();
      await store.loadTodos();
      await store.loadCheckpoints();

      const updatedTodos = { todos: [{ id: "new" }], deps: [] };
      mockGetSessionTodos.mockResolvedValue(updatedTodos);
      mockCheckSessionFreshness.mockResolvedValue({ eventsFileSize: 1024 }); // same size — skip turns

      await store.refreshAll();

      expect(mockGetSessionDetail).toHaveBeenCalledTimes(2); // initial + refresh
      expect(mockGetSessionTodos).toHaveBeenCalledTimes(2);
      expect(mockGetSessionCheckpoints).toHaveBeenCalledTimes(2);
      expect(store.todos).toEqual(updatedTodos);
    });

    it("does not refresh sections that were never loaded", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      await store.refreshAll();

      // Plan was never loaded, so getSessionPlan should not have been called
      expect(mockGetSessionPlan).not.toHaveBeenCalled();
      // Incidents was never loaded, so getSessionIncidents should not have been called
      expect(mockGetSessionIncidents).not.toHaveBeenCalled();
    });

    it("does not refresh events (events manage their own pagination)", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadEvents();

      mockGetSessionEvents.mockClear();
      await store.refreshAll();

      expect(mockGetSessionEvents).not.toHaveBeenCalled();
    });

    it("sets error ref when a section refresh fails", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadTodos();
      await store.loadPlan();

      mockGetSessionTodos.mockRejectedValue(new Error("Refresh failed"));
      mockGetSessionPlan.mockResolvedValue({ plan: "updated plan" });

      await store.refreshAll();

      expect(store.todosError).toBe("Refresh failed");
      // Plan succeeded — error should be cleared
      expect(store.planError).toBeNull();
      expect(store.plan).toEqual({ plan: "updated plan" });
    });

    it("clears section error on successful refresh after prior error", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      // Initial load fails
      mockGetSessionTodos.mockRejectedValue(new Error("Initial fail"));
      await store.loadTodos();
      expect(store.todosError).toBe("Initial fail");

      // Mark as loaded so refreshAll processes it
      // (buildSectionLoader doesn't add to loaded on error, so add manually)
      store.loaded.add("todos");
      mockGetSessionTodos.mockResolvedValue(FIXTURE_TODOS);
      await store.refreshAll();

      expect(store.todosError).toBeNull();
      expect(store.todos).toEqual(FIXTURE_TODOS);
    });

    it("updates non-tail turns when refresh returns retrospective subagent completion", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      const initialTurns = {
        turns: [
          {
            turnIndex: 0,
            userMessage: "hello",
            assistantMessages: [],
            toolCalls: [
              {
                toolName: "task",
                toolCallId: "sa-1",
                isSubagent: true,
                isComplete: false,
              },
            ],
            isComplete: true,
          },
          {
            turnIndex: 1,
            userMessage: "next",
            assistantMessages: [],
            toolCalls: [],
            isComplete: true,
          },
        ],
        eventsFileSize: 100,
      };
      mockGetSessionTurns.mockResolvedValue(initialTurns);
      await store.loadTurns();

      const beforeVersion = store.turnsVersion;
      expect(store.turns[0]?.toolCalls[0]?.isComplete).toBe(false);

      mockCheckSessionFreshness.mockResolvedValue({ eventsFileSize: 120 });
      mockGetSessionTurns.mockResolvedValue({
        turns: [
          {
            turnIndex: 0,
            userMessage: "hello",
            assistantMessages: [],
            toolCalls: [
              {
                toolName: "task",
                toolCallId: "sa-1",
                isSubagent: true,
                isComplete: true,
                success: true,
              },
            ],
            isComplete: true,
          },
          {
            turnIndex: 1,
            userMessage: "next",
            assistantMessages: [],
            toolCalls: [],
            isComplete: true,
          },
        ],
        eventsFileSize: 120,
      });

      await store.refreshAll();

      expect(store.turns[0]?.toolCalls[0]?.isComplete).toBe(true);
      expect(store.turns[0]?.toolCalls[0]?.success).toBe(true);
      expect(store.turnsVersion).toBeGreaterThan(beforeVersion);
    });

    it("does not bump turnsVersion when refresh turns payload is unchanged", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadTurns();

      const beforeVersion = store.turnsVersion;
      mockCheckSessionFreshness.mockResolvedValue({
        eventsFileSize: FIXTURE_TURNS.eventsFileSize + 10,
      });
      mockGetSessionTurns.mockResolvedValue({
        turns: structuredClone(FIXTURE_TURNS.turns),
        eventsFileSize: FIXTURE_TURNS.eventsFileSize + 10,
      });

      await store.refreshAll();

      expect(store.turnsVersion).toBe(beforeVersion);
    });

    it("updates turn when only model changes", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      mockGetSessionTurns.mockResolvedValue({
        turns: [
          {
            turnIndex: 0,
            model: "gpt-5.3-codex",
            userMessage: "hello",
            assistantMessages: [],
            toolCalls: [],
            isComplete: true,
          },
        ],
        eventsFileSize: 200,
      });
      await store.loadTurns();

      const beforeVersion = store.turnsVersion;
      expect(store.turns[0]?.model).toBe("gpt-5.3-codex");

      mockCheckSessionFreshness.mockResolvedValue({ eventsFileSize: 220 });
      mockGetSessionTurns.mockResolvedValue({
        turns: [
          {
            turnIndex: 0,
            model: "claude-sonnet-4.6",
            userMessage: "hello",
            assistantMessages: [],
            toolCalls: [],
            isComplete: true,
          },
        ],
        eventsFileSize: 220,
      });

      await store.refreshAll();

      expect(store.turns[0]?.model).toBe("claude-sonnet-4.6");
      expect(store.turnsVersion).toBeGreaterThan(beforeVersion);
    });
  });

  // ── Cache-hit background refresh ──────────────────────────────
  // When a session is restored from the frontend cache, the store
  // delegates background refresh to refreshAll() rather than
  // using ad-hoc inline IIFEs.
  describe("cache-hit background refresh", () => {
    /** Helper: fully load a session so all sections are in the cache. */
    async function fullyLoadSession(store: ReturnType<typeof useSessionDetailStore>, id: string) {
      await store.loadDetail(id);
      await store.loadTurns();
      await store.loadCheckpoints();
      await store.loadPlan();
      await store.loadShutdownMetrics();
      await store.loadIncidents();
    }

    it("triggers background refresh for all cached sections on cache hit", async () => {
      const store = useSessionDetailStore();
      await fullyLoadSession(store, SESSION_ID);

      // Load a different session — SESSION_ID is now cached
      const OTHER_ID = "other-456";
      mockGetSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: OTHER_ID });
      await store.loadDetail(OTHER_ID);

      // Clear mocks so we can assert only cache-hit refresh calls
      vi.clearAllMocks();
      mockGetSessionDetail.mockResolvedValue(FIXTURE_DETAIL);
      mockGetSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      mockGetSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
      mockGetSessionPlan.mockResolvedValue(FIXTURE_PLAN);
      mockGetShutdownMetrics.mockResolvedValue(FIXTURE_METRICS);
      mockGetSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);
      mockCheckSessionFreshness.mockResolvedValue({
        eventsFileSize: FIXTURE_TURNS.eventsFileSize + 1,
      });

      // Load the original session — cache hit
      await store.loadDetail(SESSION_ID);
      // Allow background refreshAll() to settle
      await new Promise((r) => setTimeout(r, 50));

      // All previously loaded sections should have been refreshed
      expect(mockGetSessionDetail).toHaveBeenCalledWith(SESSION_ID);
      expect(mockCheckSessionFreshness).toHaveBeenCalledWith(SESSION_ID);
      expect(mockGetSessionTurns).toHaveBeenCalledWith(SESSION_ID);
      expect(mockGetSessionCheckpoints).toHaveBeenCalledWith(SESSION_ID);
      expect(mockGetSessionPlan).toHaveBeenCalledWith(SESSION_ID);
      expect(mockGetShutdownMetrics).toHaveBeenCalledWith(SESSION_ID);
      expect(mockGetSessionIncidents).toHaveBeenCalledWith(SESSION_ID);
    });

    it("does not background-refresh events or todos on cache hit", async () => {
      const store = useSessionDetailStore();
      await fullyLoadSession(store, SESSION_ID);
      await store.loadTodos();
      await store.loadEvents();

      // Switch away then back to trigger cache hit
      const OTHER_ID = "other-456";
      mockGetSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: OTHER_ID });
      await store.loadDetail(OTHER_ID);

      vi.clearAllMocks();
      mockGetSessionDetail.mockResolvedValue(FIXTURE_DETAIL);
      mockGetSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      mockGetSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
      mockGetSessionPlan.mockResolvedValue(FIXTURE_PLAN);
      mockGetShutdownMetrics.mockResolvedValue(FIXTURE_METRICS);
      mockGetSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);
      mockCheckSessionFreshness.mockResolvedValue({ eventsFileSize: 0 });

      await store.loadDetail(SESSION_ID);
      await new Promise((r) => setTimeout(r, 50));

      // Events and todos should NOT be refreshed in background
      expect(mockGetSessionEvents).not.toHaveBeenCalled();
      expect(mockGetSessionTodos).not.toHaveBeenCalled();
    });

    it("sets section error refs when background refresh fails on cache hit", async () => {
      const store = useSessionDetailStore();
      await fullyLoadSession(store, SESSION_ID);

      // Switch to another session to cache SESSION_ID
      const OTHER_ID = "other-456";
      mockGetSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: OTHER_ID });
      await store.loadDetail(OTHER_ID);

      // Set up failures for the background refresh
      vi.clearAllMocks();
      mockGetSessionDetail.mockResolvedValue(FIXTURE_DETAIL);
      mockCheckSessionFreshness.mockResolvedValue({ eventsFileSize: 0 });
      mockGetSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      mockGetSessionPlan.mockRejectedValue(new Error("Plan refresh failed"));
      mockGetSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
      mockGetShutdownMetrics.mockRejectedValue(new Error("Metrics refresh failed"));
      mockGetSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);

      // Load cached session — triggers background refresh
      await store.loadDetail(SESSION_ID);
      await new Promise((r) => setTimeout(r, 50));

      // Error refs should be set for failed sections
      expect(store.planError).toBe("Plan refresh failed");
      expect(store.metricsError).toBe("Metrics refresh failed");
      // Successful sections should have null error refs
      expect(store.checkpointsError).toBeNull();
      expect(store.incidentsError).toBeNull();
    });

    it("discards stale background refresh when user switches session during refresh", async () => {
      const store = useSessionDetailStore();
      await fullyLoadSession(store, SESSION_ID);

      // Switch away to cache SESSION_ID
      const OTHER_ID = "other-456";
      mockGetSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: OTHER_ID });
      await store.loadDetail(OTHER_ID);

      // Set up slow detail response for SESSION_ID
      const STALE_DETAIL = { ...FIXTURE_DETAIL, repository: "stale-repo" };
      let resolveStaleDetail: (v: unknown) => void;
      const staleDetailPromise = new Promise((r) => {
        resolveStaleDetail = r;
      });
      mockGetSessionDetail.mockReturnValueOnce(staleDetailPromise);
      mockCheckSessionFreshness.mockResolvedValue({ eventsFileSize: 0 });
      mockGetSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
      mockGetSessionPlan.mockResolvedValue(FIXTURE_PLAN);
      mockGetShutdownMetrics.mockResolvedValue(FIXTURE_METRICS);
      mockGetSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);

      // Start loading cached SESSION_ID (background refresh starts)
      void store.loadDetail(SESSION_ID);
      await new Promise((r) => setTimeout(r, 10));

      // User immediately switches to a THIRD session
      const THIRD_ID = "third-789";
      const THIRD_DETAIL = { ...FIXTURE_DETAIL, id: THIRD_ID, repository: "third-repo" };
      mockGetSessionDetail.mockResolvedValue(THIRD_DETAIL);
      await store.loadDetail(THIRD_ID);

      // Now the stale SESSION_ID detail response arrives
      resolveStaleDetail!(STALE_DETAIL);
      await new Promise((r) => setTimeout(r, 50));

      // The stale response should have been discarded — detail should be THIRD session
      expect(store.detail).toEqual(THIRD_DETAIL);
      expect(store.sessionId).toBe(THIRD_ID);
    });

    it("restores cached data instantly without loading spinner", async () => {
      const store = useSessionDetailStore();
      await fullyLoadSession(store, SESSION_ID);

      // Switch away
      const OTHER_ID = "other-456";
      mockGetSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: OTHER_ID });
      await store.loadDetail(OTHER_ID);

      // Load cached session — should be instant
      mockGetSessionDetail.mockResolvedValue(FIXTURE_DETAIL);
      mockCheckSessionFreshness.mockResolvedValue({ eventsFileSize: 0 });
      mockGetSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
      mockGetSessionPlan.mockResolvedValue(FIXTURE_PLAN);
      mockGetShutdownMetrics.mockResolvedValue(FIXTURE_METRICS);
      mockGetSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);

      await store.loadDetail(SESSION_ID);

      // loading should be false (no spinner)
      expect(store.loading).toBe(false);
      // Cached data should be present immediately
      expect(store.detail).toBeTruthy();
      expect(store.checkpoints).toEqual(FIXTURE_CHECKPOINTS);
      expect(store.plan).toEqual(FIXTURE_PLAN);
      expect(store.shutdownMetrics).toEqual(FIXTURE_METRICS);
      expect(store.incidents).toEqual(FIXTURE_INCIDENTS);
    });
  });
});
