import {
  createWorktree as createWorktreeApi,
  getWorktreeDetails as getWorktreeDetailsApi,
  listBranches as listBranchesApi,
  listWorktrees,
  lockWorktree as lockWorktreeApi,
  pruneWorktrees as pruneWorktreesApi,
  removeWorktree as removeWorktreeApi,
  unlockWorktree as unlockWorktreeApi,
} from "@tracepilot/client";
import type {
  CreateWorktreeRequest,
  PruneResult,
  WorktreeDetails,
  WorktreeInfo,
} from "@tracepilot/types";
import { runAction, runMutation } from "@tracepilot/ui";
import { logWarn } from "@/utils/logger";
import { aggregateSettledErrors } from "@/utils/settleErrors";
import type { WorktreesContext } from "./context";
import { hydrateDiskUsageBatch } from "./hydration";

export function createWorktreeActions(context: WorktreesContext) {
  const {
    branches,
    branchGuard,
    currentRepoPath,
    error,
    loadGuard,
    loading,
    registeredRepos,
    worktrees,
  } = context;

  async function loadWorktrees(repoPath: string) {
    currentRepoPath.value = repoPath;
    await runAction({
      loading,
      error,
      guard: loadGuard,
      action: () => listWorktrees(repoPath),
      onSuccess: (result) => {
        worktrees.value = result;
        void hydrateDiskUsageBatch(context, [...result], loadGuard.current());
      },
    });
  }

  async function loadAllWorktrees() {
    await runAction({
      loading,
      error,
      guard: loadGuard,
      action: () => {
        const repos = [...registeredRepos.value];
        return Promise.allSettled(repos.map((repo) => listWorktrees(repo.path))).then(
          (results) => ({
            repos,
            results,
          }),
        );
      },
      onSuccess: ({ repos, results }) => {
        const allWorktrees: WorktreeInfo[] = [];
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result.status === "fulfilled") {
            allWorktrees.push(...result.value);
          } else {
            logWarn("[worktrees] Failed to load worktrees for repo", {
              repo: repos[i].path,
              error: result.reason,
            });
          }
        }

        if (repos.length > 0 && results.every((r) => r.status === "rejected")) {
          error.value = aggregateSettledErrors(results);
        }

        worktrees.value = allWorktrees;
        void hydrateDiskUsageBatch(context, [...allWorktrees], loadGuard.current());
      },
    });
  }

  async function loadBranches(repoPath: string) {
    const token = branchGuard.start();
    try {
      const result = await listBranchesApi(repoPath);
      if (!branchGuard.isValid(token)) return;
      branches.value = result;
    } catch (e) {
      if (!branchGuard.isValid(token)) return;
      logWarn("[worktrees] Failed to load branches", { repoPath, error: e });
      branches.value = [];
    }
  }

  async function addWorktree(request: CreateWorktreeRequest): Promise<WorktreeInfo | null> {
    return runMutation(error, async () => {
      const wt = await createWorktreeApi(request);
      worktrees.value = [...worktrees.value, wt];
      return wt;
    });
  }

  async function deleteWorktree(
    worktreePath: string,
    force = false,
    repoPath?: string,
  ): Promise<boolean> {
    const repo = repoPath ?? currentRepoPath.value;
    const ok = await runMutation(error, async () => {
      await removeWorktreeApi(repo, worktreePath, force);
      worktrees.value = worktrees.value.filter((w) => w.path !== worktreePath);
      return true as const;
    });
    return ok ?? false;
  }

  async function prune(repoPath?: string): Promise<PruneResult | null> {
    const repo = repoPath ?? currentRepoPath.value;
    return runMutation(error, async () => {
      const result = await pruneWorktreesApi(repo);
      if (result.prunedCount > 0) {
        await loadWorktrees(repo);
      }
      return result;
    });
  }

  async function lockWorktree(
    worktreePath: string,
    reason?: string,
    repoPath?: string,
  ): Promise<boolean> {
    const repo = repoPath ?? currentRepoPath.value;
    const ok = await runMutation(error, async () => {
      await lockWorktreeApi(repo, worktreePath, reason);
      const idx = worktrees.value.findIndex((w) => w.path === worktreePath);
      if (idx >= 0) {
        worktrees.value[idx] = { ...worktrees.value[idx], isLocked: true, lockedReason: reason };
      }
      return true as const;
    });
    return ok ?? false;
  }

  async function unlockWorktree(worktreePath: string, repoPath?: string): Promise<boolean> {
    const repo = repoPath ?? currentRepoPath.value;
    const ok = await runMutation(error, async () => {
      await unlockWorktreeApi(repo, worktreePath);
      const idx = worktrees.value.findIndex((w) => w.path === worktreePath);
      if (idx >= 0) {
        worktrees.value[idx] = {
          ...worktrees.value[idx],
          isLocked: false,
          lockedReason: undefined,
        };
      }
      return true as const;
    });
    return ok ?? false;
  }

  async function fetchWorktreeDetails(worktreePath: string): Promise<WorktreeDetails | null> {
    try {
      return await getWorktreeDetailsApi(worktreePath);
    } catch (e) {
      logWarn("[worktrees] Failed to fetch worktree details", { worktreePath, error: e });
      return null;
    }
  }

  function hydrateDiskUsage(worktreePath: string) {
    const wt = worktrees.value.find((w) => w.path === worktreePath);
    if (wt) {
      void hydrateDiskUsageBatch(context, [wt]);
    }
  }

  return {
    loadWorktrees,
    loadAllWorktrees,
    loadBranches,
    addWorktree,
    deleteWorktree,
    prune,
    lockWorktree,
    unlockWorktree,
    fetchWorktreeDetails,
    hydrateDiskUsage,
  };
}
