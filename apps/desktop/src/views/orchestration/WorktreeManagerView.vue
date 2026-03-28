<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import type { CreateWorktreeRequest, WorktreeInfo, WorktreeDetails } from '@tracepilot/types';
import { openInExplorer, openInTerminal } from '@tracepilot/client';
import { formatBytes, formatRelativeTime, LoadingSpinner, useToast, useConfirmDialog, normalizePath, SearchableSelect } from '@tracepilot/ui';
import { useWorktreesStore } from '@/stores/worktrees';
import { usePreferencesStore } from '@/stores/preferences';
import { browseForDirectory } from '@/composables/useBrowseDirectory';
import { useGitRepository } from '@/composables/useGitRepository';

const router = useRouter();
const store = useWorktreesStore();
const prefsStore = usePreferencesStore();
const { success: toastSuccess, error: toastError } = useToast();
const { confirm } = useConfirmDialog();

/* ─── Local State ─────────────────────────────────────────────── */
const loaded = ref(false);
const searchQuery = ref('');
const selectedWorktree = ref<WorktreeInfo | null>(null);
const selectedRepoPath = ref<string | null>(null);
const showCreateModal = ref(false);
const pruneMessage = ref<string | null>(null);
const cleaningStale = ref(false);
const worktreeDetails = ref<WorktreeDetails | null>(null);
const detailsLoading = ref(false);
const refreshing = ref(false);

// Create form state
const newBranch = ref('');
const newBaseBranch = ref('');
const newTargetDir = ref('');
const createModalRepoPath = ref('');

// ── Git repository operations ───────────────────────────────────────
const {
  defaultBranch,
  fetchingRemote,
  fetchRemote: performFetchRemote,
  loadDefaultBranch,
  computeWorktreePath,
} = useGitRepository({
  repoPath: computed(() => createModalRepoPath.value),
  onFetchSuccess: () => {
    toastSuccess('Fetched latest from remote');
  },
  onFetchError: (error) => {
    toastError(error);
  },
});

/* ─── Lifecycle ───────────────────────────────────────────────── */
onMounted(async () => {
  await store.loadRegisteredRepos();
  if (store.registeredRepos.length > 0) {
    loaded.value = true;
    await store.loadAllWorktrees();
  }
});

/* ─── Computed ────────────────────────────────────────────────── */
const totalDiskUsage = computed(() =>
  store.worktrees.reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0),
);

const staleDiskUsage = computed(() =>
  store.worktrees
    .filter((w) => w.status === 'stale')
    .reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0),
);

const staleWorktrees = computed(() =>
  store.worktrees.filter((w) => w.status === 'stale'),
);

const maxWorktreeDisk = computed(() =>
  Math.max(...filteredWorktrees.value.map((w) => w.diskUsageBytes ?? 0), 1),
);

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

const computedWorktreePath = computed(() => {
  if (!newBranch.value.trim()) return '';
  return computeWorktreePath(newBranch.value);
});

/* ─── Helpers ─────────────────────────────────────────────────── */

function diskBarPercent(wt: WorktreeInfo): number {
  if (!wt.diskUsageBytes) return 0;
  return Math.min(100, Math.round((wt.diskUsageBytes / maxWorktreeDisk.value) * 100));
}

function diskBarColor(wt: WorktreeInfo): string {
  const pct = diskBarPercent(wt);
  if (pct < 40) return 'var(--success-fg)';
  if (pct < 75) return 'var(--accent-fg)';
  return 'var(--warning-fg)';
}

function sortIcon(field: 'branch' | 'status' | 'createdAt' | 'diskUsageBytes'): string {
  if (store.sortBy !== field) return '';
  return store.sortDirection === 'asc' ? '↑' : '↓';
}

/* ─── Repo Registry Actions ──────────────────────────────────── */
async function handleAddRepo() {
  const selected = await browseForDirectory({ title: 'Select Git Repository' });
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
    toastSuccess('Repository removed');
  }
}

async function handleDiscoverRepos() {
  const found = await store.discoverRepos();
  if (found.length > 0) {
    loaded.value = true;
    toastSuccess(`Discovered ${found.length} repo${found.length > 1 ? 's' : ''}`);
    await store.loadAllWorktrees();
  } else {
    toastSuccess('No new repositories discovered');
  }
}

async function handleSelectRepo(repoPath: string | null) {
  selectedRepoPath.value = repoPath;
  selectedWorktree.value = null;
  worktreeDetails.value = null;

  if (repoPath) {
    store.currentRepoPath = repoPath;
    // Load branches for the selected repo (for create modal)
    store.loadBranches(repoPath);
  } else {
    store.currentRepoPath = '';
  }
  // Always load ALL worktrees so sidebar counts remain correct.
  // filteredWorktrees handles per-repo filtering in the view.
  await store.loadAllWorktrees();
}

/* ─── Worktree Actions ────────────────────────────────────────── */
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

async function openCreateModal() {
  store.error = null;
  newBranch.value = '';
  newBaseBranch.value = '';
  newTargetDir.value = '';

  // In per-repo mode use the selected repo; in "All Worktrees" mode default to first registered repo
  createModalRepoPath.value = selectedRepoPath.value ?? store.registeredRepos[0]?.path ?? '';

  if (selectedRepoPath.value) {
    store.currentRepoPath = selectedRepoPath.value;
  }
  showCreateModal.value = true;
  // Load default branch and set it as base branch default
  const repoPath = createModalRepoPath.value;
  if (repoPath) {
    store.loadBranches(repoPath);
    await loadDefaultBranch();
    newBaseBranch.value = defaultBranch.value;
  }
}

async function handleCreate() {
  if (!newBranch.value.trim()) return;
  const repoPath = createModalRepoPath.value;
  if (!repoPath) return;

  const request: CreateWorktreeRequest = {
    repoPath,
    branch: newBranch.value.trim(),
    baseBranch: newBaseBranch.value.trim() || defaultBranch.value || undefined,
    targetDir: newTargetDir.value.trim() || undefined,
  };
  const result = await store.addWorktree(request);
  if (result) {
    showCreateModal.value = false;
    prefsStore.addRecentRepoPath(repoPath);
    toastSuccess(`Created worktree: ${result.branch}`);
    // Hydrate disk usage for the new worktree
    store.hydrateDiskUsage(result.path);
  } else if (store.error) {
    // Error is displayed in the modal via store.error
    // No need to close modal - user can fix and retry
  }
}

async function onCreateRepoChange() {
  const repoPath = createModalRepoPath.value;
  if (!repoPath) return;
  store.loadBranches(repoPath);
  await loadDefaultBranch();
  newBaseBranch.value = defaultBranch.value;
}

async function confirmDelete(wt: WorktreeInfo) {
  store.error = null;
  const { confirmed, checked } = await confirm({
    title: 'Remove Worktree',
    message: `This will permanently remove the worktree and its working directory for "${wt.branch}". This action cannot be undone.`,
    variant: 'danger',
    confirmLabel: 'Remove',
    checkbox: 'Force delete (even if there are uncommitted changes)',
  });
  if (!confirmed) return;
  const ok = await store.deleteWorktree(wt.path, checked, wt.repoRoot);
  if (ok) {
    if (selectedWorktree.value?.path === wt.path) {
      selectedWorktree.value = null;
      worktreeDetails.value = null;
    }
    toastSuccess('Worktree removed');
  } else {
    await store.loadAllWorktrees();
    toastError(store.error || 'Failed to remove worktree');
  }
}

async function handlePrune() {
  pruneMessage.value = null;
  if (selectedRepoPath.value) {
    // Prune a specific repo
    const result = await store.prune(selectedRepoPath.value);
    if (result) {
      pruneMessage.value =
        result.prunedCount > 0
          ? `Pruned ${result.prunedCount} stale worktree(s).`
          : 'Nothing to prune — all worktrees are clean.';
    }
  } else {
    // Prune all registered repos
    let totalPruned = 0;
    for (const repo of store.registeredRepos) {
      const result = await store.prune(repo.path);
      if (result) totalPruned += result.prunedCount;
    }
    pruneMessage.value =
      totalPruned > 0
        ? `Pruned ${totalPruned} stale worktree(s) across all repos.`
        : 'Nothing to prune — all worktrees are clean.';
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

/* ─── Lock/Unlock ────────────────────────────────────────────── */
async function handleLockInline(wt: WorktreeInfo) {
  const ok = await store.lockWorktree(wt.path, undefined, wt.repoRoot);
  if (ok) {
    // Sync selectedWorktree immediately so the detail panel updates
    if (selectedWorktree.value?.path === wt.path) {
      selectedWorktree.value = { ...selectedWorktree.value, isLocked: true };
    }
    toastSuccess('Worktree locked');
  }
}

async function handleUnlock(wt: WorktreeInfo) {
  const ok = await store.unlockWorktree(wt.path, wt.repoRoot);
  if (ok) {
    if (selectedWorktree.value?.path === wt.path) {
      selectedWorktree.value = { ...selectedWorktree.value, isLocked: false, lockedReason: undefined };
    }
    toastSuccess('Worktree unlocked');
  }
}

async function handleFetchRemote() {
  // Note: This uses the performFetchRemote from useGitRepository composable
  // which operates on createModalRepoPath. For non-modal fetch, we would need
  // to temporarily update createModalRepoPath or add a second composable instance.
  // For now, this works for the create modal context.
  await performFetchRemote();
  // Reload branches after fetching
  const repoPath = createModalRepoPath.value;
  if (repoPath) {
    await store.loadBranches(repoPath);
  }
}

/* ─── Navigation ──────────────────────────────────────────────── */
function navigateToSession(sessionId: string) {
  router.push({ name: 'session-overview', params: { id: sessionId } });
}

function navigateToLauncher(wt: WorktreeInfo) {
  router.push({
    path: '/orchestration/launcher',
    query: { repoPath: wt.path, branch: wt.branch },
  });
}

/* ─── External Actions ────────────────────────────────────────── */
async function handleRefresh() {
  // In-place refresh: animate button, keep table visible, update data silently
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

/* ─── Watchers ────────────────────────────────────────────────── */
watch(() => store.worktrees, () => {
  if (selectedWorktree.value) {
    const still = store.worktrees.find((w) => w.path === selectedWorktree.value?.path);
    if (!still) {
      selectedWorktree.value = null;
      worktreeDetails.value = null;
    } else {
      selectedWorktree.value = still;
    }
  }
}, { deep: true });
</script>

<template>
  <div class="wt-manager">
    <!-- ─── LEFT PANEL ─────────────────────────────────────────── -->
    <aside class="left-panel">
      <div class="left-header">Repositories</div>

      <!-- Repo actions -->
      <div class="repo-actions">
        <button class="btn btn-primary btn-sm repo-action-btn" @click="handleAddRepo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add Repository
        </button>
        <button class="btn btn-sm repo-action-btn" @click="handleDiscoverRepos">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          Discover from Sessions
        </button>
      </div>

      <!-- Repo tree -->
      <div class="repo-tree">
        <template v-if="store.registeredRepos.length">
          <!-- All worktrees item -->
          <div
            class="tree-item"
            :class="{ 'tree-item--active': selectedRepoPath === null }"
            @click="handleSelectRepo(null)"
          >
            <span class="tree-item-label">All Worktrees</span>
            <span class="tree-count-badge">{{ store.worktreeCount }}</span>
          </div>

          <!-- Each registered repo -->
          <div
            v-for="repo in store.sortedRegisteredRepos"
            :key="repo.path"
            class="tree-item"
            :class="{ 'tree-item--active': selectedRepoPath === repo.path }"
            @click="handleSelectRepo(repo.path)"
          >
            <button
              class="tree-fav-btn"
              :class="{ 'tree-fav-btn--active': repo.favourite }"
              :title="repo.favourite ? 'Remove from favourites' : 'Add to favourites'"
              :disabled="store.togglingFavourites.has(repo.path)"
              @click.stop="store.toggleFavourite(repo.path)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" :fill="repo.favourite ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
            <svg class="tree-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span class="tree-item-label" :title="repo.path">{{ repo.name }}</span>
            <span class="tree-count-badge">{{ worktreeCountByRepo.get(repo.path) ?? 0 }}</span>
            <button
              class="tree-remove-btn"
              title="Remove repository"
              @click.stop="handleRemoveRepo(repo.path)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </template>

        <div v-else-if="!store.reposLoading" class="tree-empty">
          <svg class="tree-empty-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span>Add a repository to begin</span>
        </div>

        <div v-if="store.reposLoading" class="tree-empty">
          <LoadingSpinner size="sm" />
          <span>Loading repos…</span>
        </div>
      </div>

      <!-- Disk summary -->
      <div v-if="loaded && store.worktrees.length" class="disk-summary">
        <div class="disk-summary-row">
          <span class="disk-summary-label">Total Worktrees</span>
          <span class="disk-summary-value">{{ store.worktreeCount }}</span>
        </div>
        <div class="disk-summary-row">
          <span class="disk-summary-label">Active</span>
          <span class="disk-summary-value">{{ store.activeCount }}</span>
        </div>
        <div class="disk-summary-row">
          <span class="disk-summary-label">Stale</span>
          <span class="disk-summary-value disk-summary-value--stale">{{ store.staleCount }}</span>
        </div>
        <div class="disk-summary-row">
          <span class="disk-summary-label">Locked</span>
          <span class="disk-summary-value">{{ store.lockedCount }}</span>
        </div>
        <div class="disk-summary-row">
          <span class="disk-summary-label">Disk Usage</span>
          <span class="disk-summary-value">{{ formatBytes(totalDiskUsage) }}</span>
        </div>
        <div class="disk-summary-row">
          <span class="disk-summary-label">Reclaimable</span>
          <span class="disk-summary-value disk-summary-value--stale">{{ formatBytes(staleDiskUsage) }}</span>
        </div>
      </div>
    </aside>

    <!-- ─── RIGHT PANEL ────────────────────────────────────────── -->
    <main class="right-panel">
      <!-- Loading state (only on initial load, not refresh) -->
      <div v-if="store.loading && !loaded" class="empty-state">
        <LoadingSpinner size="md" />
        <span class="empty-state-text">Loading worktrees…</span>
      </div>

      <!-- Error state -->
      <div v-else-if="store.error && !loaded" class="empty-state empty-state--error">
        <svg class="empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--danger-fg)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span class="empty-state-text">{{ store.error }}</span>
        <button class="btn btn-sm" @click="handleLoad">Retry</button>
      </div>

      <!-- Not loaded -->
      <div v-else-if="!loaded" class="empty-state">
        <svg class="empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-placeholder)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span class="empty-state-title">No Repositories Registered</span>
        <span class="empty-state-text">Click <strong>Add Repository</strong> or <strong>Discover from Sessions</strong> in the sidebar to get started.</span>
      </div>

      <!-- Main content -->
      <template v-else>
        <!-- Toolbar -->
        <div class="toolbar">
          <button class="btn btn-primary btn-sm" @click="openCreateModal">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Create Worktree
          </button>
          <button
            class="btn btn-sm"
            :disabled="store.staleCount === 0 || cleaningStale"
            @click="handleCleanStale"
          >
            <LoadingSpinner v-if="cleaningStale" size="sm" />
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
            {{ cleaningStale ? 'Cleaning…' : 'Clean Stale' }}
          </button>
          <button class="btn btn-sm" @click="handlePrune">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            {{ selectedRepoPath ? 'Prune This Repo' : 'Prune All Repos' }}
          </button>
          <button class="btn btn-sm" @click="handleRefresh" :disabled="refreshing" :class="{ 'btn-refreshing': refreshing }">
            <svg :class="{ 'spin-animation': refreshing }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
            {{ refreshing ? 'Refreshing…' : 'Refresh' }}
          </button>

          <div class="toolbar-divider" />

          <div class="search-wrapper">
            <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              v-model="searchQuery"
              type="text"
              class="search-input"
              placeholder="Filter worktrees…"
            />
          </div>

          <div class="toolbar-summary">
            <span class="summary-item">Total: <strong>{{ store.worktreeCount }}</strong></span>
            <span class="summary-item summary-item--success">Active: <strong>{{ store.activeCount }}</strong></span>
            <span class="summary-item summary-item--warning">Stale: <strong>{{ store.staleCount }}</strong></span>
            <span class="summary-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              <strong>{{ store.lockedCount }}</strong>
            </span>
            <span class="summary-item">Disk: <strong>{{ formatBytes(totalDiskUsage) }}</strong></span>
          </div>
        </div>

        <!-- Prune message -->
        <div v-if="pruneMessage" class="prune-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          {{ pruneMessage }}
        </div>

        <!-- Stale warning banner -->
        <div v-if="store.staleCount > 0" class="stale-banner">
          <svg class="stale-banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span><strong>{{ store.staleCount }} stale worktree{{ store.staleCount > 1 ? 's' : '' }}</strong> — {{ formatBytes(staleDiskUsage) }} reclaimable</span>
          <button
            class="btn btn-sm stale-banner-btn"
            :disabled="cleaningStale"
            @click="handleCleanStale"
          >{{ cleaningStale ? 'Cleaning…' : 'Clean Now' }}</button>
        </div>

        <!-- Column headers (sortable) -->
        <div class="col-headers">
          <span />
          <span class="col-header-sortable" @click="store.setSortBy('branch')">
            Path / Branch {{ sortIcon('branch') }}
          </span>
          <span>Session</span>
          <span class="col-header-sortable" @click="store.setSortBy('diskUsageBytes')">
            Disk {{ sortIcon('diskUsageBytes') }}
          </span>
          <span class="col-header-sortable" @click="store.setSortBy('status')">
            Status {{ sortIcon('status') }}
          </span>
          <span class="col-header-sortable" @click="store.setSortBy('createdAt')">
            Created {{ sortIcon('createdAt') }}
          </span>
          <span>Actions</span>
        </div>

        <!-- Worktree rows -->
        <div class="wt-list">
          <div v-if="filteredWorktrees.length === 0" class="empty-rows">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-placeholder)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <span>{{ searchQuery ? 'No worktrees match your filter.' : 'No worktrees found.' }}</span>
          </div>

          <div
            v-for="wt in filteredWorktrees"
            :key="wt.path"
            class="wt-row"
            :class="{
              'wt-row--selected': selectedWorktree?.path === wt.path,
              'wt-row--stale': wt.status === 'stale',
            }"
            @click="selectWorktree(wt)"
          >
            <!-- Icon -->
            <div class="wt-row-icon" :class="wt.isMainWorktree ? 'wt-row-icon--main' : 'wt-row-icon--' + wt.status">
              <!-- Main worktree: folder-git icon -->
              <svg v-if="wt.isMainWorktree" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="15" r="2" />
              </svg>
              <!-- Linked worktree: git branch icon -->
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            </div>

            <!-- Branch + path -->
            <div class="wt-row-info">
              <div class="wt-row-branch-line">
                <span class="wt-row-branch">{{ wt.branch }}</span>
                <span v-if="wt.isMainWorktree" class="badge badge-main">Main</span>
              </div>
              <span class="wt-row-path" :title="wt.path">{{ wt.path }}</span>
            </div>

            <!-- Session -->
            <div class="wt-row-session">
              <span
                v-if="wt.linkedSessionId"
                class="session-link"
                @click.stop="navigateToSession(wt.linkedSessionId)"
              >{{ wt.linkedSessionId.slice(0, 8) }}</span>
              <span v-else class="session-none">No session</span>
            </div>

            <!-- Disk -->
            <div class="wt-row-disk">
              <div class="disk-mini-bar">
                <div class="disk-mini-fill" :style="{ width: diskBarPercent(wt) + '%', background: diskBarColor(wt) }" />
              </div>
              <span class="disk-label">{{ formatBytes(wt.diskUsageBytes) }}</span>
            </div>

            <!-- Status + Lock -->
            <div class="wt-row-status">
              <span class="badge" :class="'badge-' + wt.status">{{ wt.status }}</span>
              <svg
                v-if="wt.isLocked"
                class="lock-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                :title="wt.lockedReason ? `Locked: ${wt.lockedReason}` : 'Locked'"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>

            <!-- Created -->
            <div class="wt-row-created">{{ formatRelativeTime(wt.createdAt) }}</div>

            <!-- Actions -->
            <div class="wt-row-actions" @click.stop>
              <button class="icon-btn" title="Open Folder" @click="handleOpenExplorer(wt.path)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              </button>
              <button class="icon-btn" title="Open Terminal" @click="handleOpenTerminal(wt.path)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
              </button>
              <button class="icon-btn" title="Launch Session Here" @click="navigateToLauncher(wt)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              </button>
              <button
                class="icon-btn"
                :title="wt.isMainWorktree ? 'Cannot lock main worktree' : wt.isLocked ? 'Unlock Worktree' : 'Lock Worktree'"
                :disabled="wt.isMainWorktree"
                @click="wt.isLocked ? handleUnlock(wt) : handleLockInline(wt)"
              >
                <svg v-if="wt.isLocked" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5" /></svg>
                <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </button>
              <button
                class="icon-btn icon-btn--danger"
                :title="wt.isMainWorktree ? 'Cannot remove main worktree' : wt.isLocked ? 'Unlock to remove' : 'Remove'"
                :disabled="wt.isMainWorktree || wt.isLocked"
                @click="confirmDelete(wt)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Detail panel -->
        <div class="detail-panel" :class="{ 'detail-panel--open': selectedWorktree }">
          <template v-if="selectedWorktree">
            <div class="detail-header">
              <div class="detail-header-left">
                <div class="wt-row-icon" :class="selectedWorktree.isMainWorktree ? 'wt-row-icon--main' : 'wt-row-icon--' + selectedWorktree.status">
                  <svg v-if="selectedWorktree.isMainWorktree" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="15" r="2" />
                  </svg>
                  <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                </div>
                <span class="detail-branch">{{ selectedWorktree.branch }}</span>
                <span class="badge" :class="'badge-' + selectedWorktree.status">{{ selectedWorktree.status }}</span>
                <span v-if="selectedWorktree.isLocked" class="badge badge-locked" :title="selectedWorktree.lockedReason">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  locked
                </span>
              </div>
              <button class="icon-btn" @click="selectedWorktree = null; worktreeDetails = null">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-item-label">Repository</span>
                <span class="detail-item-value">{{ selectedWorktree.repoRoot }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-item-label">Branch</span>
                <span class="detail-item-value">{{ selectedWorktree.branch }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-item-label">Path</span>
                <span class="detail-item-value detail-item-value--mono">{{ selectedWorktree.path }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-item-label">Disk Usage</span>
                <span class="detail-item-value">{{ formatBytes(selectedWorktree.diskUsageBytes) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-item-label">Session</span>
                <span class="detail-item-value">
                  <span
                    v-if="selectedWorktree.linkedSessionId"
                    class="session-link"
                    @click="navigateToSession(selectedWorktree.linkedSessionId!)"
                  >{{ selectedWorktree.linkedSessionId }}</span>
                  <span v-else>—</span>
                </span>
              </div>
              <div class="detail-item">
                <span class="detail-item-label">Created</span>
                <span class="detail-item-value">{{ formatRelativeTime(selectedWorktree.createdAt) }}</span>
              </div>
              <!-- On-demand details -->
              <template v-if="detailsLoading">
                <div class="detail-item">
                  <span class="detail-item-label">Details</span>
                  <span class="detail-item-value"><LoadingSpinner size="sm" /> Loading…</span>
                </div>
              </template>
              <template v-else-if="worktreeDetails">
                <div class="detail-item">
                  <span class="detail-item-label">Uncommitted</span>
                  <span class="detail-item-value">{{ worktreeDetails.uncommittedCount }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-item-label">Ahead / Behind</span>
                  <span class="detail-item-value">{{ worktreeDetails.ahead }} ↑ / {{ worktreeDetails.behind }} ↓</span>
                </div>
              </template>
              <template v-if="selectedWorktree.isLocked && selectedWorktree.lockedReason">
                <div class="detail-item">
                  <span class="detail-item-label">Lock Reason</span>
                  <span class="detail-item-value">{{ selectedWorktree.lockedReason }}</span>
                </div>
              </template>
            </div>

            <div class="detail-actions">
              <button class="btn btn-sm" @click="handleOpenExplorer(selectedWorktree!.path)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                Open Folder
              </button>
              <button class="btn btn-sm" @click="handleOpenTerminal(selectedWorktree!.path)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
                Open Terminal
              </button>
              <button class="btn btn-sm" @click="navigateToLauncher(selectedWorktree!)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                Launch Session Here
              </button>
              <button
                v-if="selectedWorktree.linkedSessionId"
                class="btn btn-sm"
                @click="navigateToSession(selectedWorktree.linkedSessionId!)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
                View Session
              </button>
              <button
                class="btn btn-sm"
                :disabled="selectedWorktree.isMainWorktree"
                :title="selectedWorktree.isMainWorktree ? 'Cannot lock main worktree' : selectedWorktree.isLocked ? 'Unlock' : 'Lock'"
                @click="selectedWorktree!.isLocked ? handleUnlock(selectedWorktree!) : handleLockInline(selectedWorktree!)"
              >
                <svg v-if="selectedWorktree.isLocked" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5" /></svg>
                <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                {{ selectedWorktree.isLocked ? 'Unlock' : 'Lock' }}
              </button>
              <button
                class="btn btn-sm btn-danger"
                :disabled="selectedWorktree.isMainWorktree || selectedWorktree.isLocked"
                :title="selectedWorktree.isMainWorktree ? 'Cannot remove main worktree' : selectedWorktree.isLocked ? 'Unlock to remove' : 'Remove worktree'"
                @click="confirmDelete(selectedWorktree!)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                Remove
              </button>
            </div>
          </template>
        </div>
      </template>
    </main>

    <!-- ─── Create Worktree Modal ──────────────────────────────── -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
          <div class="modal-dialog" role="dialog" aria-labelledby="create-wt-title">
            <div class="modal-header">
              <h2 id="create-wt-title" class="modal-title">Create Worktree</h2>
              <button class="icon-btn" aria-label="Close" @click="showCreateModal = false">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div class="modal-body">
              <div v-if="store.error" class="modal-error">{{ store.error }}</div>
              <div class="form-group">
                <label class="form-label" for="cw-repo">Repository</label>
                <input
                  v-if="selectedRepoPath"
                  id="cw-repo"
                  type="text"
                  class="form-input"
                  :value="selectedRepoPath"
                  readonly
                />
                <select
                  v-else
                  id="cw-repo"
                  v-model="createModalRepoPath"
                  class="form-input"
                  @change="onCreateRepoChange"
                >
                  <option value="" disabled>Select a repository…</option>
                  <option v-for="repo in store.registeredRepos" :key="repo.path" :value="repo.path">
                    {{ repo.name }} — {{ repo.path }}
                  </option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" for="cw-base">Base Branch</label>
                <SearchableSelect
                  v-model="newBaseBranch"
                  :options="store.branches"
                  :placeholder="defaultBranch || 'Current HEAD'"
                  clearable
                />
              </div>

              <div class="form-group form-group--inline">
                <button
                  class="btn btn-sm"
                  :disabled="fetchingRemote"
                  @click="handleFetchRemote"
                >
                  <LoadingSpinner v-if="fetchingRemote" size="sm" />
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                  {{ fetchingRemote ? 'Fetching…' : 'Fetch Latest from Remote' }}
                </button>
              </div>

              <div class="form-group">
                <label class="form-label" for="cw-branch">New Branch Name</label>
                <input
                  id="cw-branch"
                  v-model="newBranch"
                  type="text"
                  class="form-input"
                  placeholder="feature/my-branch"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="cw-path">Worktree Path</label>
                <input
                  id="cw-path"
                  type="text"
                  class="form-input form-input--mono"
                  :value="computedWorktreePath"
                  readonly
                />
              </div>

              <div class="modal-tip">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-fg)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                <span>A worktree lets you check out a branch in a separate directory so you can work on multiple branches simultaneously without stashing changes.</span>
              </div>
            </div>

            <div class="modal-footer">
              <button class="btn btn-sm" @click="showCreateModal = false">Cancel</button>
              <button class="btn btn-primary btn-sm" :disabled="!newBranch.trim() || !createModalRepoPath" @click="handleCreate">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Create Worktree
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped>
/* ─── Layout Shell ────────────────────────────────────────────── */
.wt-manager {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 0;
  height: 100%;
  min-height: 0;
  background: var(--canvas-default);
  font-family: var(--font-family);
  color: var(--text-primary);
}

/* ─── Left Panel ──────────────────────────────────────────────── */
.left-panel {
  display: flex;
  flex-direction: column;
  background: var(--canvas-inset);
  border-right: 1px solid var(--border-default);
  min-height: 0;
  overflow: hidden;
}

.left-header {
  padding: 12px 14px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}

.repo-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 12px 8px;
}

.repo-action-btn {
  width: 100%;
  justify-content: center;
}

.repo-tree {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  cursor: pointer;
  position: relative;
  transition: background var(--transition-fast);
}

.tree-item:hover {
  background: var(--neutral-subtle);
}

.tree-item--active {
  background: var(--accent-subtle);
}

.tree-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent-emphasis);
}

.tree-item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-icon {
  flex-shrink: 0;
  opacity: 0.6;
}

.tree-item--active .tree-icon {
  opacity: 1;
}

.tree-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  font-size: 0.6875rem;
  font-weight: 700;
  background: var(--neutral-muted);
  color: var(--text-secondary);
  border-radius: 9px;
  padding: 0 6px;
}

.tree-fav-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: color 0.15s ease;
}

.tree-fav-btn--active {
  display: flex;
  color: var(--warning-fg);
}

.tree-item:hover .tree-fav-btn {
  display: flex;
}

.tree-fav-btn:hover {
  color: var(--warning-fg);
}

.tree-remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--text-placeholder);
  border-radius: var(--radius-sm);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}

.tree-item:hover .tree-remove-btn {
  opacity: 1;
}

.tree-remove-btn:hover {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}

.tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  color: var(--text-placeholder);
  font-size: 0.75rem;
  text-align: center;
}

.tree-empty-icon {
  opacity: 0.4;
}

/* Disk summary */
.disk-summary {
  border-top: 1px solid var(--border-default);
  padding: 12px 14px;
}

.disk-summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
}

.disk-summary-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.disk-summary-value {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.disk-summary-value--stale {
  color: var(--warning-fg);
}

/* ─── Right Panel ─────────────────────────────────────────────── */
.right-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* Empty / loading / error states */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  padding: 48px 24px;
  text-align: center;
}

.empty-state-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}

.empty-state-text {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  max-width: 320px;
  line-height: 1.5;
}

.empty-icon {
  opacity: 0.5;
}

/* ─── Toolbar ─────────────────────────────────────────────────── */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: var(--canvas-subtle);
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--border-default);
  flex-shrink: 0;
}

.search-wrapper {
  position: relative;
  max-width: 220px;
}

.search-icon {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-placeholder);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 5px 10px 5px 30px;
  font-size: 0.75rem;
  font-family: var(--font-family);
  background: var(--canvas-default);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color var(--transition-fast);
}

.search-input:focus {
  border-color: var(--accent-fg);
}

.search-input::placeholder {
  color: var(--text-placeholder);
}

.toolbar-summary {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
  flex-shrink: 0;
}

.summary-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.summary-item strong {
  color: var(--text-secondary);
}

.summary-item--success strong {
  color: var(--success-fg);
}

.summary-item--warning strong {
  color: var(--warning-fg);
}

/* ─── Prune banner ────────────────────────────────────────────── */
.prune-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  background: var(--success-subtle);
  border-bottom: 1px solid var(--success-muted);
  font-size: 0.75rem;
  color: var(--success-fg);
  flex-shrink: 0;
}

/* ─── Stale Warning Banner ────────────────────────────────────── */
.stale-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  background: var(--warning-subtle);
  border-bottom: 1px solid var(--warning-muted);
  font-size: 0.75rem;
  color: var(--warning-fg);
  flex-shrink: 0;
}

.stale-banner-icon {
  flex-shrink: 0;
}

.stale-banner-btn {
  margin-left: auto;
  color: var(--warning-fg);
  border-color: var(--warning-fg);
}

.stale-banner-btn:hover {
  background: var(--warning-muted);
}

/* ─── Column Headers ──────────────────────────────────────────── */
.col-headers {
  display: grid;
  grid-template-columns: 32px 1.4fr 120px 110px 100px 80px 140px;
  gap: 0;
  padding: 8px 18px;
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-tertiary);
  background: var(--canvas-inset);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.col-header-sortable {
  cursor: pointer;
  user-select: none;
  transition: color var(--transition-fast);
}

.col-header-sortable:hover {
  color: var(--text-primary);
}

/* ─── Worktree List ───────────────────────────────────────────── */
.wt-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.empty-rows {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
  color: var(--text-placeholder);
  font-size: 0.8125rem;
}

.wt-row {
  display: grid;
  grid-template-columns: 32px 1.4fr 120px 110px 100px 80px 140px;
  gap: 0;
  align-items: center;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background var(--transition-fast);
  position: relative;
}

.wt-row:hover {
  background: var(--neutral-subtle);
}

.wt-row--selected {
  background: var(--accent-subtle);
}

.wt-row--selected::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent-emphasis);
}

.wt-row--stale:not(.wt-row--selected)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--warning-fg);
}

/* Row icon */
.wt-row-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}

.wt-row-icon--active {
  background: var(--success-muted);
  color: var(--success-fg);
}

.wt-row-icon--stale {
  background: var(--warning-muted);
  color: var(--warning-fg);
}

/* Row info */
.wt-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-left: 4px;
}

.wt-row-branch {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wt-row-path {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Session */
.wt-row-session {
  font-size: 0.75rem;
}

.session-link {
  color: var(--accent-fg);
  cursor: pointer;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.6875rem;
}

.session-link:hover {
  text-decoration: underline;
}

.session-none {
  color: var(--text-placeholder);
  font-style: italic;
  font-size: 0.75rem;
}

/* Disk */
.wt-row-disk {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.disk-mini-bar {
  width: 60px;
  height: 6px;
  background: var(--neutral-muted);
  border-radius: 3px;
  overflow: hidden;
}

.disk-mini-fill {
  height: 100%;
  border-radius: 3px;
  transition: width var(--transition-normal);
}

.disk-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* Status badge */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 0.6875rem;
  font-weight: 600;
  border-radius: var(--radius-full, 9999px);
  text-transform: capitalize;
  letter-spacing: 0.02em;
}

.badge-active {
  color: var(--success-fg);
  background: var(--success-subtle);
  border: 1px solid var(--success-muted);
}

.badge-stale {
  color: var(--warning-fg);
  background: var(--warning-subtle);
  border: 1px solid var(--warning-muted);
}

.badge-locked {
  color: var(--text-secondary);
  background: var(--neutral-muted);
  border: 1px solid var(--border-default);
}

/* Lock icon in row */
.wt-row-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lock-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* Created */
.wt-row-created {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

/* Actions */
.wt-row-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.icon-btn:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.icon-btn--danger:hover {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}

.icon-btn:disabled,
.icon-btn[disabled] {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: auto;
}
.icon-btn:disabled:hover,
.icon-btn[disabled]:hover {
  background: transparent;
  color: var(--text-tertiary);
}

.icon-btn-spacer {
  display: inline-block;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}

/* ─── Detail Panel ────────────────────────────────────────────── */
.detail-panel {
  border-top: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  max-height: 0;
  overflow: hidden;
  transition: max-height var(--transition-slow);
  flex-shrink: 0;
}

.detail-panel--open {
  max-height: 500px;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border-subtle);
}

.detail-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-branch {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  padding: 14px 18px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-item-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.detail-item-value {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-item-value--mono {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.75rem;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 18px 14px;
}

/* ─── Buttons ─────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 0.8125rem;
  font-weight: 600;
  font-family: var(--font-family);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast), opacity var(--transition-fast);
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  background: var(--neutral-subtle);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent-emphasis);
  color: var(--text-inverse);
  border-color: var(--accent-emphasis);
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
  background: var(--accent-emphasis);
}

.btn-sm {
  padding: 4px 10px;
  font-size: 0.75rem;
}

.btn-danger {
  background: var(--danger-emphasis);
  color: var(--text-inverse);
  border-color: var(--danger-emphasis);
}

.btn-danger:hover:not(:disabled) {
  opacity: 0.9;
  background: var(--danger-emphasis);
}

/* ─── Form Inputs ─────────────────────────────────────────────── */
.form-input {
  width: 100%;
  max-width: 100%;
  padding: 8px 12px;
  font-size: 0.8125rem;
  font-family: var(--font-family);
  background: var(--canvas-default);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color var(--transition-fast);
  overflow: hidden;
  text-overflow: ellipsis;
}

.form-input:focus {
  border-color: var(--accent-fg);
}

.form-input::placeholder {
  color: var(--text-placeholder);
}

.form-input[readonly] {
  color: var(--text-tertiary);
  cursor: default;
}

.form-input--sm {
  padding: 5px 8px;
  font-size: 0.75rem;
}

.form-input--mono {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.75rem;
}

/* ─── Modal ───────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 70);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
}

.modal-dialog {
  width: 100%;
  max-width: 520px;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-default);
}

.modal-title {
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.modal-title--danger {
  color: var(--danger-fg);
}

.modal-body {
  padding: 20px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-default);
}

.form-group {
  margin-bottom: 14px;
}

.form-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.modal-tip {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: var(--accent-subtle);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-top: 4px;
}

.modal-tip svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.modal-error {
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--danger-subtle);
  border: 1px solid var(--danger-muted);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  color: var(--danger-fg);
}

/* ─── Modal Transition ────────────────────────────────────────── */
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--transition-normal);
}

.modal-enter-active .modal-dialog,
.modal-leave-active .modal-dialog {
  transition: transform var(--transition-normal);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-dialog {
  transform: scale(0.96) translateY(8px);
}

.modal-leave-to .modal-dialog {
  transform: scale(0.96) translateY(8px);
}

.spin-animation {
  animation: spin 0.8s linear infinite;
}

.btn-refreshing {
  opacity: 0.7;
}

.wt-row-icon--main {
  background: var(--accent-muted);
  color: var(--accent-fg);
}

.badge-main {
  color: var(--accent-fg);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-muted);
  font-size: 0.625rem;
  padding: 1px 6px;
}

.wt-row-branch-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.form-group--inline {
  display: flex;
  align-items: center;
}

.modal-error-hint {
  margin-top: 8px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  padding: 8px 10px;
  background: var(--neutral-subtle);
  border-radius: var(--radius-sm);
  line-height: 1.5;
}
</style>
