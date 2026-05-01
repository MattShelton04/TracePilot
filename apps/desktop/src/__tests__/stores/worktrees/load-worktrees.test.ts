// biome-ignore assist/source/organizeImports: setup must register mocks before the store import.
import type { WorktreeInfo } from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import {
  ALL_WORKTREES,
  createDeferred,
  FIXTURE_FEATURE_WT,
  FIXTURE_STALE_WT,
  mocks,
  REPO_PATH,
  setupWorktreesStoreTest,
} from "./setup";
import { useWorktreesStore } from "../../../stores/worktrees";

setupWorktreesStoreTest();

describe("useWorktreesStore loadWorktrees", () => {
  it("populates worktrees and sets currentRepoPath", async () => {
    mocks.listWorktrees.mockResolvedValue(ALL_WORKTREES);
    const store = useWorktreesStore();

    await store.loadWorktrees(REPO_PATH);

    expect(store.worktrees).toHaveLength(3);
    expect(store.currentRepoPath).toBe(REPO_PATH);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it("sets loading to true during fetch", async () => {
    mocks.listWorktrees.mockResolvedValue([]);
    const store = useWorktreesStore();

    const promise = store.loadWorktrees(REPO_PATH);
    expect(store.loading).toBe(true);
    await promise;
    expect(store.loading).toBe(false);
  });

  it("sets error on failure", async () => {
    mocks.listWorktrees.mockRejectedValue(new Error("git error"));
    const store = useWorktreesStore();

    await store.loadWorktrees(REPO_PATH);

    expect(store.error).toContain("git error");
    expect(store.loading).toBe(false);
  });

  it("hydrates disk usage asynchronously", async () => {
    mocks.listWorktrees.mockResolvedValue([FIXTURE_FEATURE_WT]);
    mocks.getWorktreeDiskUsage.mockResolvedValue(5000);
    const store = useWorktreesStore();

    await store.loadWorktrees(REPO_PATH);
    await flushPromises();

    expect(mocks.getWorktreeDiskUsage).toHaveBeenCalledWith(FIXTURE_FEATURE_WT.path);
    expect(store.worktrees[0].diskUsageBytes).toBe(5000);
  });

  it("disk usage failure does not set error (non-critical)", async () => {
    mocks.listWorktrees.mockResolvedValue([FIXTURE_FEATURE_WT]);
    mocks.getWorktreeDiskUsage.mockRejectedValue(new Error("disk error"));
    const store = useWorktreesStore();

    await store.loadWorktrees(REPO_PATH);
    await flushPromises();

    expect(store.error).toBeNull();
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it("discards stale response when newer load is in progress", async () => {
    // First call resolves after second call
    const firstDeferred = createDeferred<WorktreeInfo[]>();
    mocks.listWorktrees
      .mockReturnValueOnce(firstDeferred.promise)
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
    firstDeferred.resolve(ALL_WORKTREES.map((w) => ({ ...w })));
    await call1;
    await flushPromises();
    // Worktrees should still be from call2 (stale result discarded)
    expect(store.worktrees).toHaveLength(1);
    expect(store.worktrees[0].branch).toBe("feature-b");
  });

  it("discards stale disk-hydration when a newer load starts", async () => {
    // Disk usage resolves AFTER a second loadWorktrees call starts
    const diskUsageDeferred = createDeferred<number>();

    mocks.listWorktrees
      .mockResolvedValueOnce([{ ...FIXTURE_FEATURE_WT }])
      .mockResolvedValueOnce([{ ...FIXTURE_STALE_WT }]);
    mocks.getWorktreeDiskUsage
      .mockReturnValueOnce(diskUsageDeferred.promise) // first load's hydration — delayed
      .mockResolvedValue(9999); // second load's hydration — immediate

    const store = useWorktreesStore();

    // First load starts — triggers hydration with delayed promise
    await store.loadWorktrees(REPO_PATH);

    // Second load starts — invalidates first load's guard token
    await store.loadWorktrees(REPO_PATH);
    await flushPromises();

    // Now resolve the first load's disk-usage promise
    diskUsageDeferred.resolve(42000);
    await flushPromises();

    // The stale hydration (42000) should be discarded;
    // only the second load's worktrees should be present
    expect(store.worktrees).toHaveLength(1);
    expect(store.worktrees[0].branch).toBe("feature-b");
    // diskUsageBytes should be 9999 (from second load), not 42000 (stale)
    expect(store.worktrees[0].diskUsageBytes).toBe(9999);
  });
});
