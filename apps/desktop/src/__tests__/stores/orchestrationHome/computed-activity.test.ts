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
import { describe, expect, it, vi } from "vitest";

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

    it("describes a running session as running, in its repository", async () => {
      mockListSessions.mockResolvedValue([
        { ...FIXTURE_SESSIONS[0], isRunning: true, repository: "TestRepo", summary: "Ship it" },
      ]);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.activityFeed[0]).toMatchObject({
        sessionId: "session-1",
        title: "Ship it",
        location: "TestRepo",
        isRunning: true,
      });
    });

    it("falls back to the folder for a session with no repository", async () => {
      mockListSessions.mockResolvedValue([
        { ...FIXTURE_SESSIONS[1], repository: null, cwd: "/home/user/work/harbor" },
      ]);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.activityFeed[0]).toMatchObject({
        title: null,
        location: "harbor",
        isRunning: false,
      });
    });

    it("lists the most recently active sessions first", async () => {
      mockListSessions.mockResolvedValue([
        FIXTURE_SESSIONS[2],
        FIXTURE_SESSIONS[0],
        FIXTURE_SESSIONS[1],
      ]);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.activityFeed.map((e) => e.sessionId)).toEqual([
        "session-1",
        "session-2",
        "session-3",
      ]);
    });

    it("marks sessions loaded only once they arrive", async () => {
      let resolve!: (value: unknown[]) => void;
      mockListSessions.mockReturnValue(new Promise((r) => (resolve = r)));

      const store = useOrchestrationHomeStore();
      const init = store.initialize();
      await vi.waitFor(() => expect(store.loading).toBe(false));
      expect(store.sessionsLoaded).toBe(false);

      resolve(FIXTURE_SESSIONS);
      await init;
      expect(store.sessionsLoaded).toBe(true);
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
