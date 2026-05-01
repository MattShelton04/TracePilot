import type { RegisteredRepo, WorktreeInfo } from "@tracepilot/types";
import { useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { SortDirection, WorktreeSortField, WorktreesContext } from "./context";
import { createRegistryActions } from "./registryActions";
import { sortRegisteredRepos, sortWorktrees } from "./sorting";
import { createWorktreeActions } from "./worktreeActions";

export const useWorktreesStore = defineStore("worktrees", () => {
  // ─── State ────────────────────────────────────────────────────────
  const worktrees = ref<WorktreeInfo[]>([]);
  // shallowRef: branch list is always replaced wholesale.
  const branches = shallowRef<string[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const currentRepoPath = ref("");
  const loadGuard = useAsyncGuard(); // guards against out-of-order async overwrites

  // Repository registry
  const registeredRepos = ref<RegisteredRepo[]>([]);
  const reposLoading = ref(false);

  // Sort state
  const sortBy = ref<WorktreeSortField>("branch");
  const sortDirection = ref<SortDirection>("asc");
  const branchGuard = useAsyncGuard();

  const context: WorktreesContext = {
    worktrees,
    branches,
    loading,
    error,
    currentRepoPath,
    registeredRepos,
    reposLoading,
    loadGuard,
    branchGuard,
  };

  // ─── Computed ─────────────────────────────────────────────────────
  const mainWorktree = computed(() => worktrees.value.find((w) => w.isMainWorktree));
  const secondaryWorktrees = computed(() => worktrees.value.filter((w) => !w.isMainWorktree));
  const worktreeCount = computed(() => worktrees.value.length);
  const sortedWorktrees = computed(() =>
    sortWorktrees(worktrees.value, sortBy.value, sortDirection.value),
  );
  const activeCount = computed(() => worktrees.value.filter((w) => w.status === "active").length);
  const staleCount = computed(() => worktrees.value.filter((w) => w.status === "stale").length);
  const lockedCount = computed(() => worktrees.value.filter((w) => w.isLocked).length);
  const totalDiskUsage = computed(() =>
    worktrees.value.reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0),
  );
  const sortedRegisteredRepos = computed(() => sortRegisteredRepos(registeredRepos.value));

  const worktreeActions = createWorktreeActions(context);
  const registryActions = createRegistryActions(context);

  // ─── Sort ─────────────────────────────────────────────────────────
  function setSortBy(field: WorktreeSortField) {
    if (sortBy.value === field) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
    } else {
      sortBy.value = field;
      sortDirection.value = "asc";
    }
  }

  function clearError() {
    error.value = null;
  }

  function setCurrentRepoPath(path: string) {
    currentRepoPath.value = path;
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
    totalDiskUsage,
    // Worktree actions
    ...worktreeActions,
    // Registry actions
    ...registryActions,
    // Computed (registry)
    sortedRegisteredRepos,
    // Sort
    setSortBy,
    clearError,
    setCurrentRepoPath,
  };
});
