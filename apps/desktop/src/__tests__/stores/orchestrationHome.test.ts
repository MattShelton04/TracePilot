import { setupPinia } from "@tracepilot/test-utils";
import type {
  CopilotVersion,
  RegisteredRepo,
  SessionListItem,
  SystemDependencies,
  WorktreeInfo,
} from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOrchestrationHomeStore } from "@/stores/orchestrationHome";

// ── Mock client functions ──────────────────────────────────────
const mockCheckSystemDeps = vi.fn();
const mockListSessions = vi.fn();
const mockDiscoverCopilotVersions = vi.fn();
const mockGetActiveCopilotVersion = vi.fn();
const mockListWorktrees = vi.fn();
const mockListRegisteredRepos = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    checkSystemDeps: (...args: unknown[]) => mockCheckSystemDeps(...args),
    listSessions: (...args: unknown[]) => mockListSessions(...args),
    discoverCopilotVersions: (...args: unknown[]) => mockDiscoverCopilotVersions(...args),
    getActiveCopilotVersion: (...args: unknown[]) => mockGetActiveCopilotVersion(...args),
    listWorktrees: (...args: unknown[]) => mockListWorktrees(...args),
    listRegisteredRepos: (...args: unknown[]) => mockListRegisteredRepos(...args),
  });
});

// ── Fixtures ───────────────────────────────────────────────────
const FIXTURE_SYSTEM_DEPS: SystemDependencies = {
  gitAvailable: true,
  gitVersion: "2.45.0",
  copilotAvailable: true,
  copilotVersion: "1.0.9",
  copilotHomeExists: true,
};

const FIXTURE_ACTIVE_VERSION: CopilotVersion = {
  version: "1.0.9",
  path: "/home/user/.copilot/versions/1.0.9",
  isActive: true,
  isComplete: true,
  modifiedAt: "2026-03-28T10:00:00Z",
  hasCustomizations: false,
  lockCount: 0,
};

const FIXTURE_VERSIONS: CopilotVersion[] = [
  FIXTURE_ACTIVE_VERSION,
  {
    version: "1.0.8",
    path: "/home/user/.copilot/versions/1.0.8",
    isActive: false,
    isComplete: true,
    modifiedAt: "2026-03-27T10:00:00Z",
    hasCustomizations: true,
    lockCount: 1,
  },
];

const FIXTURE_SESSIONS: SessionListItem[] = [
  {
    id: "session-1",
    repository: "TracePilot",
    branch: "main",
    createdAt: "2026-03-28T10:00:00Z",
    updatedAt: "2026-03-28T10:30:00Z",
    isRunning: true,
    eventCount: 50,
    turnCount: 8,
  },
  {
    id: "session-2",
    repository: "MyProject",
    branch: "feature/test",
    createdAt: "2026-03-28T09:00:00Z",
    updatedAt: "2026-03-28T09:45:00Z",
    isRunning: false,
    eventCount: 120,
    turnCount: 15,
  },
  {
    id: "session-3",
    repository: "AnotherRepo",
    branch: "develop",
    createdAt: "2026-03-28T08:00:00Z",
    updatedAt: "2026-03-28T08:20:00Z",
    isRunning: false,
    eventCount: 30,
    turnCount: 4,
  },
];

const FIXTURE_WORKTREES: WorktreeInfo[] = [
  {
    path: "/home/user/repos/TracePilot/.worktrees/feature-a",
    branch: "feature-a",
    headCommit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    isMainWorktree: false,
    isBare: false,
    status: "active",
    repoRoot: "/home/user/repos/TracePilot",
    diskUsageBytes: 1024 * 1024 * 50, // 50MB
    isLocked: false,
    createdAt: "2026-03-27T10:00:00Z",
  },
  {
    path: "/home/user/repos/TracePilot/.worktrees/feature-b",
    branch: "feature-b",
    headCommit: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
    isMainWorktree: false,
    isBare: false,
    status: "stale",
    repoRoot: "/home/user/repos/TracePilot",
    diskUsageBytes: 1024 * 1024 * 30, // 30MB
    isLocked: false,
    createdAt: "2026-03-26T10:00:00Z",
  },
  {
    path: "/home/user/repos/TracePilot",
    branch: "main",
    headCommit: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    isMainWorktree: true,
    isBare: false,
    status: "active",
    repoRoot: "/home/user/repos/TracePilot",
    diskUsageBytes: 1024 * 1024 * 100, // 100MB
    isLocked: false,
  },
];

const FIXTURE_REPOS: RegisteredRepo[] = [
  {
    path: "/home/user/repos/TracePilot",
    name: "TracePilot",
    addedAt: "2026-03-20T10:00:00Z",
    source: "manual",
    favourite: true,
  },
  {
    path: "/home/user/repos/MyProject",
    name: "MyProject",
    addedAt: "2026-03-22T14:00:00Z",
    source: "session-discovery",
    favourite: false,
  },
];

describe("useOrchestrationHomeStore", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();

    // Default: all succeed with empty/default data
    mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
    mockListSessions.mockResolvedValue([]);
    mockDiscoverCopilotVersions.mockResolvedValue([]);
    mockGetActiveCopilotVersion.mockResolvedValue(null);
    mockListWorktrees.mockResolvedValue([]);
    mockListRegisteredRepos.mockResolvedValue([]);
  });

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
      mockListRegisteredRepos.mockResolvedValue(FIXTURE_REPOS);
      mockListWorktrees.mockResolvedValue(FIXTURE_WORKTREES);

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

  describe("loadWorktreeStatsFromRegistry", () => {
    it("aggregates stats from multiple repos correctly", async () => {
      mockListRegisteredRepos.mockResolvedValue(FIXTURE_REPOS);
      mockListWorktrees
        .mockResolvedValueOnce(FIXTURE_WORKTREES) // First repo
        .mockResolvedValueOnce([]); // Second repo (empty)

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStatsFromRegistry();

      expect(store.registeredRepos).toEqual(FIXTURE_REPOS);
      expect(store.worktreeCount).toBe(3);
      expect(store.staleWorktreeCount).toBe(1);
      expect(store.totalDiskUsage).toBe(1024 * 1024 * 180); // 50+30+100 MB
    });

    it("handles repos with no worktrees gracefully", async () => {
      mockListRegisteredRepos.mockResolvedValue(FIXTURE_REPOS);
      mockListWorktrees.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStatsFromRegistry();

      expect(store.worktreeCount).toBe(0);
      expect(store.staleWorktreeCount).toBe(0);
      expect(store.totalDiskUsage).toBe(0);
    });

    it("skips failed repos without blocking others", async () => {
      mockListRegisteredRepos.mockResolvedValue(FIXTURE_REPOS);
      mockListWorktrees
        .mockRejectedValueOnce(new Error("Repo 1 failed"))
        .mockResolvedValueOnce(FIXTURE_WORKTREES);

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStatsFromRegistry();

      // Should still aggregate from successful repo
      expect(store.worktreeCount).toBe(3);
      expect(store.staleWorktreeCount).toBe(1);
    });

    it("handles empty repos list gracefully", async () => {
      mockListRegisteredRepos.mockResolvedValue([]);

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStatsFromRegistry();

      expect(store.registeredRepos).toEqual([]);
      expect(store.worktreeCount).toBe(0);
    });
  });

  describe("loadWorktreeStats", () => {
    it("loads stats for a single repo", async () => {
      mockListWorktrees.mockResolvedValue(FIXTURE_WORKTREES);

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStats("/home/user/repos/TracePilot");

      expect(store.worktreeCount).toBe(3);
      expect(store.staleWorktreeCount).toBe(1);
      expect(store.totalDiskUsage).toBe(1024 * 1024 * 180);
    });

    it("skips silently if repoPath is null", async () => {
      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStats(undefined);

      expect(mockListWorktrees).not.toHaveBeenCalled();
      expect(store.worktreeCount).toBe(0);
    });

    it("handles fetch errors gracefully", async () => {
      mockListWorktrees.mockRejectedValue(new Error("Network error"));

      const store = useOrchestrationHomeStore();
      await store.loadWorktreeStats("/home/user/repos/TracePilot");

      // Should not throw, should not update stats
      expect(store.worktreeCount).toBe(0);
    });
  });

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
