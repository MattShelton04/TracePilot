import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { WorktreeInfo, CreateWorktreeRequest, PruneResult } from '@tracepilot/types';
import {
  listWorktrees,
  createWorktree as createWorktreeApi,
  removeWorktree as removeWorktreeApi,
  pruneWorktrees as pruneWorktreesApi,
  listBranches as listBranchesApi,
  getWorktreeDiskUsage,
} from '@tracepilot/client';

export const useWorktreesStore = defineStore('worktrees', () => {
  const worktrees = ref<WorktreeInfo[]>([]);
  const branches = ref<string[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const currentRepoPath = ref('');

  const mainWorktree = computed(() => worktrees.value.find((w) => w.isMainWorktree));
  const secondaryWorktrees = computed(() => worktrees.value.filter((w) => !w.isMainWorktree));
  const worktreeCount = computed(() => worktrees.value.length);

  async function loadWorktrees(repoPath: string) {
    loading.value = true;
    error.value = null;
    currentRepoPath.value = repoPath;
    try {
      worktrees.value = await listWorktrees(repoPath);
      // Load disk usage async for each worktree
      for (const wt of worktrees.value) {
        getWorktreeDiskUsage(wt.path)
          .then((bytes) => {
            const idx = worktrees.value.findIndex((w) => w.path === wt.path);
            if (idx >= 0) {
              worktrees.value[idx] = { ...worktrees.value[idx], diskUsageBytes: bytes };
            }
          })
          .catch(() => { /* ignore disk usage errors */ });
      }
    } catch (e) {
      error.value = String(e);
    } finally {
      loading.value = false;
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

  async function deleteWorktree(worktreePath: string, force = false): Promise<boolean> {
    error.value = null;
    try {
      await removeWorktreeApi(currentRepoPath.value, worktreePath, force);
      worktrees.value = worktrees.value.filter((w) => w.path !== worktreePath);
      return true;
    } catch (e) {
      error.value = String(e);
      return false;
    }
  }

  async function prune(): Promise<PruneResult | null> {
    error.value = null;
    try {
      const result = await pruneWorktreesApi(currentRepoPath.value);
      if (result.prunedCount > 0) {
        await loadWorktrees(currentRepoPath.value);
      }
      return result;
    } catch (e) {
      error.value = String(e);
      return null;
    }
  }

  return {
    worktrees,
    branches,
    loading,
    error,
    currentRepoPath,
    mainWorktree,
    secondaryWorktrees,
    worktreeCount,
    loadWorktrees,
    loadBranches,
    addWorktree,
    deleteWorktree,
    prune,
  };
});
