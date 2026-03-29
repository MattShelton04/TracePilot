import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { useWorktreesStore } from "../../stores/worktrees";
import type {
  WorktreeInfo,
  WorktreeDetails,
  CreateWorktreeRequest,
  PruneResult,
  RegisteredRepo,
} from "@tracepilot/types";

// ── Mock client functions ──────────────────────────────────────
const mockListWorktrees = vi.fn();
const mockCreateWorktree = vi.fn();
const mockRemoveWorktree = vi.fn();
const mockPruneWorktrees = vi.fn();
const mockListBranches = vi.fn();
const mockGetWorktreeDiskUsage = vi.fn();
const mockLockWorktree = vi.fn();
const mockUnlockWorktree = vi.fn();
const mockGetWorktreeDetails = vi.fn();
const mockListRegisteredRepos = vi.fn();
const mockAddRegisteredRepo = vi.fn();
const mockRemoveRegisteredRepo = vi.fn();
const mockDiscoverReposFromSessions = vi.fn();
const mockToggleRepoFavourite = vi.fn();

vi.mock("@tracepilot/client", () => ({
  listWorktrees: (...args: unknown[]) => mockListWorktrees(...args),
  createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
  removeWorktree: (...args: unknown[]) => mockRemoveWorktree(...args),
  pruneWorktrees: (...args: unknown[]) => mockPruneWorktrees(...args),
  listBranches: (...args: unknown[]) => mockListBranches(...args),
  getWorktreeDiskUsage: (...args: unknown[]) => mockGetWorktreeDiskUsage(...args),
  lockWorktree: (...args: unknown[]) => mockLockWorktree(...args),
  unlockWorktree: (...args: unknown[]) => mockUnlockWorktree(...args),
  getWorktreeDetails: (...args: unknown[]) => mockGetWorktreeDetails(...args),
  listRegisteredRepos: (...args: unknown[]) => mockListRegisteredRepos(...args),
  addRegisteredRepo: (...args: unknown[]) => mockAddRegisteredRepo(...args),
  removeRegisteredRepo: (...args: unknown[]) => mockRemoveRegisteredRepo(...args),
  discoverReposFromSessions: (...args: unknown[]) => mockDiscoverReposFromSessions(...args),
  toggleRepoFavourite: (...args: unknown[]) => mockToggleRepoFavourite(...args),
}));

// ── Mock logger ────────────────────────────────────────────────
const mockLogWarn = vi.fn();
vi.mock("@/utils/logger", () => ({
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
}));

// ── Fixtures ───────────────────────────────────────────────────
const REPO_PATH = "/home/user/repos/TracePilot";

const FIXTURE_MAIN_WT: WorktreeInfo = {
  path: REPO_PATH,
  branch: "main",
  headCommit: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  isMainWorktree: true,
  isBare: false,
  status: "active",
  isLocked: false,
  repoRoot: REPO_PATH,
  diskUsageBytes: 1024 * 1024 * 100,
};

const FIXTURE_FEATURE_WT: WorktreeInfo = {
  path: `${REPO_PATH}/.worktrees/feature-a`,
  branch: "feature-a",
  headCommit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  isMainWorktree: false,
  isBare: false,
  status: "active",
  isLocked: false,
  repoRoot: REPO_PATH,
  createdAt: "2026-03-27T10:00:00Z",
};

const FIXTURE_STALE_WT: WorktreeInfo = {
  path: `${REPO_PATH}/.worktrees/feature-b`,
  branch: "feature-b",
  headCommit: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
  isMainWorktree: false,
  isBare: false,
  status: "stale",
  isLocked: true,
  lockedReason: "CI running",
  repoRoot: REPO_PATH,
  createdAt: "2026-03-26T10:00:00Z",
};

const ALL_WORKTREES: WorktreeInfo[] = [FIXTURE_MAIN_WT, FIXTURE_FEATURE_WT, FIXTURE_STALE_WT];

const FIXTURE_REPO: RegisteredRepo = {
  path: REPO_PATH,
  name: "TracePilot",
  addedAt: "2026-03-20T10:00:00Z",
  source: "manual",
  favourite: true,
};

const FIXTURE_REPO_2: RegisteredRepo = {
  path: "/home/user/repos/OtherProject",
  name: "OtherProject",
  addedAt: "2026-03-22T14:00:00Z",
  source: "session-discovery",
  favourite: false,
};

// ── Helpers ────────────────────────────────────────────────────
function allMocks() {
  return [
    mockListWorktrees, mockCreateWorktree, mockRemoveWorktree,
    mockPruneWorktrees, mockListBranches, mockGetWorktreeDiskUsage,
    mockLockWorktree, mockUnlockWorktree, mockGetWorktreeDetails,
    mockListRegisteredRepos, mockAddRegisteredRepo, mockRemoveRegisteredRepo,
    mockDiscoverReposFromSessions, mockToggleRepoFavourite, mockLogWarn,
  ];
}

// ════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════
describe("useWorktreesStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    for (const mock of allMocks()) mock.mockReset();
    // Default: disk usage resolves immediately
    mockGetWorktreeDiskUsage.mockResolvedValue(0);
  });

  afterEach(async () => {
    // Drain fire-and-forget hydration promises to prevent cross-test leaks
    await flushPromises();
  });

  // ── Initialization ─────────────────────────────────────────
  describe("initialization", () => {
    it("starts with empty worktrees", () => {
      const store = useWorktreesStore();
      expect(store.worktrees).toEqual([]);
    });

    it("starts with empty branches", () => {
      const store = useWorktreesStore();
      expect(store.branches).toEqual([]);
    });

    it("starts with loading false", () => {
      const store = useWorktreesStore();
      expect(store.loading).toBe(false);
    });

    it("starts with no error", () => {
      const store = useWorktreesStore();
      expect(store.error).toBeNull();
    });

    it("starts with empty currentRepoPath", () => {
      const store = useWorktreesStore();
      expect(store.currentRepoPath).toBe("");
    });

    it("starts with empty registeredRepos", () => {
      const store = useWorktreesStore();
      expect(store.registeredRepos).toEqual([]);
    });

    it("defaults sortBy to branch", () => {
      const store = useWorktreesStore();
      expect(store.sortBy).toBe("branch");
    });

    it("defaults sortDirection to asc", () => {
      const store = useWorktreesStore();
      expect(store.sortDirection).toBe("asc");
    });
  });

  // ── loadWorktrees ──────────────────────────────────────────
  describe("loadWorktrees", () => {
    it("populates worktrees and sets currentRepoPath", async () => {
      mockListWorktrees.mockResolvedValue(ALL_WORKTREES);
      const store = useWorktreesStore();

      await store.loadWorktrees(REPO_PATH);

      expect(store.worktrees).toHaveLength(3);
      expect(store.currentRepoPath).toBe(REPO_PATH);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("sets loading to true during fetch", async () => {
      mockListWorktrees.mockResolvedValue([]);
      const store = useWorktreesStore();

      const promise = store.loadWorktrees(REPO_PATH);
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it("sets error on failure", async () => {
      mockListWorktrees.mockRejectedValue(new Error("git error"));
      const store = useWorktreesStore();

      await store.loadWorktrees(REPO_PATH);

      expect(store.error).toContain("git error");
      expect(store.loading).toBe(false);
    });

    it("hydrates disk usage asynchronously", async () => {
      mockListWorktrees.mockResolvedValue([FIXTURE_FEATURE_WT]);
      mockGetWorktreeDiskUsage.mockResolvedValue(5000);
      const store = useWorktreesStore();

      await store.loadWorktrees(REPO_PATH);
      await flushPromises();

      expect(mockGetWorktreeDiskUsage).toHaveBeenCalledWith(FIXTURE_FEATURE_WT.path);
      expect(store.worktrees[0].diskUsageBytes).toBe(5000);
    });

    it("disk usage failure does not set error (non-critical)", async () => {
      mockListWorktrees.mockResolvedValue([FIXTURE_FEATURE_WT]);
      mockGetWorktreeDiskUsage.mockRejectedValue(new Error("disk error"));
      const store = useWorktreesStore();

      await store.loadWorktrees(REPO_PATH);
      await flushPromises();

      expect(store.error).toBeNull();
      expect(mockLogWarn).toHaveBeenCalled();
    });

    it("discards stale response when newer load is in progress", async () => {
      // First call resolves after second call
      let resolveFirst: (v: WorktreeInfo[]) => void;
      const firstPromise = new Promise<WorktreeInfo[]>((resolve) => {
        resolveFirst = resolve;
      });
      mockListWorktrees
        .mockReturnValueOnce(firstPromise)
        .mockResolvedValueOnce([{ ...FIXTURE_STALE_WT }]);

      const store = useWorktreesStore();

      const call1 = store.loadWorktrees(REPO_PATH);
      const call2 = store.loadWorktrees(REPO_PATH); // invalidates first call's token

      // Resolve second call first
      await call2;
      await flushPromises();
      expect(store.worktrees).toHaveLength(1);
      expect(store.worktrees[0].branch).toBe("feature-b");

      // Now resolve first call — should be discarded
      resolveFirst!(ALL_WORKTREES.map((w) => ({ ...w })));
      await call1;
      await flushPromises();
      // Worktrees should still be from call2 (stale result discarded)
      expect(store.worktrees).toHaveLength(1);
      expect(store.worktrees[0].branch).toBe("feature-b");
    });

    it("discards stale disk-hydration when a newer load starts", async () => {
      // Disk usage resolves AFTER a second loadWorktrees call starts
      let resolveDiskUsage: (v: number) => void;
      const diskPromise = new Promise<number>((resolve) => {
        resolveDiskUsage = resolve;
      });

      mockListWorktrees
        .mockResolvedValueOnce([{ ...FIXTURE_FEATURE_WT }])
        .mockResolvedValueOnce([{ ...FIXTURE_STALE_WT }]);
      mockGetWorktreeDiskUsage
        .mockReturnValueOnce(diskPromise) // first load's hydration — delayed
        .mockResolvedValue(9999); // second load's hydration — immediate

      const store = useWorktreesStore();

      // First load starts — triggers hydration with delayed promise
      await store.loadWorktrees(REPO_PATH);

      // Second load starts — invalidates first load's guard token
      await store.loadWorktrees(REPO_PATH);
      await flushPromises();

      // Now resolve the first load's disk-usage promise
      resolveDiskUsage!(42000);
      await flushPromises();

      // The stale hydration (42000) should be discarded;
      // only the second load's worktrees should be present
      expect(store.worktrees).toHaveLength(1);
      expect(store.worktrees[0].branch).toBe("feature-b");
      // diskUsageBytes should be 9999 (from second load), not 42000 (stale)
      expect(store.worktrees[0].diskUsageBytes).toBe(9999);
    });
  });

  // ── loadAllWorktrees ───────────────────────────────────────
  describe("loadAllWorktrees", () => {
    it("loads worktrees from all registered repos", async () => {
      const store = useWorktreesStore();
      store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2];

      const repo1Wts = [FIXTURE_MAIN_WT, FIXTURE_FEATURE_WT];
      const repo2Wts: WorktreeInfo[] = [{
        ...FIXTURE_STALE_WT,
        repoRoot: FIXTURE_REPO_2.path,
        path: `${FIXTURE_REPO_2.path}/.worktrees/dev`,
      }];
      mockListWorktrees
        .mockResolvedValueOnce(repo1Wts)
        .mockResolvedValueOnce(repo2Wts);

      await store.loadAllWorktrees();

      expect(store.worktrees).toHaveLength(3);
      expect(store.loading).toBe(false);
    });

    it("skips repos that fail without setting error", async () => {
      const store = useWorktreesStore();
      store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2];

      mockListWorktrees
        .mockRejectedValueOnce(new Error("repo deleted"))
        .mockResolvedValueOnce([FIXTURE_FEATURE_WT]);

      await store.loadAllWorktrees();

      expect(store.worktrees).toHaveLength(1);
      expect(store.error).toBeNull();
      expect(mockLogWarn).toHaveBeenCalledWith(
        "[worktrees] Failed to load worktrees for repo",
        expect.objectContaining({ repo: FIXTURE_REPO.path }),
      );
    });

    it("hydrates disk usage for all worktrees", async () => {
      const store = useWorktreesStore();
      store.registeredRepos = [FIXTURE_REPO];
      mockListWorktrees.mockResolvedValue([FIXTURE_MAIN_WT, FIXTURE_FEATURE_WT]);
      mockGetWorktreeDiskUsage.mockResolvedValue(9999);

      await store.loadAllWorktrees();
      await flushPromises();

      expect(mockGetWorktreeDiskUsage).toHaveBeenCalledTimes(2);
    });

    it("returns empty worktrees when all repos fail individually", async () => {
      mockListWorktrees.mockRejectedValue(new Error("network error"));
      const store = useWorktreesStore();
      // Need at least one repo to trigger the loop
      store.registeredRepos = [FIXTURE_REPO];

      await store.loadAllWorktrees();

      // Individual repo errors are caught by inner try/catch (logWarn),
      // so error.value stays null — worktrees is just empty
      expect(store.worktrees).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("discards results when a newer loadAllWorktrees call starts", async () => {
      let resolveFirst: (v: WorktreeInfo[]) => void;
      const firstPromise = new Promise<WorktreeInfo[]>((resolve) => {
        resolveFirst = resolve;
      });

      const store = useWorktreesStore();
      store.registeredRepos = [FIXTURE_REPO];

      mockListWorktrees
        .mockReturnValueOnce(firstPromise)
        .mockResolvedValueOnce([{ ...FIXTURE_STALE_WT }]);

      const call1 = store.loadAllWorktrees();
      const call2 = store.loadAllWorktrees(); // invalidates first call

      await call2;
      await flushPromises();
      expect(store.worktrees).toHaveLength(1);
      expect(store.worktrees[0].branch).toBe("feature-b");

      resolveFirst!([{ ...FIXTURE_MAIN_WT }, { ...FIXTURE_FEATURE_WT }]);
      await call1;
      await flushPromises();
      // First call's results should be discarded
      expect(store.worktrees).toHaveLength(1);
      expect(store.worktrees[0].branch).toBe("feature-b");
    });
  });

  // ── loadBranches ───────────────────────────────────────────
  describe("loadBranches", () => {
    it("populates branches on success", async () => {
      mockListBranches.mockResolvedValue(["main", "feature-a", "feature-b"]);
      const store = useWorktreesStore();

      await store.loadBranches(REPO_PATH);

      expect(store.branches).toEqual(["main", "feature-a", "feature-b"]);
    });

    it("resets branches to empty on failure (non-critical)", async () => {
      mockListBranches.mockRejectedValue(new Error("branch error"));
      const store = useWorktreesStore();
      store.branches = ["old-branch"];

      await store.loadBranches(REPO_PATH);

      expect(store.branches).toEqual([]);
      expect(store.error).toBeNull();
      expect(mockLogWarn).toHaveBeenCalled();
    });

    it("uses independent guard from loadWorktrees", async () => {
      // loadBranches should not be invalidated by loadWorktrees
      let resolveBranches: (v: string[]) => void;
      const branchPromise = new Promise<string[]>((resolve) => {
        resolveBranches = resolve;
      });
      mockListBranches.mockReturnValueOnce(branchPromise);
      mockListWorktrees.mockResolvedValue(ALL_WORKTREES);

      const store = useWorktreesStore();

      const branchCall = store.loadBranches(REPO_PATH);
      // loadWorktrees starts — this should NOT invalidate branchGuard
      await store.loadWorktrees(REPO_PATH);

      resolveBranches!(["main", "dev"]);
      await branchCall;

      // Branches should still be populated (not discarded)
      expect(store.branches).toEqual(["main", "dev"]);
    });
  });

  // ── addWorktree ────────────────────────────────────────────
  describe("addWorktree", () => {
    it("appends new worktree and returns it", async () => {
      const newWt: WorktreeInfo = {
        ...FIXTURE_FEATURE_WT,
        branch: "feature-new",
        path: `${REPO_PATH}/.worktrees/feature-new`,
      };
      mockCreateWorktree.mockResolvedValue(newWt);
      const store = useWorktreesStore();
      store.worktrees = [FIXTURE_MAIN_WT];

      const result = await store.addWorktree({
        repoPath: REPO_PATH,
        branch: "feature-new",
      } as CreateWorktreeRequest);

      expect(result).toEqual(newWt);
      expect(store.worktrees).toHaveLength(2);
      expect(store.error).toBeNull();
    });

    it("sets error and returns null on failure", async () => {
      mockCreateWorktree.mockRejectedValue(new Error("branch exists"));
      const store = useWorktreesStore();

      const result = await store.addWorktree({
        repoPath: REPO_PATH,
        branch: "existing",
      } as CreateWorktreeRequest);

      expect(result).toBeNull();
      expect(store.error).toContain("branch exists");
    });
  });

  // ── deleteWorktree ─────────────────────────────────────────
  describe("deleteWorktree", () => {
    it("removes worktree from list on success", async () => {
      mockRemoveWorktree.mockResolvedValue(undefined);
      const store = useWorktreesStore();
      store.worktrees = [FIXTURE_MAIN_WT, FIXTURE_FEATURE_WT];

      const result = await store.deleteWorktree(FIXTURE_FEATURE_WT.path, false, REPO_PATH);

      expect(result).toBe(true);
      expect(store.worktrees).toHaveLength(1);
      expect(store.worktrees[0].branch).toBe("main");
    });

    it("uses currentRepoPath when repoPath not provided", async () => {
      mockRemoveWorktree.mockResolvedValue(undefined);
      const store = useWorktreesStore();
      store.currentRepoPath = REPO_PATH;
      store.worktrees = [FIXTURE_FEATURE_WT];

      await store.deleteWorktree(FIXTURE_FEATURE_WT.path);

      expect(mockRemoveWorktree).toHaveBeenCalledWith(
        REPO_PATH,
        FIXTURE_FEATURE_WT.path,
        false,
      );
    });

    it("sets error and returns false on failure", async () => {
      mockRemoveWorktree.mockRejectedValue(new Error("in use"));
      const store = useWorktreesStore();

      const result = await store.deleteWorktree("/some/path", false, REPO_PATH);

      expect(result).toBe(false);
      expect(store.error).toContain("in use");
    });
  });

  // ── prune ──────────────────────────────────────────────────
  describe("prune", () => {
    it("reloads worktrees when prunedCount > 0", async () => {
      const pruneResult: PruneResult = { prunedCount: 2, messages: ["pruned feature-a"] };
      mockPruneWorktrees.mockResolvedValue(pruneResult);
      mockListWorktrees.mockResolvedValue([FIXTURE_MAIN_WT]);
      const store = useWorktreesStore();
      store.currentRepoPath = REPO_PATH;

      const result = await store.prune();

      expect(result).toEqual(pruneResult);
      expect(mockListWorktrees).toHaveBeenCalled();
    });

    it("does NOT reload worktrees when prunedCount is 0", async () => {
      const pruneResult: PruneResult = { prunedCount: 0, messages: [] };
      mockPruneWorktrees.mockResolvedValue(pruneResult);
      const store = useWorktreesStore();
      store.currentRepoPath = REPO_PATH;

      const result = await store.prune();

      expect(result).toEqual(pruneResult);
      expect(mockListWorktrees).not.toHaveBeenCalled();
    });

    it("uses currentRepoPath when repoPath not provided", async () => {
      mockPruneWorktrees.mockResolvedValue({ prunedCount: 0, messages: [] });
      const store = useWorktreesStore();
      store.currentRepoPath = REPO_PATH;

      await store.prune();

      expect(mockPruneWorktrees).toHaveBeenCalledWith(REPO_PATH);
    });

    it("uses explicit repoPath when provided", async () => {
      mockPruneWorktrees.mockResolvedValue({ prunedCount: 0, messages: [] });
      const store = useWorktreesStore();
      store.currentRepoPath = "/other/path";

      await store.prune(REPO_PATH);

      expect(mockPruneWorktrees).toHaveBeenCalledWith(REPO_PATH);
    });

    it("sets error and returns null on failure", async () => {
      mockPruneWorktrees.mockRejectedValue(new Error("prune failed"));
      const store = useWorktreesStore();
      store.currentRepoPath = REPO_PATH;

      const result = await store.prune();

      expect(result).toBeNull();
      expect(store.error).toContain("prune failed");
    });
  });

  // ── lockWorktree ───────────────────────────────────────────
  describe("lockWorktree", () => {
    it("updates worktree to locked state", async () => {
      mockLockWorktree.mockResolvedValue(undefined);
      const store = useWorktreesStore();
      store.worktrees = [{ ...FIXTURE_FEATURE_WT }];

      const result = await store.lockWorktree(FIXTURE_FEATURE_WT.path, "CI", REPO_PATH);

      expect(result).toBe(true);
      expect(store.worktrees[0].isLocked).toBe(true);
      expect(store.worktrees[0].lockedReason).toBe("CI");
    });

    it("uses currentRepoPath when repoPath not provided", async () => {
      mockLockWorktree.mockResolvedValue(undefined);
      const store = useWorktreesStore();
      store.currentRepoPath = REPO_PATH;
      store.worktrees = [{ ...FIXTURE_FEATURE_WT }];

      await store.lockWorktree(FIXTURE_FEATURE_WT.path, "test");

      expect(mockLockWorktree).toHaveBeenCalledWith(
        REPO_PATH,
        FIXTURE_FEATURE_WT.path,
        "test",
      );
    });

    it("sets error and returns false on failure", async () => {
      mockLockWorktree.mockRejectedValue(new Error("lock error"));
      const store = useWorktreesStore();

      const result = await store.lockWorktree("/some/path", "reason", REPO_PATH);

      expect(result).toBe(false);
      expect(store.error).toContain("lock error");
    });
  });

  // ── unlockWorktree ─────────────────────────────────────────
  describe("unlockWorktree", () => {
    it("updates worktree to unlocked state", async () => {
      mockUnlockWorktree.mockResolvedValue(undefined);
      const store = useWorktreesStore();
      store.worktrees = [{ ...FIXTURE_STALE_WT }];

      const result = await store.unlockWorktree(FIXTURE_STALE_WT.path, REPO_PATH);

      expect(result).toBe(true);
      expect(store.worktrees[0].isLocked).toBe(false);
      expect(store.worktrees[0].lockedReason).toBeUndefined();
    });

    it("uses currentRepoPath when repoPath not provided", async () => {
      mockUnlockWorktree.mockResolvedValue(undefined);
      const store = useWorktreesStore();
      store.currentRepoPath = REPO_PATH;
      store.worktrees = [{ ...FIXTURE_STALE_WT }];

      await store.unlockWorktree(FIXTURE_STALE_WT.path);

      expect(mockUnlockWorktree).toHaveBeenCalledWith(
        REPO_PATH,
        FIXTURE_STALE_WT.path,
      );
    });

    it("sets error and returns false on failure", async () => {
      mockUnlockWorktree.mockRejectedValue(new Error("unlock error"));
      const store = useWorktreesStore();

      const result = await store.unlockWorktree("/some/path", REPO_PATH);

      expect(result).toBe(false);
      expect(store.error).toContain("unlock error");
    });
  });

  // ── fetchWorktreeDetails ───────────────────────────────────
  describe("fetchWorktreeDetails", () => {
    it("returns details on success", async () => {
      const details: WorktreeDetails = {
        path: FIXTURE_FEATURE_WT.path,
        uncommittedCount: 3,
        ahead: 2,
        behind: 0,
      };
      mockGetWorktreeDetails.mockResolvedValue(details);
      const store = useWorktreesStore();

      const result = await store.fetchWorktreeDetails(FIXTURE_FEATURE_WT.path);

      expect(result).toEqual(details);
    });

    it("returns null and logs warning on failure (non-critical)", async () => {
      mockGetWorktreeDetails.mockRejectedValue(new Error("details error"));
      const store = useWorktreesStore();

      const result = await store.fetchWorktreeDetails("/some/path");

      expect(result).toBeNull();
      expect(store.error).toBeNull();
      expect(mockLogWarn).toHaveBeenCalled();
    });
  });

  // ── hydrateDiskUsage ───────────────────────────────────────
  describe("hydrateDiskUsage", () => {
    it("updates diskUsageBytes for a known worktree", async () => {
      mockGetWorktreeDiskUsage.mockResolvedValue(42000);
      const store = useWorktreesStore();
      store.worktrees = [{ ...FIXTURE_FEATURE_WT }];

      store.hydrateDiskUsage(FIXTURE_FEATURE_WT.path);
      await flushPromises();

      expect(store.worktrees[0].diskUsageBytes).toBe(42000);
    });

    it("does not call API for unknown path", async () => {
      const store = useWorktreesStore();
      store.worktrees = [{ ...FIXTURE_FEATURE_WT }];

      store.hydrateDiskUsage("/nonexistent/path");
      await flushPromises();

      expect(mockGetWorktreeDiskUsage).not.toHaveBeenCalled();
    });

    it("logs warning on API failure (non-critical)", async () => {
      mockGetWorktreeDiskUsage.mockRejectedValue(new Error("disk error"));
      const store = useWorktreesStore();
      store.worktrees = [{ ...FIXTURE_FEATURE_WT }];

      store.hydrateDiskUsage(FIXTURE_FEATURE_WT.path);
      await flushPromises();

      expect(store.error).toBeNull();
      expect(mockLogWarn).toHaveBeenCalled();
    });
  });

  // ── Computed properties ────────────────────────────────────
  describe("computed properties", () => {
    // Use fresh copies to avoid reactive proxy interference from other tests
    function freshAllWorktrees() {
      return ALL_WORKTREES.map((w) => ({ ...w }));
    }

    it("mainWorktree returns the main worktree", () => {
      const store = useWorktreesStore();
      store.worktrees = freshAllWorktrees();

      expect(store.mainWorktree?.branch).toBe("main");
      expect(store.mainWorktree?.isMainWorktree).toBe(true);
    });

    it("mainWorktree is undefined when no main worktree exists", () => {
      const store = useWorktreesStore();
      store.worktrees = [{ ...FIXTURE_FEATURE_WT }];

      expect(store.mainWorktree).toBeUndefined();
    });

    it("secondaryWorktrees excludes main worktree", () => {
      const store = useWorktreesStore();
      store.worktrees = freshAllWorktrees();

      expect(store.secondaryWorktrees).toHaveLength(2);
      expect(store.secondaryWorktrees.every((w) => !w.isMainWorktree)).toBe(true);
    });

    it("worktreeCount returns total count", () => {
      const store = useWorktreesStore();
      store.worktrees = freshAllWorktrees();

      expect(store.worktreeCount).toBe(3);
    });

    it("activeCount counts active worktrees", () => {
      const store = useWorktreesStore();
      store.worktrees = freshAllWorktrees();

      // FIXTURE_MAIN_WT (active) + FIXTURE_FEATURE_WT (active)
      expect(store.activeCount).toBe(2);
    });

    it("staleCount counts stale worktrees", () => {
      const store = useWorktreesStore();
      store.worktrees = freshAllWorktrees();

      // FIXTURE_STALE_WT (stale)
      expect(store.staleCount).toBe(1);
    });

    it("lockedCount counts locked worktrees", () => {
      const store = useWorktreesStore();
      store.worktrees = freshAllWorktrees();

      // FIXTURE_STALE_WT (locked)
      expect(store.lockedCount).toBe(1);
    });

    it("sortedWorktrees sorts by branch ascending by default", () => {
      const store = useWorktreesStore();
      store.worktrees = freshAllWorktrees();

      const sorted = store.sortedWorktrees;
      const branches = sorted.map((w) => w.branch);
      expect(branches).toEqual(["feature-a", "feature-b", "main"]);
    });

    it("sortedWorktrees respects sortDirection", () => {
      const store = useWorktreesStore();
      store.worktrees = freshAllWorktrees();
      store.sortDirection = "desc";

      const branches = store.sortedWorktrees.map((w) => w.branch);
      expect(branches).toEqual(["main", "feature-b", "feature-a"]);
    });

    it("sortedWorktrees can sort by status", () => {
      const store = useWorktreesStore();
      store.worktrees = freshAllWorktrees();
      store.sortBy = "status";

      const statuses = store.sortedWorktrees.map((w) => w.status);
      expect(statuses).toEqual(["active", "active", "stale"]);
    });

    it("sortedWorktrees can sort by diskUsageBytes", () => {
      const store = useWorktreesStore();
      store.worktrees = [
        { ...FIXTURE_FEATURE_WT, diskUsageBytes: 500 },
        { ...FIXTURE_MAIN_WT, diskUsageBytes: 1000 },
        { ...FIXTURE_STALE_WT, diskUsageBytes: undefined },
      ];
      store.sortBy = "diskUsageBytes";

      const sizes = store.sortedWorktrees.map((w) => w.diskUsageBytes ?? 0);
      expect(sizes).toEqual([0, 500, 1000]);
    });
  });

  // ── Repository Registry ────────────────────────────────────
  describe("repository registry", () => {
    describe("loadRegisteredRepos", () => {
      it("populates registeredRepos", async () => {
        mockListRegisteredRepos.mockResolvedValue([FIXTURE_REPO, FIXTURE_REPO_2]);
        const store = useWorktreesStore();

        await store.loadRegisteredRepos();

        expect(store.registeredRepos).toHaveLength(2);
        expect(store.reposLoading).toBe(false);
      });

      it("sets reposLoading during fetch", async () => {
        mockListRegisteredRepos.mockResolvedValue([]);
        const store = useWorktreesStore();

        const promise = store.loadRegisteredRepos();
        expect(store.reposLoading).toBe(true);
        await promise;
        expect(store.reposLoading).toBe(false);
      });

      it("sets error on failure", async () => {
        mockListRegisteredRepos.mockRejectedValue(new Error("registry error"));
        const store = useWorktreesStore();

        await store.loadRegisteredRepos();

        expect(store.error).toContain("registry error");
        expect(store.reposLoading).toBe(false);
      });
    });

    describe("addRepo", () => {
      it("adds repo and refreshes list", async () => {
        const newRepo: RegisteredRepo = {
          ...FIXTURE_REPO,
          path: "/new/repo",
          name: "NewRepo",
        };
        mockAddRegisteredRepo.mockResolvedValue(newRepo);
        mockListRegisteredRepos.mockResolvedValue([FIXTURE_REPO, newRepo]);
        const store = useWorktreesStore();

        const result = await store.addRepo("/new/repo");

        expect(result).toEqual(newRepo);
        // Should have refreshed the list via loadRegisteredRepos
        expect(mockListRegisteredRepos).toHaveBeenCalled();
        expect(store.registeredRepos).toHaveLength(2);
      });

      it("sets error and returns null on failure", async () => {
        mockAddRegisteredRepo.mockRejectedValue(new Error("add error"));
        const store = useWorktreesStore();

        const result = await store.addRepo("/bad/path");

        expect(result).toBeNull();
        expect(store.error).toContain("add error");
      });
    });

    describe("removeRepo", () => {
      it("removes repo from list", async () => {
        mockRemoveRegisteredRepo.mockResolvedValue(undefined);
        const store = useWorktreesStore();
        store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2];

        const result = await store.removeRepo(FIXTURE_REPO.path);

        expect(result).toBe(true);
        expect(store.registeredRepos).toHaveLength(1);
        expect(store.registeredRepos[0].name).toBe("OtherProject");
      });

      it("cascades worktree removal for the removed repo", async () => {
        mockRemoveRegisteredRepo.mockResolvedValue(undefined);
        const store = useWorktreesStore();
        store.registeredRepos = [FIXTURE_REPO];
        store.worktrees = [FIXTURE_MAIN_WT, FIXTURE_FEATURE_WT]; // both repoRoot === REPO_PATH

        await store.removeRepo(REPO_PATH);

        // Both worktrees should be removed since they belong to the removed repo
        expect(store.worktrees).toHaveLength(0);
      });

      it("does not remove worktrees from other repos", async () => {
        mockRemoveRegisteredRepo.mockResolvedValue(undefined);
        const otherWt: WorktreeInfo = {
          ...FIXTURE_FEATURE_WT,
          repoRoot: FIXTURE_REPO_2.path,
          path: `${FIXTURE_REPO_2.path}/.worktrees/dev`,
        };
        const store = useWorktreesStore();
        store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2];
        store.worktrees = [FIXTURE_MAIN_WT, otherWt];

        await store.removeRepo(REPO_PATH);

        expect(store.worktrees).toHaveLength(1);
        expect(store.worktrees[0].repoRoot).toBe(FIXTURE_REPO_2.path);
      });

      it("sets error and returns false on failure", async () => {
        mockRemoveRegisteredRepo.mockRejectedValue(new Error("remove error"));
        const store = useWorktreesStore();

        const result = await store.removeRepo("/some/path");

        expect(result).toBe(false);
        expect(store.error).toContain("remove error");
      });
    });

    describe("discoverRepos", () => {
      it("refreshes list when new repos discovered", async () => {
        const newRepo: RegisteredRepo = { ...FIXTURE_REPO_2 };
        mockDiscoverReposFromSessions.mockResolvedValue([newRepo]);
        mockListRegisteredRepos.mockResolvedValue([FIXTURE_REPO, newRepo]);
        const store = useWorktreesStore();

        const result = await store.discoverRepos();

        expect(result).toHaveLength(1);
        expect(mockListRegisteredRepos).toHaveBeenCalled();
      });

      it("does NOT refresh list when no repos discovered", async () => {
        mockDiscoverReposFromSessions.mockResolvedValue([]);
        const store = useWorktreesStore();

        const result = await store.discoverRepos();

        expect(result).toEqual([]);
        expect(mockListRegisteredRepos).not.toHaveBeenCalled();
      });

      it("sets error and returns empty on failure", async () => {
        mockDiscoverReposFromSessions.mockRejectedValue(new Error("discover error"));
        const store = useWorktreesStore();

        const result = await store.discoverRepos();

        expect(result).toEqual([]);
        expect(store.error).toContain("discover error");
      });
    });

    describe("toggleFavourite", () => {
      it("toggles favourite state on repo", async () => {
        mockToggleRepoFavourite.mockResolvedValue(false);
        const store = useWorktreesStore();
        store.registeredRepos = [{ ...FIXTURE_REPO, favourite: true }];

        await store.toggleFavourite(FIXTURE_REPO.path);

        expect(store.registeredRepos[0].favourite).toBe(false);
      });

      it("prevents concurrent toggle for the same path", async () => {
        let resolveToggle: (v: boolean) => void;
        const togglePromise = new Promise<boolean>((resolve) => {
          resolveToggle = resolve;
        });
        mockToggleRepoFavourite.mockReturnValue(togglePromise);
        const store = useWorktreesStore();
        store.registeredRepos = [{ ...FIXTURE_REPO }];

        // First toggle starts
        const call1 = store.toggleFavourite(FIXTURE_REPO.path);
        expect(store.togglingFavourites.has(FIXTURE_REPO.path)).toBe(true);

        // Second toggle for same path should be a no-op
        const call2 = store.toggleFavourite(FIXTURE_REPO.path);

        resolveToggle!(false);
        await call1;
        await call2;

        // Should only have been called once
        expect(mockToggleRepoFavourite).toHaveBeenCalledTimes(1);
        expect(store.togglingFavourites.has(FIXTURE_REPO.path)).toBe(false);
      });

      it("sets error on failure", async () => {
        mockToggleRepoFavourite.mockRejectedValue(new Error("toggle error"));
        const store = useWorktreesStore();
        store.registeredRepos = [{ ...FIXTURE_REPO }];

        await store.toggleFavourite(FIXTURE_REPO.path);

        expect(store.error).toContain("toggle error");
        expect(store.togglingFavourites.has(FIXTURE_REPO.path)).toBe(false);
      });
    });

    describe("sortedRegisteredRepos", () => {
      it("sorts favourites first, then alphabetically", () => {
        const store = useWorktreesStore();
        store.registeredRepos = [
          { ...FIXTURE_REPO_2, favourite: false, name: "Zebra" },
          { ...FIXTURE_REPO, favourite: true, name: "Alpha" },
          { ...FIXTURE_REPO, path: "/c", favourite: false, name: "Charlie" },
        ];

        const names = store.sortedRegisteredRepos.map((r) => r.name);
        expect(names).toEqual(["Alpha", "Charlie", "Zebra"]);
      });
    });
  });

  // ── setSortBy ──────────────────────────────────────────────
  describe("setSortBy", () => {
    it("sets new sort field with asc direction", () => {
      const store = useWorktreesStore();
      store.setSortBy("status");

      expect(store.sortBy).toBe("status");
      expect(store.sortDirection).toBe("asc");
    });

    it("toggles direction when clicking same field", () => {
      const store = useWorktreesStore();
      expect(store.sortBy).toBe("branch");
      expect(store.sortDirection).toBe("asc");

      store.setSortBy("branch");
      expect(store.sortDirection).toBe("desc");

      store.setSortBy("branch");
      expect(store.sortDirection).toBe("asc");
    });

    it("resets direction when switching fields", () => {
      const store = useWorktreesStore();
      store.setSortBy("branch"); // toggle to desc
      expect(store.sortDirection).toBe("desc");

      store.setSortBy("status"); // switch field → resets to asc
      expect(store.sortDirection).toBe("asc");
    });
  });
});
