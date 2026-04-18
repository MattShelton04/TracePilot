import { ROUTE_NAMES } from "@/config/routes";
import { openInExplorer, openInTerminal } from "@tracepilot/client";
import type { WorktreeDetails, WorktreeInfo } from "@tracepilot/types";
import { useConfirmDialog, useToast } from "@tracepilot/ui";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { browseForDirectory } from "@/composables/useBrowseDirectory";
import { useWorktreesStore } from "@/stores/worktrees";

/**
 * Central state + action coordinator for the WorktreeManagerView shell.
 * Owns selection, filter, refresh/clean flags, confirmation flows, and
 * all actions that previously lived in the view's <script setup> block.
 */
export function useWorktreeManager() {
  const router = useRouter();
  const store = useWorktreesStore();
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirmDialog();

  const loaded = ref(false);
  const searchQuery = ref("");
  const selectedWorktree = ref<WorktreeInfo | null>(null);
  const selectedRepoPath = ref<string | null>(null);
  const showCreateModal = ref(false);
  const pruneMessage = ref<string | null>(null);
  const cleaningStale = ref(false);
  const worktreeDetails = ref<WorktreeDetails | null>(null);
  const detailsLoading = ref(false);
  const refreshing = ref(false);

  onMounted(async () => {
    await store.loadRegisteredRepos();
    if (store.registeredRepos.length > 0) {
      loaded.value = true;
      await store.loadAllWorktrees();
    }
  });

  const staleDiskUsage = computed(() =>
    store.worktrees
      .filter((w) => w.status === "stale")
      .reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0),
  );

  const staleWorktrees = computed(() => store.worktrees.filter((w) => w.status === "stale"));

  const worktreeCountByRepo = computed(() => {
    const counts = new Map<string, number>();
    for (const wt of store.worktrees) {
      const key = wt.repoRoot;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  });

  const filteredWorktrees = computed(() => {
    let list = store.sortedWorktrees;

    if (selectedRepoPath.value) {
      list = list.filter((w) => w.repoRoot === selectedRepoPath.value);
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase();
      list = list.filter(
        (w) =>
          w.branch.toLowerCase().includes(q) ||
          w.path.toLowerCase().includes(q) ||
          w.status.toLowerCase().includes(q),
      );
    }
    return list;
  });

  const initialRepoPath = computed(() => store.registeredRepos[0]?.path ?? "");

  async function handleAddRepo() {
    const selected = await browseForDirectory({ title: "Select Git Repository" });
    if (selected) {
      const result = await store.addRepo(selected);
      if (result) {
        toastSuccess(`Added ${result.name}`);
        loaded.value = true;
        await store.loadAllWorktrees();
      } else if (store.error) {
        toastError(store.error);
      }
    }
  }

  async function handleRemoveRepo(path: string) {
    const ok = await store.removeRepo(path);
    if (ok) {
      if (selectedRepoPath.value === path) {
        selectedRepoPath.value = null;
      }
      toastSuccess("Repository removed");
    }
  }

  async function handleDiscoverRepos() {
    const found = await store.discoverRepos();
    if (found.length > 0) {
      loaded.value = true;
      toastSuccess(`Discovered ${found.length} repo${found.length > 1 ? "s" : ""}`);
      await store.loadAllWorktrees();
    } else {
      toastSuccess("No new repositories discovered");
    }
  }

  async function handleSelectRepo(repoPath: string | null) {
    selectedRepoPath.value = repoPath;
    selectedWorktree.value = null;
    worktreeDetails.value = null;

    if (repoPath) {
      store.currentRepoPath = repoPath;
      store.loadBranches(repoPath);
    } else {
      store.currentRepoPath = "";
    }
    await store.loadAllWorktrees();
  }

  async function handleLoad() {
    store.error = null;
    pruneMessage.value = null;
    selectedWorktree.value = null;
    worktreeDetails.value = null;
    loaded.value = true;
    await store.loadAllWorktrees();
  }

  async function selectWorktree(wt: WorktreeInfo) {
    if (selectedWorktree.value?.path === wt.path) {
      selectedWorktree.value = null;
      worktreeDetails.value = null;
      return;
    }
    selectedWorktree.value = wt;
    worktreeDetails.value = null;
    detailsLoading.value = true;
    try {
      worktreeDetails.value = await store.fetchWorktreeDetails(wt.path);
    } finally {
      detailsLoading.value = false;
    }
  }

  function openCreateModal() {
    store.error = null;
    if (selectedRepoPath.value) {
      store.currentRepoPath = selectedRepoPath.value;
    }
    showCreateModal.value = true;
  }

  async function confirmDelete(wt: WorktreeInfo) {
    store.error = null;
    const { confirmed, checked } = await confirm({
      title: "Remove Worktree",
      message: `This will permanently remove the worktree and its working directory for "${wt.branch}". This action cannot be undone.`,
      variant: "danger",
      confirmLabel: "Remove",
      checkbox: "Force delete (even if there are uncommitted changes)",
    });
    if (!confirmed) return;
    const ok = await store.deleteWorktree(wt.path, checked, wt.repoRoot);
    if (ok) {
      if (selectedWorktree.value?.path === wt.path) {
        selectedWorktree.value = null;
        worktreeDetails.value = null;
      }
      toastSuccess("Worktree removed");
    } else {
      await store.loadAllWorktrees();
      toastError(store.error || "Failed to remove worktree");
    }
  }

  async function handlePrune() {
    pruneMessage.value = null;
    if (selectedRepoPath.value) {
      const result = await store.prune(selectedRepoPath.value);
      if (result) {
        pruneMessage.value =
          result.prunedCount > 0
            ? `Pruned ${result.prunedCount} stale worktree(s).`
            : "Nothing to prune — all worktrees are clean.";
      }
    } else {
      let totalPruned = 0;
      for (const repo of store.registeredRepos) {
        const result = await store.prune(repo.path);
        if (result) totalPruned += result.prunedCount;
      }
      pruneMessage.value =
        totalPruned > 0
          ? `Pruned ${totalPruned} stale worktree(s) across all repos.`
          : "Nothing to prune — all worktrees are clean.";
    }
  }

  async function handleCleanStale() {
    cleaningStale.value = true;
    try {
      for (const wt of staleWorktrees.value) {
        await store.deleteWorktree(wt.path, true, wt.repoRoot);
      }
      selectedWorktree.value = null;
      worktreeDetails.value = null;
    } finally {
      cleaningStale.value = false;
    }
  }

  async function handleLockInline(wt: WorktreeInfo) {
    const ok = await store.lockWorktree(wt.path, undefined, wt.repoRoot);
    if (ok) {
      if (selectedWorktree.value?.path === wt.path) {
        selectedWorktree.value = { ...selectedWorktree.value, isLocked: true };
      }
      toastSuccess("Worktree locked");
    }
  }

  async function handleUnlock(wt: WorktreeInfo) {
    const ok = await store.unlockWorktree(wt.path, wt.repoRoot);
    if (ok) {
      if (selectedWorktree.value?.path === wt.path) {
        selectedWorktree.value = {
          ...selectedWorktree.value,
          isLocked: false,
          lockedReason: undefined,
        };
      }
      toastSuccess("Worktree unlocked");
    }
  }

  function navigateToSession(sessionId: string) {
    router.push({ name: ROUTE_NAMES.sessionOverview, params: { id: sessionId } });
  }

  function navigateToLauncher(wt: WorktreeInfo) {
    router.push({
      path: "/orchestration/launcher",
      query: { repoPath: wt.path, branch: wt.branch },
    });
  }

  async function handleRefresh() {
    refreshing.value = true;
    try {
      await store.loadAllWorktrees();
      if (selectedWorktree.value) {
        try {
          worktreeDetails.value = await store.fetchWorktreeDetails(selectedWorktree.value.path);
        } catch {
          // Worktree may have been removed externally
        }
      }
    } finally {
      refreshing.value = false;
    }
  }

  async function handleOpenExplorer(path: string) {
    try {
      await openInExplorer(path);
    } catch (e) {
      toastError(`Failed to open folder: ${e}`);
    }
  }

  async function handleOpenTerminal(path: string) {
    try {
      await openInTerminal(path);
    } catch (e) {
      toastError(`Failed to open terminal: ${e}`);
    }
  }

  function closeDetail() {
    selectedWorktree.value = null;
    worktreeDetails.value = null;
  }

  watch(
    () => store.worktrees,
    () => {
      if (selectedWorktree.value) {
        const still = store.worktrees.find((w) => w.path === selectedWorktree.value?.path);
        if (!still) {
          selectedWorktree.value = null;
          worktreeDetails.value = null;
        } else {
          selectedWorktree.value = still;
        }
      }
    },
    { deep: true },
  );

  return {
    store,
    loaded,
    searchQuery,
    selectedWorktree,
    selectedRepoPath,
    showCreateModal,
    pruneMessage,
    cleaningStale,
    worktreeDetails,
    detailsLoading,
    refreshing,
    staleDiskUsage,
    worktreeCountByRepo,
    filteredWorktrees,
    initialRepoPath,
    handleAddRepo,
    handleRemoveRepo,
    handleDiscoverRepos,
    handleSelectRepo,
    handleLoad,
    selectWorktree,
    openCreateModal,
    confirmDelete,
    handlePrune,
    handleCleanStale,
    handleLockInline,
    handleUnlock,
    navigateToSession,
    navigateToLauncher,
    handleRefresh,
    handleOpenExplorer,
    handleOpenTerminal,
    closeDetail,
  };
}
