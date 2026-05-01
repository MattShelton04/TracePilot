// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it, vi } from "vitest";
import {
  createDeferred,
  buildFreshness,
  fullyLoadSession,
  FIXTURE_CHECKPOINTS,
  FIXTURE_DETAIL,
  FIXTURE_INCIDENTS,
  FIXTURE_METRICS,
  FIXTURE_PLAN,
  FIXTURE_TURNS,
  SESSION_ID,
  ZERO_FRESHNESS,
  mocks,
  setupSessionDetailStoreTest,
} from "./setup";
import { useSessionDetailStore } from "@/stores/sessionDetail";

setupSessionDetailStoreTest();

describe("useSessionDetailStore", () => {
  // ── Cache-hit background refresh ──────────────────────────────
  // When a session is restored from the frontend cache, the store
  // delegates background refresh to refreshAll() rather than
  // using ad-hoc inline IIFEs.
  describe("cache-hit background refresh", () => {
    it("triggers background refresh for all cached sections on cache hit", async () => {
      const store = useSessionDetailStore();
      await fullyLoadSession(store, SESSION_ID);

      // Load a different session — SESSION_ID is now cached
      const OTHER_ID = "other-456";
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: OTHER_ID });
      await store.loadDetail(OTHER_ID);

      // Clear mocks so we can assert only cache-hit refresh calls
      vi.clearAllMocks();
      mocks.getSessionDetail.mockResolvedValue(FIXTURE_DETAIL);
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      mocks.getSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
      mocks.getSessionPlan.mockResolvedValue(FIXTURE_PLAN);
      mocks.getShutdownMetrics.mockResolvedValue(FIXTURE_METRICS);
      mocks.getSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);
      mocks.checkSessionFreshness.mockResolvedValue(
        buildFreshness(FIXTURE_TURNS.eventsFileSize + 1),
      );

      // Load the original session — cache hit
      await store.loadDetail(SESSION_ID);
      // Allow background refreshAll() to settle
      await new Promise((r) => setTimeout(r, 50));

      // All previously loaded sections should have been refreshed
      expect(mocks.getSessionDetail).toHaveBeenCalledWith(SESSION_ID);
      expect(mocks.checkSessionFreshness).toHaveBeenCalledWith(SESSION_ID);
      expect(mocks.getSessionTurns).toHaveBeenCalledWith(SESSION_ID);
      expect(mocks.getSessionCheckpoints).toHaveBeenCalledWith(SESSION_ID);
      expect(mocks.getSessionPlan).toHaveBeenCalledWith(SESSION_ID);
      expect(mocks.getShutdownMetrics).toHaveBeenCalledWith(SESSION_ID);
      expect(mocks.getSessionIncidents).toHaveBeenCalledWith(SESSION_ID);
    });

    it("background-refreshes todos but not events on cache hit", async () => {
      const store = useSessionDetailStore();
      await fullyLoadSession(store, SESSION_ID);
      await store.loadTodos();
      await store.loadEvents();

      // Switch away then back to trigger cache hit
      const OTHER_ID = "other-456";
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: OTHER_ID });
      await store.loadDetail(OTHER_ID);

      vi.clearAllMocks();
      mocks.getSessionDetail.mockResolvedValue(FIXTURE_DETAIL);
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      mocks.getSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
      mocks.getSessionPlan.mockResolvedValue(FIXTURE_PLAN);
      mocks.getShutdownMetrics.mockResolvedValue(FIXTURE_METRICS);
      mocks.getSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);
      mocks.getSessionTodos.mockResolvedValue({ todos: [{ id: "fresh" }], deps: [] });
      mocks.checkSessionFreshness.mockResolvedValue(ZERO_FRESHNESS);

      await store.loadDetail(SESSION_ID);
      await new Promise((r) => setTimeout(r, 50));

      // Todos IS refreshed so agents writing new todos while cached are picked up
      // (regression: previously the cache-hit path deleted todos from `loaded`
      //  which caused the background refreshAll to skip todos entirely).
      expect(mocks.getSessionTodos).toHaveBeenCalledWith(SESSION_ID);
      // Events remain paginated / not auto-refreshed (they manage their own cursor).
      expect(mocks.getSessionEvents).not.toHaveBeenCalled();
    });

    it("sets section error refs when background refresh fails on cache hit", async () => {
      const store = useSessionDetailStore();
      await fullyLoadSession(store, SESSION_ID);

      // Switch to another session to cache SESSION_ID
      const OTHER_ID = "other-456";
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: OTHER_ID });
      await store.loadDetail(OTHER_ID);

      // Set up failures for the background refresh
      vi.clearAllMocks();
      mocks.getSessionDetail.mockResolvedValue(FIXTURE_DETAIL);
      mocks.checkSessionFreshness.mockResolvedValue(ZERO_FRESHNESS);
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      mocks.getSessionPlan.mockRejectedValue(new Error("Plan refresh failed"));
      mocks.getSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
      mocks.getShutdownMetrics.mockRejectedValue(new Error("Metrics refresh failed"));
      mocks.getSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);

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
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: OTHER_ID });
      await store.loadDetail(OTHER_ID);

      // Set up slow detail response for SESSION_ID
      const STALE_DETAIL = { ...FIXTURE_DETAIL, repository: "stale-repo" };
      const staleDetail = createDeferred<typeof STALE_DETAIL>();
      mocks.getSessionDetail.mockReturnValueOnce(staleDetail.promise);
      mocks.checkSessionFreshness.mockResolvedValue(ZERO_FRESHNESS);
      mocks.getSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
      mocks.getSessionPlan.mockResolvedValue(FIXTURE_PLAN);
      mocks.getShutdownMetrics.mockResolvedValue(FIXTURE_METRICS);
      mocks.getSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);

      // Start loading cached SESSION_ID (background refresh starts)
      void store.loadDetail(SESSION_ID);
      await new Promise((r) => setTimeout(r, 10));

      // User immediately switches to a THIRD session
      const THIRD_ID = "third-789";
      const THIRD_DETAIL = { ...FIXTURE_DETAIL, id: THIRD_ID, repository: "third-repo" };
      mocks.getSessionDetail.mockResolvedValue(THIRD_DETAIL);
      await store.loadDetail(THIRD_ID);

      // Now the stale SESSION_ID detail response arrives
      staleDetail.resolve(STALE_DETAIL);
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
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: OTHER_ID });
      await store.loadDetail(OTHER_ID);

      // Load cached session — should be instant
      mocks.getSessionDetail.mockResolvedValue(FIXTURE_DETAIL);
      mocks.checkSessionFreshness.mockResolvedValue(ZERO_FRESHNESS);
      mocks.getSessionCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
      mocks.getSessionPlan.mockResolvedValue(FIXTURE_PLAN);
      mocks.getShutdownMetrics.mockResolvedValue(FIXTURE_METRICS);
      mocks.getSessionIncidents.mockResolvedValue(FIXTURE_INCIDENTS);

      await store.loadDetail(SESSION_ID);

      // loading should be false (no spinner)
      expect(store.loading).toBe(false);
      // Cached data should be present immediately
      expect(store.detail).toBeTruthy();
      expect(store.turns).toEqual(FIXTURE_TURNS.turns);
      expect(store.checkpoints).toEqual(FIXTURE_CHECKPOINTS);
      expect(store.plan).toEqual(FIXTURE_PLAN);
      expect(store.shutdownMetrics).toEqual(FIXTURE_METRICS);
      expect(store.incidents).toEqual(FIXTURE_INCIDENTS);
    });
  });
});
