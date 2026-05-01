// biome-ignore assist/source/organizeImports: setup must register mocks before the store import.
import type { WorktreeInfo } from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import {
  ALL_WORKTREES,
  createDeferred,
  FIXTURE_FEATURE_WT,
  mocks,
  REPO_PATH,
  setupWorktreesStoreTest,
} from "./setup";
import { useWorktreesStore } from "../../../stores/worktrees";

setupWorktreesStoreTest();

describe("useWorktreesStore hydrateDiskUsageBatch concurrency", () => {
  it("limits concurrent disk-usage calls", async () => {
    const store = useWorktreesStore();
    // Create 6 worktrees to force multiple batches (batch size = 4)
    const worktreeItems: WorktreeInfo[] = Array.from({ length: 6 }, (_, i) => ({
      ...FIXTURE_FEATURE_WT,
      path: `/repo/.worktrees/wt-${i}`,
      branch: `branch-${i}`,
    }));
    store.worktrees = [...worktreeItems];

    let inFlight = 0;
    let maxInFlight = 0;
    const deferreds: Array<{ resolve: (v: number) => void }> = [];
    mocks.getWorktreeDiskUsage.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          deferreds.push({
            resolve: (v: number) => {
              inFlight--;
              resolve(v);
            },
          });
        }),
    );

    mocks.listWorktrees.mockResolvedValue(worktreeItems);
    const p = store.loadWorktrees(REPO_PATH);
    await flushPromises();

    // First batch of 4 should be in-flight
    expect(deferreds).toHaveLength(4);
    expect(maxInFlight).toBe(4);

    // Resolve first batch
    deferreds.forEach((d) => {
      d.resolve(1000);
    });
    await flushPromises();

    // Second batch of 2 should now be in-flight
    expect(deferreds).toHaveLength(6);
    expect(maxInFlight).toBe(4); // never exceeded 4

    // Resolve second batch
    deferreds.slice(4).forEach((d) => {
      d.resolve(2000);
    });
    await p;
    await flushPromises();

    expect(mocks.getWorktreeDiskUsage).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("stops hydration when guard is invalidated between batches", async () => {
    const store = useWorktreesStore();
    // 6 worktrees = 2 batches of 4+2; invalidate before second batch
    const worktreeItems: WorktreeInfo[] = Array.from({ length: 6 }, (_, i) => ({
      ...FIXTURE_FEATURE_WT,
      path: `/repo/.worktrees/wt-${i}`,
      branch: `branch-${i}`,
    }));

    let callCount = 0;
    mocks.getWorktreeDiskUsage.mockImplementation(() => {
      callCount++;
      // After the first batch completes, trigger a new loadWorktrees
      // which invalidates the old guard token
      if (callCount === 4) {
        // Schedule a new load that will invalidate the old guard
        mocks.listWorktrees.mockResolvedValueOnce([]);
        store.loadWorktrees(REPO_PATH);
      }
      return Promise.resolve(500);
    });

    mocks.listWorktrees.mockResolvedValueOnce(worktreeItems);
    await store.loadWorktrees(REPO_PATH);
    await flushPromises();

    // First batch (4) should complete; second batch should be abandoned
    // because loadWorktrees was called again, invalidating the guard
    expect(callCount).toBeLessThanOrEqual(4);
  });
});

describe("useWorktreesStore loadBranches", () => {
  it("populates branches on success", async () => {
    mocks.listBranches.mockResolvedValue(["main", "feature-a", "feature-b"]);
    const store = useWorktreesStore();

    await store.loadBranches(REPO_PATH);

    expect(store.branches).toEqual(["main", "feature-a", "feature-b"]);
  });

  it("resets branches to empty on failure (non-critical)", async () => {
    mocks.listBranches.mockRejectedValue(new Error("branch error"));
    const store = useWorktreesStore();
    store.branches = ["old-branch"];

    await store.loadBranches(REPO_PATH);

    expect(store.branches).toEqual([]);
    expect(store.error).toBeNull();
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it("uses independent guard from loadWorktrees", async () => {
    // loadBranches should not be invalidated by loadWorktrees
    const branchesDeferred = createDeferred<string[]>();
    mocks.listBranches.mockReturnValueOnce(branchesDeferred.promise);
    mocks.listWorktrees.mockResolvedValue(ALL_WORKTREES);

    const store = useWorktreesStore();

    const branchCall = store.loadBranches(REPO_PATH);
    // loadWorktrees starts — this should NOT invalidate branchGuard
    await store.loadWorktrees(REPO_PATH);

    branchesDeferred.resolve(["main", "dev"]);
    await branchCall;

    // Branches should still be populated (not discarded)
    expect(store.branches).toEqual(["main", "dev"]);
  });
});
