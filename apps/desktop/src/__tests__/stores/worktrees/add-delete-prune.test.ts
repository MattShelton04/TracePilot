// biome-ignore assist/source/organizeImports: setup must register mocks before the store import.
import type { CreateWorktreeRequest, PruneResult, WorktreeInfo } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_FEATURE_WT,
  FIXTURE_MAIN_WT,
  mocks,
  REPO_PATH,
  setupWorktreesStoreTest,
} from "./setup";
import { useWorktreesStore } from "../../../stores/worktrees";

setupWorktreesStoreTest();

describe("useWorktreesStore addWorktree", () => {
  it("appends new worktree and returns it", async () => {
    const newWt: WorktreeInfo = {
      ...FIXTURE_FEATURE_WT,
      branch: "feature-new",
      path: `${REPO_PATH}/.worktrees/feature-new`,
    };
    mocks.createWorktree.mockResolvedValue(newWt);
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
    mocks.createWorktree.mockRejectedValue(new Error("branch exists"));
    const store = useWorktreesStore();

    const result = await store.addWorktree({
      repoPath: REPO_PATH,
      branch: "existing",
    } as CreateWorktreeRequest);

    expect(result).toBeNull();
    expect(store.error).toContain("branch exists");
  });
});

describe("useWorktreesStore deleteWorktree", () => {
  it("removes worktree from list on success", async () => {
    mocks.removeWorktree.mockResolvedValue(undefined);
    const store = useWorktreesStore();
    store.worktrees = [FIXTURE_MAIN_WT, FIXTURE_FEATURE_WT];

    const result = await store.deleteWorktree(FIXTURE_FEATURE_WT.path, false, REPO_PATH);

    expect(result).toBe(true);
    expect(store.worktrees).toHaveLength(1);
    expect(store.worktrees[0].branch).toBe("main");
  });

  it("uses currentRepoPath when repoPath not provided", async () => {
    mocks.removeWorktree.mockResolvedValue(undefined);
    const store = useWorktreesStore();
    store.currentRepoPath = REPO_PATH;
    store.worktrees = [FIXTURE_FEATURE_WT];

    await store.deleteWorktree(FIXTURE_FEATURE_WT.path);

    expect(mocks.removeWorktree).toHaveBeenCalledWith(REPO_PATH, FIXTURE_FEATURE_WT.path, false);
  });

  it("sets error and returns false on failure", async () => {
    mocks.removeWorktree.mockRejectedValue(new Error("in use"));
    const store = useWorktreesStore();

    const result = await store.deleteWorktree("/some/path", false, REPO_PATH);

    expect(result).toBe(false);
    expect(store.error).toContain("in use");
  });
});

describe("useWorktreesStore prune", () => {
  it("reloads worktrees when prunedCount > 0", async () => {
    const pruneResult: PruneResult = { prunedCount: 2, messages: ["pruned feature-a"] };
    mocks.pruneWorktrees.mockResolvedValue(pruneResult);
    mocks.listWorktrees.mockResolvedValue([FIXTURE_MAIN_WT]);
    const store = useWorktreesStore();
    store.currentRepoPath = REPO_PATH;

    const result = await store.prune();

    expect(result).toEqual(pruneResult);
    expect(mocks.listWorktrees).toHaveBeenCalled();
  });

  it("does NOT reload worktrees when prunedCount is 0", async () => {
    const pruneResult: PruneResult = { prunedCount: 0, messages: [] };
    mocks.pruneWorktrees.mockResolvedValue(pruneResult);
    const store = useWorktreesStore();
    store.currentRepoPath = REPO_PATH;

    const result = await store.prune();

    expect(result).toEqual(pruneResult);
    expect(mocks.listWorktrees).not.toHaveBeenCalled();
  });

  it("uses currentRepoPath when repoPath not provided", async () => {
    mocks.pruneWorktrees.mockResolvedValue({ prunedCount: 0, messages: [] });
    const store = useWorktreesStore();
    store.currentRepoPath = REPO_PATH;

    await store.prune();

    expect(mocks.pruneWorktrees).toHaveBeenCalledWith(REPO_PATH);
  });

  it("uses explicit repoPath when provided", async () => {
    mocks.pruneWorktrees.mockResolvedValue({ prunedCount: 0, messages: [] });
    const store = useWorktreesStore();
    store.currentRepoPath = "/other/path";

    await store.prune(REPO_PATH);

    expect(mocks.pruneWorktrees).toHaveBeenCalledWith(REPO_PATH);
  });

  it("sets error and returns null on failure", async () => {
    mocks.pruneWorktrees.mockRejectedValue(new Error("prune failed"));
    const store = useWorktreesStore();
    store.currentRepoPath = REPO_PATH;

    const result = await store.prune();

    expect(result).toBeNull();
    expect(store.error).toContain("prune failed");
  });
});
