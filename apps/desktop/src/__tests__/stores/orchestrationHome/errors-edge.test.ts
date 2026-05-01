// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import {
  FIXTURE_ACTIVE_VERSION,
  FIXTURE_SESSIONS,
  FIXTURE_SYSTEM_DEPS,
  FIXTURE_VERSIONS,
  mockCheckSystemDeps,
  mockDiscoverCopilotVersions,
  mockGetActiveCopilotVersion,
  mockListRegisteredRepos,
  mockListSessions,
} from "./setup";
import { useOrchestrationHomeStore } from "@/stores/orchestrationHome";
import { describe, expect, it } from "vitest";

describe("useOrchestrationHomeStore - errors and edge cases", () => {
  describe("error handling", () => {
    it("clears error on successful reinitialize", async () => {
      // First: fail in background path (sessions)
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockRejectedValue(new Error("Network error"));
      mockDiscoverCopilotVersions.mockResolvedValue([]);

      const store = useOrchestrationHomeStore();
      await store.initialize();
      expect(store.error).toContain("Network error");

      // Second: succeed
      mockListSessions.mockResolvedValue([]);

      await store.initialize();
      expect(store.error).toBeNull();
    });

    it("sets error when background refresh fails", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockResolvedValue(FIXTURE_SESSIONS);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.totalSessions).toBe(3);
      expect(store.error).toBeNull();

      // Simulate background refresh failure
      mockListSessions.mockRejectedValue(new Error("Refresh failed"));

      // Force cache staleness
      // @ts-expect-error - accessing private field for testing
      store.lastInitialized = Date.now() - 10 * 60 * 1000;

      await store.initialize();

      // Error should be set, but data resets to defaults (store design)
      expect(store.error).toContain("Refresh failed");
      expect(store.totalSessions).toBe(0); // Promise.allSettled returns empty array on failure
    });

    it("handles network errors in background path", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockRejectedValue(new Error("Connection timeout"));
      mockDiscoverCopilotVersions.mockResolvedValue([]);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.error).toContain("Connection timeout");
      expect(store.loading).toBe(false);
    });

    it("sets loading=false on error", async () => {
      mockCheckSystemDeps.mockRejectedValue(new Error("Fatal error"));

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.loading).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("empty sessions list doesn't crash", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockResolvedValue([]);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.totalSessions).toBe(0);
      expect(store.activeSessions).toBe(0);
      expect(store.activityFeed).toEqual([]);
    });

    it("empty repos list doesn't crash", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListRegisteredRepos.mockResolvedValue([]);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.registeredRepos).toEqual([]);
      expect(store.worktreeCount).toBe(0);
    });

    it("all Promise.allSettled rejections handled gracefully", async () => {
      mockCheckSystemDeps.mockRejectedValue(new Error("Deps failed"));
      mockGetActiveCopilotVersion.mockRejectedValue(new Error("Version failed"));
      mockListSessions.mockRejectedValue(new Error("Sessions failed"));
      mockDiscoverCopilotVersions.mockRejectedValue(new Error("Versions failed"));

      const store = useOrchestrationHomeStore();
      await store.initialize();

      // Should not throw, should aggregate errors
      expect(store.error).toBeTruthy();
      expect(store.loading).toBe(false);

      // All state should remain at defaults
      expect(store.totalSessions).toBe(0);
      expect(store.versions).toEqual([]);
    });

    it("handles sessions with null repository gracefully", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockResolvedValue([
        {
          ...FIXTURE_SESSIONS[0],
          repository: null,
        },
      ]);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.activityFeed[0].message).toContain("unknown");
    });
  });
});
