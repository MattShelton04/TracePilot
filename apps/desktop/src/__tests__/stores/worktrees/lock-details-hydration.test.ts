// biome-ignore assist/source/organizeImports: setup must register mocks before the store import.
import type { WorktreeDetails } from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_FEATURE_WT,
  FIXTURE_STALE_WT,
  mocks,
  REPO_PATH,
  setupWorktreesStoreTest,
} from "./setup";
import { useWorktreesStore } from "../../../stores/worktrees";

setupWorktreesStoreTest();

describe("useWorktreesStore lockWorktree", () => {
  it("updates worktree to locked state", async () => {
    mocks.lockWorktree.mockResolvedValue(undefined);
    const store = useWorktreesStore();
    store.worktrees = [{ ...FIXTURE_FEATURE_WT }];

    const result = await store.lockWorktree(FIXTURE_FEATURE_WT.path, "CI", REPO_PATH);

    expect(result).toBe(true);
    expect(store.worktrees[0].isLocked).toBe(true);
    expect(store.worktrees[0].lockedReason).toBe("CI");
  });

  it("uses currentRepoPath when repoPath not provided", async () => {
    mocks.lockWorktree.mockResolvedValue(undefined);
    const store = useWorktreesStore();
    store.currentRepoPath = REPO_PATH;
    store.worktrees = [{ ...FIXTURE_FEATURE_WT }];

    await store.lockWorktree(FIXTURE_FEATURE_WT.path, "test");

    expect(mocks.lockWorktree).toHaveBeenCalledWith(REPO_PATH, FIXTURE_FEATURE_WT.path, "test");
  });

  it("sets error and returns false on failure", async () => {
    mocks.lockWorktree.mockRejectedValue(new Error("lock error"));
    const store = useWorktreesStore();

    const result = await store.lockWorktree("/some/path", "reason", REPO_PATH);

    expect(result).toBe(false);
    expect(store.error).toContain("lock error");
  });
});

describe("useWorktreesStore unlockWorktree", () => {
  it("updates worktree to unlocked state", async () => {
    mocks.unlockWorktree.mockResolvedValue(undefined);
    const store = useWorktreesStore();
    store.worktrees = [{ ...FIXTURE_STALE_WT }];

    const result = await store.unlockWorktree(FIXTURE_STALE_WT.path, REPO_PATH);

    expect(result).toBe(true);
    expect(store.worktrees[0].isLocked).toBe(false);
    expect(store.worktrees[0].lockedReason).toBeUndefined();
  });

  it("uses currentRepoPath when repoPath not provided", async () => {
    mocks.unlockWorktree.mockResolvedValue(undefined);
    const store = useWorktreesStore();
    store.currentRepoPath = REPO_PATH;
    store.worktrees = [{ ...FIXTURE_STALE_WT }];

    await store.unlockWorktree(FIXTURE_STALE_WT.path);

    expect(mocks.unlockWorktree).toHaveBeenCalledWith(REPO_PATH, FIXTURE_STALE_WT.path);
  });

  it("sets error and returns false on failure", async () => {
    mocks.unlockWorktree.mockRejectedValue(new Error("unlock error"));
    const store = useWorktreesStore();

    const result = await store.unlockWorktree("/some/path", REPO_PATH);

    expect(result).toBe(false);
    expect(store.error).toContain("unlock error");
  });
});

describe("useWorktreesStore fetchWorktreeDetails", () => {
  it("returns details on success", async () => {
    const details: WorktreeDetails = {
      path: FIXTURE_FEATURE_WT.path,
      uncommittedCount: 3,
      ahead: 2,
      behind: 0,
    };
    mocks.getWorktreeDetails.mockResolvedValue(details);
    const store = useWorktreesStore();

    const result = await store.fetchWorktreeDetails(FIXTURE_FEATURE_WT.path);

    expect(result).toEqual(details);
  });

  it("returns null and logs warning on failure (non-critical)", async () => {
    mocks.getWorktreeDetails.mockRejectedValue(new Error("details error"));
    const store = useWorktreesStore();

    const result = await store.fetchWorktreeDetails("/some/path");

    expect(result).toBeNull();
    expect(store.error).toBeNull();
    expect(mocks.logWarn).toHaveBeenCalled();
  });
});

describe("useWorktreesStore hydrateDiskUsage", () => {
  it("updates diskUsageBytes for a known worktree", async () => {
    mocks.getWorktreeDiskUsage.mockResolvedValue(42000);
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

    expect(mocks.getWorktreeDiskUsage).not.toHaveBeenCalled();
  });

  it("logs warning on API failure (non-critical)", async () => {
    mocks.getWorktreeDiskUsage.mockRejectedValue(new Error("disk error"));
    const store = useWorktreesStore();
    store.worktrees = [{ ...FIXTURE_FEATURE_WT }];

    store.hydrateDiskUsage(FIXTURE_FEATURE_WT.path);
    await flushPromises();

    expect(store.error).toBeNull();
    expect(mocks.logWarn).toHaveBeenCalled();
  });
});
