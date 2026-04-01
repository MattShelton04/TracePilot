import {
  addRegisteredRepo as addRegisteredRepoApi,
  createWorktree as createWorktreeApi,
  discoverReposFromSessions as discoverReposApi,
  getWorktreeDetails as getWorktreeDetailsApi,
  getWorktreeDiskUsage,
  listBranches as listBranchesApi,
  listRegisteredRepos,
  listWorktrees,
  lockWorktree as lockWorktreeApi,
  pruneWorktrees as pruneWorktreesApi,
  removeRegisteredRepo as removeRegisteredRepoApi,
  removeWorktree as removeWorktreeApi,
  toggleRepoFavourite,
  unlockWorktree as unlockWorktreeApi,
} from "@tracepilot/client";
import type {
  CreateWorktreeRequest,
  PruneResult,
  RegisteredRepo,
  WorktreeDetails,
  WorktreeInfo,
} from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useAsyncGuard } from "@/composables/useAsyncGuard";
import { logWarn } from "@/utils/logger";
import { aggregateSettledErrors } from "@/utils/settleErrors";

/** Max concurrent disk-usage IPC calls during hydration. */
const HYDRATION_CONCURRENCY = 4;

export const useWorktreesStore = defineStore("worktrees", () => {
  // ─── State ────────────────────────────────────────────────────────
  const worktrees = ref<WorktreeInfo[]>([]);
  const branches = ref<string[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const currentRepoPath = ref("");
  const loadGuard = useAsyncGuard(); // guards against out-of-order async overwrites

  // Repository registry
  const registeredRepos = ref<RegisteredRepo[]>([]);
  const reposLoading = ref(false);

  // Sort state
  const sortBy = ref<"branch" | "status" | "createdAt" | "diskUsageBytes">("branch");
  const sortDirection = ref<"asc" | "desc">("asc");

  // ─── Computed ─────────────────────────────────────────────────────
  const mainWorktree = computed(() => worktrees.value.find((w) => w.isMainWorktree));
  const secondaryWorktrees = computed(() => worktrees.value.filter((w) => !w.isMainWorktree));
  const worktreeCount = computed(() => worktrees.value.length);

  const sortedWorktrees = computed(() => {
    const sorted = [...worktrees.value];
    const dir = sortDirection.value === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sortBy.value) {
        case "branch":
          return dir * a.branch.localeCompare(b.branch);
        case "status":
          return dir * a.status.localeCompare(b.status);
        case "createdAt":
          return dir * ((a.createdAt ?? "") < (b.createdAt ?? "") ? -1 : 1);
        case "diskUsageBytes":
          return dir * ((a.diskUsageBytes ?? 0) - (b.diskUsageBytes ?? 0));
        default:
          return 0;
      }
    });
    return sorted;
  });

  const activeCount = computed(() => worktrees.value.filter((w) => w.status === "active").length);
  const staleCount = computed(() => worktrees.value.filter((w) => w.status === "stale").length);
  const lockedCount = computed(() => worktrees.value.filter((w) => w.isLocked).length);

  // ─── Disk Usage Hydration ─────────────────────────────────────────
  // Shared helper — hydrates diskUsageBytes for each worktree in `items`.
  // Processes items in batches of HYDRATION_CONCURRENCY to limit concurrent
  // IPC calls. When `guardToken` is provided, results are discarded if the
  // token has become stale (prevents out-of-order async overwrites).

  async function hydrateDiskUsageBatch(items: WorktreeInfo[], guardToken?: number): Promise<void> {
    for (let i = 0; i < items.length; i += HYDRATION_CONCURRENCY) {
      if (guardToken != null && !loadGuard.isValid(guardToken)) return;
      const batch = items.slice(i, i + HYDRATION_CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (wt) => {
          try {
            const bytes = await getWorktreeDiskUsage(wt.path);
            if (guardToken != null && !loadGuard.isValid(guardToken)) return;
            const idx = worktrees.value.findIndex((w) => w.path === wt.path);
            if (idx >= 0) {
              worktrees.value[idx] = { ...worktrees.value[idx], diskUsageBytes: bytes };
            }
          } catch (e) {
            logWarn("[worktrees] Failed to hydrate disk usage", { path: wt.path, error: e });
          }
        }),
      );
    }
  }

  // ─── Worktree Actions ─────────────────────────────────────────────

  async function loadWorktrees(repoPath: string) {
    const token = loadGuard.start();
    loading.value = true;
    error.value = null;
    currentRepoPath.value = repoPath;
    try {
      const result = await listWorktrees(repoPath);
      if (!loadGuard.isValid(token)) return; // stale response — discard
      worktrees.value = result;
      void hydrateDiskUsageBatch([...result], token);
    } catch (e) {
      if (!loadGuard.isValid(token)) return;
      error.value = toErrorMessage(e);
    } finally {
      if (loadGuard.isValid(token)) loading.value = false;
    }
  }

  async function loadAllWorktrees() {
    const token = loadGuard.start();
    loading.value = true;
    error.value = null;
    try {
      // Snapshot repos and fire all requests in parallel for faster loading.
      // This matches the Promise.allSettled pattern used by orchestrationHome,
      // configInjector, and launcher stores.
      const repos = [...registeredRepos.value];
      const results = await Promise.allSettled(repos.map((repo) => listWorktrees(repo.path)));
      if (!loadGuard.isValid(token)) return;

      const allWorktrees: WorktreeInfo[] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled") {
          allWorktrees.push(...result.value);
        } else {
          // Skip repos that fail (e.g., deleted from disk)
          logWarn("[worktrees] Failed to load worktrees for repo", {
            repo: repos[i].path,
            error: result.reason,
          });
        }
      }

      // Only surface a user-visible error when every repo failed — partial
      // failures are already warn-logged above and don't block the UI.
      // Note: a repo that succeeds with [] worktrees is not a failure.
      if (repos.length > 0 && results.every((r) => r.status === "rejected")) {
        error.value = aggregateSettledErrors(results);
      }

      worktrees.value = allWorktrees;
      void hydrateDiskUsageBatch([...allWorktrees], token);
    } catch (e) {
      if (!loadGuard.isValid(token)) return;
      error.value = toErrorMessage(e);
    } finally {
      if (loadGuard.isValid(token)) loading.value = false;
    }
  }

  const branchGuard = useAsyncGuard();

  async function loadBranches(repoPath: string) {
    const token = branchGuard.start();
    try {
      const result = await listBranchesApi(repoPath);
      if (!branchGuard.isValid(token)) return;
      branches.value = result;
    } catch (e) {
      if (!branchGuard.isValid(token)) return;
      // Non-critical - branch list is optional for some operations
      logWarn("[worktrees] Failed to load branches", { repoPath, error: e });
      branches.value = [];
    }
  }

  async function addWorktree(request: CreateWorktreeRequest): Promise<WorktreeInfo | null> {
    error.value = null;
    try {
      const wt = await createWorktreeApi(request);
      worktrees.value = [...worktrees.value, wt];
      return wt;
    } catch (e) {
      error.value = toErrorMessage(e);
      return null;
    }
  }

  async function deleteWorktree(
    worktreePath: string,
    force = false,
    repoPath?: string,
  ): Promise<boolean> {
    error.value = null;
    const repo = repoPath ?? currentRepoPath.value;
    try {
      await removeWorktreeApi(repo, worktreePath, force);
      worktrees.value = worktrees.value.filter((w) => w.path !== worktreePath);
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function prune(repoPath?: string): Promise<PruneResult | null> {
    error.value = null;
    const repo = repoPath ?? currentRepoPath.value;
    try {
      const result = await pruneWorktreesApi(repo);
      if (result.prunedCount > 0) {
        await loadWorktrees(repo);
      }
      return result;
    } catch (e) {
      error.value = toErrorMessage(e);
      return null;
    }
  }

  async function lockWorktree(
    worktreePath: string,
    reason?: string,
    repoPath?: string,
  ): Promise<boolean> {
    error.value = null;
    const repo = repoPath ?? currentRepoPath.value;
    try {
      await lockWorktreeApi(repo, worktreePath, reason);
      const idx = worktrees.value.findIndex((w) => w.path === worktreePath);
      if (idx >= 0) {
        worktrees.value[idx] = {
          ...worktrees.value[idx],
          isLocked: true,
          lockedReason: reason,
        };
      }
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function unlockWorktree(worktreePath: string, repoPath?: string): Promise<boolean> {
    error.value = null;
    const repo = repoPath ?? currentRepoPath.value;
    try {
      await unlockWorktreeApi(repo, worktreePath);
      const idx = worktrees.value.findIndex((w) => w.path === worktreePath);
      if (idx >= 0) {
        worktrees.value[idx] = {
          ...worktrees.value[idx],
          isLocked: false,
          lockedReason: undefined,
        };
      }
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function fetchWorktreeDetails(worktreePath: string): Promise<WorktreeDetails | null> {
    try {
      return await getWorktreeDetailsApi(worktreePath);
    } catch (e) {
      // Non-critical - details are optional UI enhancement
      logWarn("[worktrees] Failed to fetch worktree details", { worktreePath, error: e });
      return null;
    }
  }

  function hydrateDiskUsage(worktreePath: string) {
    const wt = worktrees.value.find((w) => w.path === worktreePath);
    if (wt) {
      void hydrateDiskUsageBatch([wt]);
    }
  }

  // ─── Repository Registry Actions ──────────────────────────────────

  async function loadRegisteredRepos() {
    reposLoading.value = true;
    try {
      registeredRepos.value = await listRegisteredRepos();
    } catch (e) {
      error.value = toErrorMessage(e);
    } finally {
      reposLoading.value = false;
    }
  }

  async function addRepo(path: string): Promise<RegisteredRepo | null> {
    error.value = null;
    try {
      const repo = await addRegisteredRepoApi(path);
      // Refresh the list to ensure consistency
      await loadRegisteredRepos();
      return repo;
    } catch (e) {
      error.value = toErrorMessage(e);
      return null;
    }
  }

  async function removeRepo(path: string): Promise<boolean> {
    error.value = null;
    try {
      await removeRegisteredRepoApi(path);
      registeredRepos.value = registeredRepos.value.filter((r) => r.path !== path);
      // Also remove worktrees belonging to this repo
      worktrees.value = worktrees.value.filter((w) => w.repoRoot !== path);
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function discoverRepos(): Promise<RegisteredRepo[]> {
    error.value = null;
    try {
      const newRepos = await discoverReposApi();
      if (newRepos.length > 0) {
        await loadRegisteredRepos();
      }
      return newRepos;
    } catch (e) {
      error.value = toErrorMessage(e);
      return [];
    }
  }

  const togglingFavourites = ref(new Set<string>());

  async function toggleFavourite(path: string) {
    if (togglingFavourites.value.has(path)) return;
    togglingFavourites.value.add(path);
    try {
      const newState = await toggleRepoFavourite(path);
      const repo = registeredRepos.value.find((r) => r.path === path);
      if (repo) {
        repo.favourite = newState;
      }
    } catch (e) {
      error.value = toErrorMessage(e);
    } finally {
      togglingFavourites.value.delete(path);
    }
  }

  const sortedRegisteredRepos = computed(() => {
    return [...registeredRepos.value].sort((a, b) => {
      if (a.favourite && !b.favourite) return -1;
      if (!a.favourite && b.favourite) return 1;
      return a.name.localeCompare(b.name);
    });
  });

  // ─── Sort ─────────────────────────────────────────────────────────

  function setSortBy(field: typeof sortBy.value) {
    if (sortBy.value === field) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
    } else {
      sortBy.value = field;
      sortDirection.value = "asc";
    }
  }

  return {
    // State
    worktrees,
    branches,
    loading,
    error,
    currentRepoPath,
    registeredRepos,
    reposLoading,
    sortBy,
    sortDirection,
    // Computed
    mainWorktree,
    secondaryWorktrees,
    worktreeCount,
    sortedWorktrees,
    activeCount,
    staleCount,
    lockedCount,
    // Worktree actions
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
    // Registry actions
    loadRegisteredRepos,
    addRepo,
    removeRepo,
    discoverRepos,
    toggleFavourite,
    togglingFavourites,
    // Computed (registry)
    sortedRegisteredRepos,
    // Sort
    setSortBy,
  };
});
