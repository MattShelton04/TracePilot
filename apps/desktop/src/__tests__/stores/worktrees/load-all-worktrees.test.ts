// biome-ignore assist/source/organizeImports: setup must register mocks before the store import.
import type { RegisteredRepo, WorktreeInfo } from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import {
  createDeferred,
  FIXTURE_FEATURE_WT,
  FIXTURE_MAIN_WT,
  FIXTURE_REPO,
  FIXTURE_REPO_2,
  FIXTURE_STALE_WT,
  mocks,
  setupWorktreesStoreTest,
} from "./setup";
import { useWorktreesStore } from "../../../stores/worktrees";

setupWorktreesStoreTest();

describe("useWorktreesStore loadAllWorktrees", () => {
  it("loads worktrees from all registered repos", async () => {
    const store = useWorktreesStore();
    store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2];

    const repo1Wts = [FIXTURE_MAIN_WT, FIXTURE_FEATURE_WT];
    const repo2Wts: WorktreeInfo[] = [
      {
        ...FIXTURE_STALE_WT,
        repoRoot: FIXTURE_REPO_2.path,
        path: `${FIXTURE_REPO_2.path}/.worktrees/dev`,
      },
    ];
    mocks.listWorktrees.mockResolvedValueOnce(repo1Wts).mockResolvedValueOnce(repo2Wts);

    await store.loadAllWorktrees();

    expect(store.worktrees).toHaveLength(3);
    expect(store.loading).toBe(false);
  });

  it("skips repos that fail without setting error", async () => {
    const store = useWorktreesStore();
    store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2];

    mocks.listWorktrees
      .mockRejectedValueOnce(new Error("repo deleted"))
      .mockResolvedValueOnce([FIXTURE_FEATURE_WT]);

    await store.loadAllWorktrees();

    expect(store.worktrees).toHaveLength(1);
    expect(store.error).toBeNull();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "[worktrees] Failed to load worktrees for repo",
      expect.objectContaining({ repo: FIXTURE_REPO.path }),
    );
  });

  it("hydrates disk usage for all worktrees", async () => {
    const store = useWorktreesStore();
    store.registeredRepos = [FIXTURE_REPO];
    mocks.listWorktrees.mockResolvedValue([FIXTURE_MAIN_WT, FIXTURE_FEATURE_WT]);
    mocks.getWorktreeDiskUsage.mockResolvedValue(9999);

    await store.loadAllWorktrees();
    await flushPromises();

    expect(mocks.getWorktreeDiskUsage).toHaveBeenCalledTimes(2);
  });

  it("surfaces error when all repos fail", async () => {
    mocks.listWorktrees.mockRejectedValue(new Error("network error"));
    const store = useWorktreesStore();
    // Need at least one repo to trigger the parallel fetch
    store.registeredRepos = [FIXTURE_REPO];

    await store.loadAllWorktrees();

    // When every repo fails, error.value is set so the UI can display
    // a meaningful message instead of silently showing an empty list.
    expect(store.worktrees).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.error).toBe("network error");
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "[worktrees] Failed to load worktrees for repo",
      expect.objectContaining({ repo: FIXTURE_REPO.path }),
    );
  });

  it("discards results when a newer loadAllWorktrees call starts", async () => {
    const firstDeferred = createDeferred<WorktreeInfo[]>();

    const store = useWorktreesStore();
    store.registeredRepos = [FIXTURE_REPO];

    mocks.listWorktrees
      .mockReturnValueOnce(firstDeferred.promise)
      .mockResolvedValueOnce([{ ...FIXTURE_STALE_WT }]);

    const call1 = store.loadAllWorktrees();
    const call2 = store.loadAllWorktrees(); // invalidates first call

    await call2;
    await flushPromises();
    expect(store.worktrees).toHaveLength(1);
    expect(store.worktrees[0].branch).toBe("feature-b");

    firstDeferred.resolve([{ ...FIXTURE_MAIN_WT }, { ...FIXTURE_FEATURE_WT }]);
    await call1;
    await flushPromises();
    // First call's results should be discarded
    expect(store.worktrees).toHaveLength(1);
    expect(store.worktrees[0].branch).toBe("feature-b");
  });

  it("fires all repo requests in parallel (not sequentially)", async () => {
    const store = useWorktreesStore();
    const repo3: RegisteredRepo = {
      path: "/home/user/repos/Third",
      name: "Third",
      addedAt: "2026-03-25T10:00:00Z",
      source: "manual",
      favourite: false,
    };
    store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2, repo3];

    // Use deferred promises so we can verify all calls started before any resolve
    const deferreds: Array<{ resolve: (v: WorktreeInfo[]) => void }> = [];
    mocks.listWorktrees.mockImplementation(() => {
      return new Promise<WorktreeInfo[]>((resolve) => {
        deferreds.push({ resolve });
      });
    });

    const p = store.loadAllWorktrees();
    await flushPromises(); // let Promise.allSettled dispatch all calls

    // All 3 repos should have started before any resolved (proves parallelism)
    expect(deferreds).toHaveLength(3);

    deferreds.forEach((d) => {
      d.resolve([]);
    });
    await p;
  });

  it("does not set error when some repos succeed and some fail", async () => {
    const store = useWorktreesStore();
    store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2];

    // First repo fails, second succeeds — partial failure
    mocks.listWorktrees
      .mockRejectedValueOnce(new Error("repo gone"))
      .mockResolvedValueOnce([FIXTURE_FEATURE_WT]);

    await store.loadAllWorktrees();

    // Partial failure: we have data from repo2, so no user-visible error
    expect(store.worktrees).toHaveLength(1);
    expect(store.error).toBeNull();
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it("does not set error when a repo succeeds with empty worktrees and another fails", async () => {
    const store = useWorktreesStore();
    store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2];

    // First repo succeeds with 0 worktrees, second repo fails
    mocks.listWorktrees.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("deleted"));

    await store.loadAllWorktrees();

    // One repo succeeded (even though it returned []), so this is not
    // "all repos failed" — no user-visible error
    expect(store.worktrees).toEqual([]);
    expect(store.error).toBeNull();
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it("surfaces aggregate error when all repos fail with different errors", async () => {
    const store = useWorktreesStore();
    store.registeredRepos = [FIXTURE_REPO, FIXTURE_REPO_2];

    mocks.listWorktrees
      .mockRejectedValueOnce(new Error("deleted"))
      .mockRejectedValueOnce(new Error("timeout"));

    await store.loadAllWorktrees();

    expect(store.worktrees).toEqual([]);
    // aggregateSettledErrors joins messages with "; "
    expect(store.error).toContain("deleted");
    expect(store.error).toContain("timeout");
  });

  it("returns empty worktrees with no error for empty registeredRepos", async () => {
    const store = useWorktreesStore();
    store.registeredRepos = [];

    await store.loadAllWorktrees();

    expect(store.worktrees).toEqual([]);
    expect(store.error).toBeNull();
    expect(store.loading).toBe(false);
    expect(mocks.listWorktrees).not.toHaveBeenCalled();
  });
});
