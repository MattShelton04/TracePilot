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
  mockListWorktrees,
} from "./setup";
import { useOrchestrationHomeStore } from "@/stores/orchestrationHome";
import { describe, expect, it, vi } from "vitest";

describe("useOrchestrationHomeStore - initialization", () => {
  describe("initial state", () => {
    it("initializes with null and empty values", () => {
      const store = useOrchestrationHomeStore();
      expect(store.systemDeps).toBeNull();
      expect(store.totalSessions).toBe(0);
      expect(store.activeSessions).toBe(0);
      expect(store.activeVersion).toBeNull();
      expect(store.versions).toEqual([]);
      expect(store.worktreeCount).toBe(0);
      expect(store.staleWorktreeCount).toBe(0);
      expect(store.totalDiskUsage).toBe(0);
      expect(store.registeredRepos).toEqual([]);
      expect(store.activityFeed).toEqual([]);
    });

    it("initializes with loading and error as false/null", () => {
      const store = useOrchestrationHomeStore();
      expect(store.loading).toBe(false);
      expect(store.refreshing).toBe(false);
      expect(store.error).toBeNull();
    });

    it("isHealthy returns false when systemDeps is null", () => {
      const store = useOrchestrationHomeStore();
      expect(store.isHealthy).toBe(false);
    });
  });

  describe("initialize - first load", () => {
    it("loads all data successfully on first initialization", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockResolvedValue(FIXTURE_SESSIONS);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);
      mockListRegisteredRepos.mockResolvedValue([]);
      mockListWorktrees.mockResolvedValue([]);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.systemDeps).toEqual(FIXTURE_SYSTEM_DEPS);
      expect(store.activeVersion).toEqual(FIXTURE_ACTIVE_VERSION);
      expect(store.totalSessions).toBe(3);
      expect(store.activeSessions).toBe(1);
      expect(store.versions).toEqual(FIXTURE_VERSIONS);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("sets loading=true during fetch, false after completion", async () => {
      const store = useOrchestrationHomeStore();
      const initPromise = store.initialize();

      // Should be loading immediately
      expect(store.loading).toBe(true);

      await initPromise;

      // Should be false after completion
      expect(store.loading).toBe(false);
    });

    it("handles partial failures with Promise.allSettled", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockRejectedValue(new Error("Sessions API failed"));
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      // Successful calls should populate
      expect(store.systemDeps).toEqual(FIXTURE_SYSTEM_DEPS);
      expect(store.activeVersion).toEqual(FIXTURE_ACTIVE_VERSION);
      expect(store.versions).toEqual(FIXTURE_VERSIONS);

      // Failed calls should leave defaults
      expect(store.totalSessions).toBe(0);
      expect(store.activeSessions).toBe(0);

      // Error should be set
      expect(store.error).toContain("Sessions API failed");
      expect(store.loading).toBe(false);
    });

    it("aggregates multiple errors into error.value", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockRejectedValue(new Error("Sessions failed"));
      mockDiscoverCopilotVersions.mockRejectedValue(new Error("Versions failed"));

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.error).toContain("Sessions failed");
      expect(store.error).toContain("Versions failed");
    });

    it("generates activity feed from recent sessions", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockResolvedValue(FIXTURE_SESSIONS);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);

      const store = useOrchestrationHomeStore();
      await store.initialize();

      expect(store.activityFeed).toHaveLength(3);
      expect(store.activityFeed[0].type).toBe("session_launched"); // isRunning=true
      expect(store.activityFeed[0].message).toContain("TracePilot");
      expect(store.activityFeed[1].type).toBe("batch_completed"); // isRunning=false
      expect(store.activityFeed[1].message).toContain("MyProject");
    });
  });

  describe("initialize - cache behavior", () => {
    it("reuses fresh cache without loading spinner", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockResolvedValue(FIXTURE_SESSIONS);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);

      const store = useOrchestrationHomeStore();

      // First initialization
      await store.initialize();
      expect(store.loading).toBe(false);

      // Second initialization (cache fresh < 5min)
      const _loadingSpy = vi.fn();
      const _originalLoading = store.loading;
      await store.initialize();

      // Should use cache refresh instead of loading
      expect(store.refreshing).toBe(false);
      expect(store.systemDeps).toEqual(FIXTURE_SYSTEM_DEPS);
    });

    it("shows stale cache immediately, refreshes in background", async () => {
      mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
      mockGetActiveCopilotVersion.mockResolvedValue(FIXTURE_ACTIVE_VERSION);
      mockListSessions.mockResolvedValue(FIXTURE_SESSIONS);
      mockDiscoverCopilotVersions.mockResolvedValue(FIXTURE_VERSIONS);

      const store = useOrchestrationHomeStore();

      // First initialization
      await store.initialize();

      // Mock stale cache (> 5 min old)
      // @ts-expect-error - accessing private field for testing
      store.lastInitialized = Date.now() - 6 * 60 * 1000;

      // Second initialization should show cached data immediately
      const initPromise = store.initialize();

      // Data should be available immediately from cache
      expect(store.systemDeps).toEqual(FIXTURE_SYSTEM_DEPS);

      await initPromise;
      expect(store.refreshing).toBe(false);
    });
  });
});
