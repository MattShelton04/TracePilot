// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it, vi } from "vitest";
import {
  createDeferred,
  buildFreshness,
  FIXTURE_DETAIL,
  FIXTURE_TODOS,
  SESSION_ID,
  mocks,
  setupSessionDetailStoreTest,
} from "./setup";
import { useSessionDetailStore } from "@/stores/sessionDetail";

setupSessionDetailStoreTest();

describe("useSessionDetailStore", () => {
  describe("refreshAll", () => {
    it("refreshes all previously loaded sections", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadTurns();
      await store.loadTodos();
      await store.loadCheckpoints();

      const updatedTodos = { todos: [{ id: "new" }], deps: [] };
      mocks.getSessionTodos.mockResolvedValue(updatedTodos);
      mocks.checkSessionFreshness.mockResolvedValue(buildFreshness(1024)); // same fingerprint — skip turns

      await store.refreshAll();

      expect(mocks.getSessionDetail).toHaveBeenCalledTimes(2); // initial + refresh
      expect(mocks.getSessionTodos).toHaveBeenCalledTimes(2);
      expect(mocks.getSessionCheckpoints).toHaveBeenCalledTimes(2);
      expect(store.todos).toEqual(updatedTodos);
    });

    it("does not refresh sections that were never loaded", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      await store.refreshAll();

      // Plan was never loaded, so getSessionPlan should not have been called
      expect(mocks.getSessionPlan).not.toHaveBeenCalled();
      // Incidents was never loaded, so getSessionIncidents should not have been called
      expect(mocks.getSessionIncidents).not.toHaveBeenCalled();
    });

    it("does not refresh events (events manage their own pagination)", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadEvents();

      mocks.getSessionEvents.mockClear();
      await store.refreshAll();

      expect(mocks.getSessionEvents).not.toHaveBeenCalled();
    });

    it("sets error ref when a section refresh fails", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadTodos();
      await store.loadPlan();

      mocks.getSessionTodos.mockRejectedValue(new Error("Refresh failed"));
      mocks.getSessionPlan.mockResolvedValue({ plan: "updated plan" });

      await store.refreshAll();

      expect(store.todosError).toBe("Refresh failed");
      // Plan succeeded — error should be cleared
      expect(store.planError).toBeNull();
      expect(store.plan).toEqual({ plan: "updated plan" });
    });

    it("sets detail error when refresh fails and retains existing detail", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      mocks.getSessionDetail.mockRejectedValueOnce(new Error("Detail refresh failed"));
      await store.refreshAll();

      expect(store.error).toBe("Detail refresh failed");
      expect(store.detail).toEqual(FIXTURE_DETAIL);
    });

    it("clears detail error on successful refresh after failure", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      mocks.getSessionDetail.mockRejectedValueOnce(new Error("Detail fail"));
      await store.refreshAll();
      expect(store.error).toBe("Detail fail");

      const UPDATED_DETAIL = { ...FIXTURE_DETAIL, branch: "feature/new" };
      mocks.getSessionDetail.mockResolvedValue(UPDATED_DETAIL);

      await store.refreshAll();
      expect(store.error).toBeNull();
      expect(store.detail).toEqual(UPDATED_DETAIL);
    });

    it("clears section error on successful refresh after prior error", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      // Initial load fails
      mocks.getSessionTodos.mockRejectedValue(new Error("Initial fail"));
      await store.loadTodos();
      expect(store.todosError).toBe("Initial fail");

      // Mark as loaded so refreshAll processes it
      // (buildSectionLoader doesn't add to loaded on error, so add manually)
      store.loaded.add("todos");
      mocks.getSessionTodos.mockResolvedValue(FIXTURE_TODOS);
      await store.refreshAll();

      expect(store.todosError).toBeNull();
      expect(store.todos).toEqual(FIXTURE_TODOS);
    });

    it("discards stale standard-section refresh results after switching sessions", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadPlan();

      const stalePlan = createDeferred<{ plan: string }>();
      mocks.getSessionDetail.mockResolvedValue(FIXTURE_DETAIL);
      mocks.getSessionPlan.mockReturnValueOnce(stalePlan.promise);

      const refreshPromise = store.refreshAll();

      const OTHER_ID = "other-456";
      const OTHER_DETAIL = { ...FIXTURE_DETAIL, id: OTHER_ID };
      const OTHER_PLAN = { plan: "other plan" };
      mocks.getSessionDetail.mockResolvedValueOnce(OTHER_DETAIL);
      await store.loadDetail(OTHER_ID);
      mocks.getSessionPlan.mockResolvedValueOnce(OTHER_PLAN);
      await store.loadPlan();

      stalePlan.resolve({ plan: "stale plan" });
      await refreshPromise;

      expect(store.sessionId).toBe(OTHER_ID);
      expect(store.plan).toEqual(OTHER_PLAN);
      expect(store.planError).toBeNull();
    });
  });

  describe("refreshIfSourceChanged", () => {
    const versioned = (sourceVersion: string, size = 1024) => ({
      ...buildFreshness(size),
      sourceVersion,
    });

    async function loadEverything() {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadTurns();
      await store.loadShutdownMetrics();
      await store.loadTodos();
      await store.loadIncidents();
      vi.clearAllMocks();
      return store;
    }

    it("reloads only sections not built from the source while its version is unchanged", async () => {
      const store = await loadEverything();
      mocks.checkSessionFreshness.mockResolvedValue(versioned("v1"));

      await store.refreshIfSourceChanged(); // first tick: nothing to compare against
      expect(mocks.getSessionDetail).toHaveBeenCalledTimes(1);
      expect(mocks.getShutdownMetrics).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      await store.refreshIfSourceChanged();
      expect(mocks.checkSessionFreshness).toHaveBeenCalledTimes(1);
      expect(mocks.getSessionDetail).not.toHaveBeenCalled();
      expect(mocks.getSessionTurns).not.toHaveBeenCalled();
      expect(mocks.getShutdownMetrics).not.toHaveBeenCalled();
      expect(mocks.getSessionTodos).toHaveBeenCalledTimes(1);
      expect(mocks.getSessionIncidents).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      mocks.checkSessionFreshness.mockResolvedValue(versioned("v2", 2048));
      await store.refreshIfSourceChanged();
      expect(mocks.getSessionDetail).toHaveBeenCalledTimes(1);
      expect(mocks.getSessionTurns).toHaveBeenCalledTimes(1);
      expect(mocks.getShutdownMetrics).toHaveBeenCalledTimes(1);
    });

    it("refreshes everything when the freshness probe fails", async () => {
      const store = await loadEverything();
      mocks.checkSessionFreshness.mockResolvedValue(versioned("v1"));
      await store.refreshIfSourceChanged();

      vi.clearAllMocks();
      mocks.checkSessionFreshness.mockRejectedValue(new Error("probe failed"));
      await store.refreshIfSourceChanged();
      expect(mocks.getSessionDetail).toHaveBeenCalledTimes(1);
      expect(mocks.getShutdownMetrics).toHaveBeenCalledTimes(1);
    });

    it("does not carry a version over to another session", async () => {
      const store = await loadEverything();
      mocks.checkSessionFreshness.mockResolvedValue(versioned("same"));
      await store.refreshIfSourceChanged();

      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "other-456" });
      await store.loadDetail("other-456");
      vi.clearAllMocks();
      await store.refreshIfSourceChanged();
      expect(mocks.getSessionDetail).toHaveBeenCalledTimes(1);
    });
  });
});
