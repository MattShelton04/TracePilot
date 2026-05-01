// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import {
  FIXTURE_DETAIL,
  FIXTURE_EVENTS,
  FIXTURE_TURNS,
  SESSION_ID,
  mocks,
  setupSessionDetailStoreTest,
} from "./setup";
import { useSessionDetailStore } from "@/stores/sessionDetail";

setupSessionDetailStoreTest();

describe("useSessionDetailStore", () => {
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
      mocks.getSessionDetail.mockRejectedValue(new Error("Network error"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      expect(store.error).toBe("Network error");
      expect(store.detail).toBeNull();
    });

    it("clears section errors when loading a new session", async () => {
      const store = useSessionDetailStore();
      // Load first session and create a turnsError
      await store.loadDetail(SESSION_ID);
      mocks.getSessionTurns.mockRejectedValue(new Error("Turn error"));
      await store.loadTurns();
      expect(store.turnsError).toBe("Turn error");

      // Load a new session — section errors should clear
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "other-id" });
      await store.loadDetail("other-id");
      expect(store.turnsError).toBeNull();
    });
  });

  describe("loadTurns", () => {
    it("sets turnsError on failure", async () => {
      mocks.getSessionTurns.mockRejectedValue(new Error("Failed to fetch turns"));
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
      mocks.getSessionTurns.mockRejectedValue(new Error("Fail"));
      await store.loadTurns();
      expect(store.turnsError).toBe("Fail");

      // Retry: succeed (need to clear loaded set first, as the store would in retry)
      store.loaded.delete("turns");
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      await store.loadTurns();
      expect(store.turnsError).toBeNull();
      expect(store.turns).toEqual(FIXTURE_TURNS.turns);
    });

    it("handles non-Error objects in catch", async () => {
      mocks.getSessionTurns.mockRejectedValue("string error");
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadTurns();
      expect(store.turnsError).toBe("string error");
    });
  });

  describe("loadEvents", () => {
    it("sets eventsError on failure", async () => {
      mocks.getSessionEvents.mockRejectedValue(new Error("Events failed"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadEvents();
      expect(store.eventsError).toBe("Events failed");
    });

    it("clears eventsError on successful reload", async () => {
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);

      mocks.getSessionEvents.mockRejectedValue(new Error("Fail"));
      await store.loadEvents();
      expect(store.eventsError).toBe("Fail");

      mocks.getSessionEvents.mockResolvedValue(FIXTURE_EVENTS);
      await store.loadEvents(0, 50);
      expect(store.eventsError).toBeNull();
    });
  });

  describe("loadTodos", () => {
    it("sets todosError on failure", async () => {
      mocks.getSessionTodos.mockRejectedValue(new Error("Todos failed"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadTodos();
      expect(store.todosError).toBe("Todos failed");
    });
  });

  describe("loadCheckpoints", () => {
    it("sets checkpointsError on failure", async () => {
      mocks.getSessionCheckpoints.mockRejectedValue(new Error("Checkpoints failed"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadCheckpoints();
      expect(store.checkpointsError).toBe("Checkpoints failed");
    });
  });

  describe("loadPlan", () => {
    it("sets planError on failure", async () => {
      mocks.getSessionPlan.mockRejectedValue(new Error("Plan failed"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadPlan();
      expect(store.planError).toBe("Plan failed");
    });
  });

  describe("loadShutdownMetrics", () => {
    it("sets metricsError on failure", async () => {
      mocks.getShutdownMetrics.mockRejectedValue(new Error("Metrics failed"));
      const store = useSessionDetailStore();
      await store.loadDetail(SESSION_ID);
      await store.loadShutdownMetrics();
      expect(store.metricsError).toBe("Metrics failed");
    });
  });

  describe("loadIncidents", () => {
    it("sets incidentsError on failure", async () => {
      mocks.getSessionIncidents.mockRejectedValue(new Error("Incidents failed"));
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
      mocks.getSessionTurns.mockRejectedValue(new Error("T"));
      mocks.getSessionTodos.mockRejectedValue(new Error("D"));
      mocks.getShutdownMetrics.mockRejectedValue(new Error("M"));
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

      mocks.getSessionTurns.mockRejectedValue(new Error("First fail"));
      await store.loadTurns();
      expect(store.turnsError).toBe("First fail");

      // Simulate retry: clear loaded, retry with success
      store.loaded.delete("turns");
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      await store.loadTurns();
      expect(store.turnsError).toBeNull();
      expect(store.turns.length).toBe(1);
    });
  });
});
