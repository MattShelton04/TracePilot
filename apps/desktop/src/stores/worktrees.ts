import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  WorktreeInfo,
  WorktreeDetails,
  CreateWorktreeRequest,
  PruneResult,
  RegisteredRepo,
} from '@tracepilot/types';
import {
  listWorktrees,
  createWorktree as createWorktreeApi,
  removeWorktree as removeWorktreeApi,
  pruneWorktrees as pruneWorktreesApi,
  listBranches as listBranchesApi,
  getWorktreeDiskUsage,
  lockWorktree as lockWorktreeApi,
  unlockWorktree as unlockWorktreeApi,
  getWorktreeDetails as getWorktreeDetailsApi,
  listRegisteredRepos,
  addRegisteredRepo as addRegisteredRepoApi,
  removeRegisteredRepo as removeRegisteredRepoApi,
  discoverReposFromSessions as discoverReposApi,
  toggleRepoFavourite,
} from '@tracepilot/client';

export const useWorktreesStore = defineStore('worktrees', () => {
  // ─── State ────────────────────────────────────────────────────────
  const worktrees = ref<WorktreeInfo[]>([]);
  const branches = ref<string[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const currentRepoPath = ref('');
  let loadGeneration = 0; // guards against out-of-order async overwrites

  // Repository registry
  const registeredRepos = ref<RegisteredRepo[]>([]);
  const reposLoading = ref(false);

  // Sort state
  const sortBy = ref<'branch' | 'status' | 'createdAt' | 'diskUsageBytes'>('branch');
  const sortDirection = ref<'asc' | 'desc'>('asc');

  // ─── Computed ─────────────────────────────────────────────────────
  const mainWorktree = computed(() => worktrees.value.find((w) => w.isMainWorktree));
  const secondaryWorktrees = computed(() => worktrees.value.filter((w) => !w.isMainWorktree));
  const worktreeCount = computed(() => worktrees.value.length);

  const sortedWorktrees = computed(() => {
    const sorted = [...worktrees.value];
    const dir = sortDirection.value === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sortBy.value) {
        case 'branch':
          return dir * a.branch.localeCompare(b.branch);
        case 'status':
          return dir * a.status.localeCompare(b.status);
        case 'createdAt':
          return dir * ((a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : 1);
        case 'diskUsageBytes':
          return dir * ((a.diskUsageBytes ?? 0) - (b.diskUsageBytes ?? 0));
        default:
          return 0;
      }
    });
    return sorted;
  });

  const activeCount = computed(() => worktrees.value.filter((w) => w.status === 'active').length);
  const staleCount = computed(() => worktrees.value.filter((w) => w.status === 'stale').length);
  const lockedCount = computed(() => worktrees.value.filter((w) => w.isLocked).length);

  // ─── Worktree Actions ─────────────────────────────────────────────

  async function loadWorktrees(repoPath: string) {
    const thisGen = ++loadGeneration;
    loading.value = true;
    error.value = null;
    currentRepoPath.value = repoPath;
    try {
      const result = await listWorktrees(repoPath);
      if (thisGen !== loadGeneration) return; // stale response — discard
      worktrees.value = result;
      // Load disk usage async — capture snapshot to avoid race conditions
      const snapshot = [...result];
      for (const wt of snapshot) {
        getWorktreeDiskUsage(wt.path)
          .then((bytes) => {
            if (thisGen !== loadGeneration) return;
            const idx = worktrees.value.findIndex((w) => w.path === wt.path);
            if (idx >= 0) {
              worktrees.value[idx] = { ...worktrees.value[idx], diskUsageBytes: bytes };
            }
          })
          .catch(() => { /* ignore disk usage errors */ });
      }
    } catch (e) {
      if (thisGen !== loadGeneration) return;
      error.value = String(e);
    } finally {
      if (thisGen === loadGeneration) loading.value = false;
    }
  }

  async function loadAllWorktrees() {
    const thisGen = ++loadGeneration;
    loading.value = true;
    error.value = null;
    try {
      const allWorktrees: WorktreeInfo[] = [];
      for (const repo of registeredRepos.value) {
        if (thisGen !== loadGeneration) return; // stale — abort
        try {
          const repoWorktrees = await listWorktrees(repo.path);
          allWorktrees.push(...repoWorktrees);
        } catch {
          // Skip repos that fail (e.g., deleted from disk)
        }
      }
      if (thisGen !== loadGeneration) return;
      worktrees.value = allWorktrees;
      // Hydrate disk usage asynchronously (same as loadWorktrees)
      const snapshot = [...allWorktrees];
      for (const wt of snapshot) {
        getWorktreeDiskUsage(wt.path)
          .then((bytes) => {
            if (thisGen !== loadGeneration) return;
            const idx = worktrees.value.findIndex((w) => w.path === wt.path);
            if (idx >= 0) {
              worktrees.value[idx] = { ...worktrees.value[idx], diskUsageBytes: bytes };
            }
          })
          .catch(() => { /* ignore disk usage errors */ });
      }
    } catch (e) {
      if (thisGen !== loadGeneration) return;
      error.value = String(e);
    } finally {
      if (thisGen === loadGeneration) loading.value = false;
    }
  }

  async function loadBranches(repoPath: string) {
    try {
      branches.value = await listBranchesApi(repoPath);
    } catch {
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
      error.value = String(e);
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
      error.value = String(e);
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
      error.value = String(e);
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
      error.value = String(e);
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
      error.value = String(e);
      return false;
    }
  }

  async function fetchWorktreeDetails(worktreePath: string): Promise<WorktreeDetails | null> {
    try {
      return await getWorktreeDetailsApi(worktreePath);
    } catch {
      return null;
    }
  }

  function hydrateDiskUsage(worktreePath: string) {
    getWorktreeDiskUsage(worktreePath)
      .then((bytes) => {
        const idx = worktrees.value.findIndex((w) => w.path === worktreePath);
        if (idx >= 0) {
          worktrees.value[idx] = { ...worktrees.value[idx], diskUsageBytes: bytes };
        }
      })
      .catch(() => { /* ignore */ });
  }

  // ─── Repository Registry Actions ──────────────────────────────────

  async function loadRegisteredRepos() {
    reposLoading.value = true;
    try {
      registeredRepos.value = await listRegisteredRepos();
    } catch (e) {
      error.value = String(e);
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
      error.value = String(e);
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
      error.value = String(e);
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
      error.value = String(e);
      return [];
    }
  }

  const togglingFavourites = ref(new Set<string>());

  async function toggleFavourite(path: string) {
    if (togglingFavourites.value.has(path)) return;
    togglingFavourites.value.add(path);
    try {
      const newState = await toggleRepoFavourite(path);
      const repo = registeredRepos.value.find(r => r.path === path);
      if (repo) {
        repo.favourite = newState;
      }
    } catch (e) {
      error.value = String(e);
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
      sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy.value = field;
      sortDirection.value = 'asc';
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
