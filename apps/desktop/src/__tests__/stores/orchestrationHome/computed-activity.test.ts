// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import {
  FIXTURE_ACTIVE_VERSION,
  FIXTURE_SESSIONS,
  FIXTURE_SYSTEM_DEPS,
  mockCheckSystemDeps,
  mockGetActiveCopilotVersion,
  mockListSessions,
} from "./setup";
import { useOrchestrationHomeStore } from "@/stores/orchestrationHome";
import { describe, expect, it } from "vitest";

describe("useOrchestrationHomeStore - computed properties and activity feed", () => {
  describe("computed properties", () => {
    it("isHealthy returns true when git and copilot available", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.isHealthy).toBe(true);
    });

    it("isHealthy returns false when git unavailable", async () => {
      mockCheckSystemDeps.mockResolvedValue({
        ...FIXTURE_SYSTEM_DEPS,
        gitAvailable: false,
      });
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.isHealthy).toBe(false);
    });

    it("isHealthy returns false when copilot unavailable", async () => {
      mockCheckSystemDeps.mockResolvedValue({
        ...FIXTURE_SYSTEM_DEPS,
        copilotAvailable: false,
      });
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.isHealthy).toBe(false);
    });

    it("copilotVersionStr returns activeVersion.version", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.copilotVersionStr).toBe("1.0.9");
    });

    it("copilotVersionStr falls back to systemDeps.copilotVersion", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(null);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.copilotVersionStr).toBe("1.0.9");
    });

    it("copilotVersionStr returns 'unknown' when both null", async () => {
      mockCheckSystemDeps.mockResolvedValue({
        ...FIXTURE_SYSTEM_DEPS,
        copilotVersion: undefined,
      });
      mockGetActiveCopilotVersion.mockResolvedValue(null);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.copilotVersionStr).toBe("unknown");
    });
  });

  describe("activity feed generation", () => {
    it("generates feed from first 6 sessions", async () => {
      const manySessions = [...FIXTURE_SESSIONS, ...FIXTURE_SESSIONS, ...FIXTURE_SESSIONS]; // 9 sessions
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockResolvedValue(manySessions);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.activityFeed).toHaveLength(6);
    });

    it("marks running sessions as 'session_launched'", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockResolvedValue([
        { ...FIXTURE_SESSIONS[0], isRunning: true, repository: "TestRepo" },
      ]);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.activityFeed[0].type).toBe("session_launched");
      expect(store.activityFeed[0].message).toContain("Session started in TestRepo");
    });

    it("marks completed sessions as 'batch_completed'", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockResolvedValue([
        { ...FIXTURE_SESSIONS[1], isRunning: false, repository: "CompletedRepo" },
      ]);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.activityFeed[0].type).toBe("batch_completed");
      expect(store.activityFeed[0].message).toContain("Session completed in CompletedRepo");
    });

    it("uses correct timestamp fallback logic", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockResolvedValue([
        {
          id: "session-no-updated",
          repository: "TestRepo",
          branch: "main",
          createdAt: "2026-03-28T10:00:00Z",
          updatedAt: undefined,
          isRunning: false,
          eventCount: 10,
          turnCount: 2,
        },
      ]);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.activityFeed[0].timestamp).toBe("2026-03-28T10:00:00Z");
    });
  });
});
