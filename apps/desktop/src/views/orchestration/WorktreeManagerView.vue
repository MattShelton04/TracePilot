<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import type { CreateWorktreeRequest, WorktreeInfo, WorktreeDetails } from '@tracepilot/types';
import { openInExplorer, openInTerminal } from '@tracepilot/client';
import { useWorktreesStore } from '@/stores/worktrees';
import { usePreferencesStore } from '@/stores/preferences';
import { browseForDirectory } from '@/composables/useBrowseDirectory';

const router = useRouter();
const store = useWorktreesStore();
const prefsStore = usePreferencesStore();

/* ─── Local State ─────────────────────────────────────────────── */
const loaded = ref(false);
const searchQuery = ref('');
const selectedWorktree = ref<WorktreeInfo | null>(null);
const selectedRepoPath = ref<string | null>(null);
const showCreateModal = ref(false);
const showDeleteModal = ref(false);
const deleteTarget = ref<WorktreeInfo | null>(null);
const forceDelete = ref(false);
const pruneMessage = ref<string | null>(null);
const cleaningStale = ref(false);
const actionToast = ref<string | null>(null);
const worktreeDetails = ref<WorktreeDetails | null>(null);
const detailsLoading = ref(false);

// Create form state
const newBranch = ref('');
const newBaseBranch = ref('');
const newTargetDir = ref('');

// Lock form
const lockReason = ref('');
const showLockModal = ref(false);
const lockTarget = ref<WorktreeInfo | null>(null);

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
  Math.max(...store.worktrees.map((w) => w.diskUsageBytes ?? 0), 1),
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
  const repoPath = selectedRepoPath.value || store.currentRepoPath;
  if (!repoPath) return '';
  const base = repoPath.replace(/\\/g, '/').replace(/\/$/, '');
  const parent = base.split('/').slice(0, -1).join('/');
  const sanitized = newBranch.value.trim().replace(/\//g, '-');
  return `${parent}/${sanitized}`;
});

/* ─── Helpers ─────────────────────────────────────────────────── */
function formatBytes(bytes?: number): string {
  if (bytes == null || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '—';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.floor(diffDay / 30);
  return `${diffMon}mo ago`;
}

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

function showToast(message: string, duration = 3000) {
  actionToast.value = message;
  setTimeout(() => { actionToast.value = null; }, duration);
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
      showToast(`Added ${result.name}`);
      loaded.value = true;
      await store.loadAllWorktrees();
    } else if (store.error) {
      showToast(store.error);
    }
  }
}

async function handleRemoveRepo(path: string) {
  const ok = await store.removeRepo(path);
  if (ok) {
    if (selectedRepoPath.value === path) {
      selectedRepoPath.value = null;
    }
    showToast('Repository removed');
  }
}

async function handleDiscoverRepos() {
  const found = await store.discoverRepos();
  if (found.length > 0) {
    loaded.value = true;
    showToast(`Discovered ${found.length} repo${found.length > 1 ? 's' : ''}`);
    await store.loadAllWorktrees();
  } else {
    showToast('No new repositories discovered');
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

function openCreateModal() {
  newBranch.value = '';
  newBaseBranch.value = '';
  newTargetDir.value = '';
  if (selectedRepoPath.value) {
    store.currentRepoPath = selectedRepoPath.value;
  }
  showCreateModal.value = true;
}

async function handleCreate() {
  if (!newBranch.value.trim()) return;
  const repoPath = selectedRepoPath.value || store.currentRepoPath;
  if (!repoPath) return;

  const request: CreateWorktreeRequest = {
    repoPath,
    branch: newBranch.value.trim(),
    baseBranch: newBaseBranch.value.trim() || undefined,
    targetDir: newTargetDir.value.trim() || undefined,
  };
  const result = await store.addWorktree(request);
  if (result) {
    showCreateModal.value = false;
    prefsStore.addRecentRepoPath(repoPath);
  }
}

function confirmDelete(wt: WorktreeInfo) {
  deleteTarget.value = wt;
  forceDelete.value = false;
  showDeleteModal.value = true;
}

async function handleDelete() {
  if (!deleteTarget.value) return;
  const ok = await store.deleteWorktree(
    deleteTarget.value.path,
    forceDelete.value,
    deleteTarget.value.repoRoot,
  );
  if (ok) {
    if (selectedWorktree.value?.path === deleteTarget.value.path) {
      selectedWorktree.value = null;
      worktreeDetails.value = null;
    }
    showDeleteModal.value = false;
    deleteTarget.value = null;
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
function openLockModal(wt: WorktreeInfo) {
  lockTarget.value = wt;
  lockReason.value = '';
  showLockModal.value = true;
}

async function handleLock() {
  if (!lockTarget.value) return;
  const ok = await store.lockWorktree(
    lockTarget.value.path,
    lockReason.value.trim() || undefined,
    lockTarget.value.repoRoot,
  );
  if (ok) {
    showLockModal.value = false;
    showToast('Worktree locked');
  }
}

async function handleUnlock(wt: WorktreeInfo) {
  const ok = await store.unlockWorktree(wt.path, wt.repoRoot);
  if (ok) {
    showToast('Worktree unlocked');
  }
}

/* ─── Navigation ──────────────────────────────────────────────── */
function navigateToSession(sessionId: string) {
  router.push({ name: 'session-overview', params: { id: sessionId } });
}

function navigateToLauncher(wt: WorktreeInfo) {
  router.push({
    path: '/orchestration/launcher',
    query: { repoPath: wt.repoRoot, branch: wt.branch },
  });
}

/* ─── External Actions ────────────────────────────────────────── */
async function handleOpenExplorer(path: string) {
  try {
    await openInExplorer(path);
  } catch (e) {
    showToast(`Failed to open folder: ${e}`);
  }
}

async function handleOpenTerminal(path: string) {
  try {
    await openInTerminal(path);
  } catch (e) {
    showToast(`Failed to open terminal: ${e}`);
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
});
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
            v-for="repo in store.registeredRepos"
            :key="repo.path"
            class="tree-item"
            :class="{ 'tree-item--active': selectedRepoPath === repo.path }"
            @click="handleSelectRepo(repo.path)"
          >
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
          <span class="spinner spinner--sm" />
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
      <!-- Loading state -->
      <div v-if="store.loading" class="empty-state">
        <span class="spinner" />
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
            <span v-if="cleaningStale" class="spinner spinner--sm" />
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
            {{ cleaningStale ? 'Cleaning…' : 'Clean Stale' }}
          </button>
          <button class="btn btn-sm" @click="handlePrune">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            Prune
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
            <div class="wt-row-icon" :class="'wt-row-icon--' + wt.status">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            </div>

            <!-- Branch + path -->
            <div class="wt-row-info">
              <span class="wt-row-branch">{{ wt.branch }}</span>
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
              <button
                v-if="!wt.isLocked"
                class="icon-btn"
                title="Lock Worktree"
                @click="openLockModal(wt)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </button>
              <button
                v-else
                class="icon-btn"
                title="Unlock Worktree"
                @click="handleUnlock(wt)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5" /></svg>
              </button>
              <button class="icon-btn icon-btn--danger" title="Remove" @click="confirmDelete(wt)">
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
                <div class="wt-row-icon" :class="'wt-row-icon--' + selectedWorktree.status">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
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
                  <span class="detail-item-value"><span class="spinner spinner--sm" /> Loading…</span>
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
                v-if="!selectedWorktree.isLocked"
                class="btn btn-sm"
                @click="openLockModal(selectedWorktree!)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                Lock
              </button>
              <button
                v-else
                class="btn btn-sm"
                @click="handleUnlock(selectedWorktree!)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5" /></svg>
                Unlock
              </button>
              <button class="btn btn-sm btn-danger" @click="confirmDelete(selectedWorktree!)">
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
              <div class="form-group">
                <label class="form-label" for="cw-repo">Repository</label>
                <input
                  id="cw-repo"
                  type="text"
                  class="form-input"
                  :value="selectedRepoPath || store.currentRepoPath"
                  readonly
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="cw-base">Base Branch</label>
                <select
                  v-if="store.branches.length"
                  id="cw-base"
                  v-model="newBaseBranch"
                  class="form-input"
                >
                  <option value="">Current HEAD</option>
                  <option v-for="b in store.branches" :key="b" :value="b">{{ b }}</option>
                </select>
                <input
                  v-else
                  id="cw-base"
                  v-model="newBaseBranch"
                  type="text"
                  class="form-input"
                  placeholder="main"
                />
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

              <div v-if="store.error" class="modal-error">{{ store.error }}</div>
            </div>

            <div class="modal-footer">
              <button class="btn btn-sm" @click="showCreateModal = false">Cancel</button>
              <button class="btn btn-primary btn-sm" :disabled="!newBranch.trim()" @click="handleCreate">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Create Worktree
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ─── Delete Confirmation Modal ──────────────────────────── -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showDeleteModal" class="modal-overlay" @click.self="showDeleteModal = false">
          <div class="modal-dialog modal-dialog--sm" role="alertdialog" aria-labelledby="delete-wt-title">
            <div class="modal-header">
              <h2 id="delete-wt-title" class="modal-title modal-title--danger">Remove Worktree</h2>
              <button class="icon-btn" aria-label="Close" @click="showDeleteModal = false">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div class="modal-body">
              <p class="delete-warning-text">This will permanently remove the worktree and its working directory. This action cannot be undone.</p>
              <div v-if="deleteTarget" class="delete-target-box">
                <div class="delete-target-branch">{{ deleteTarget.branch }}</div>
                <div class="delete-target-path">{{ deleteTarget.path }}</div>
              </div>

              <label class="force-delete-label">
                <input v-model="forceDelete" type="checkbox" class="force-delete-checkbox" />
                <span>Force delete (even if there are uncommitted changes)</span>
              </label>

              <div v-if="store.error" class="modal-error">{{ store.error }}</div>
            </div>

            <div class="modal-footer">
              <button class="btn btn-sm" @click="showDeleteModal = false">Cancel</button>
              <button class="btn btn-sm btn-danger" @click="handleDelete">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                {{ forceDelete ? 'Force Remove' : 'Remove' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ─── Lock Worktree Modal ────────────────────────────────── -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showLockModal" class="modal-overlay" @click.self="showLockModal = false">
          <div class="modal-dialog modal-dialog--sm" role="dialog" aria-labelledby="lock-wt-title">
            <div class="modal-header">
              <h2 id="lock-wt-title" class="modal-title">Lock Worktree</h2>
              <button class="icon-btn" aria-label="Close" @click="showLockModal = false">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div class="modal-body">
              <p class="delete-warning-text">Locking a worktree prevents it from being pruned or accidentally deleted.</p>
              <div v-if="lockTarget" class="delete-target-box" style="border-color: var(--accent-muted); background: var(--accent-subtle);">
                <div class="delete-target-branch">{{ lockTarget.branch }}</div>
                <div class="delete-target-path">{{ lockTarget.path }}</div>
              </div>
              <div class="form-group" style="margin-top: 12px;">
                <label class="form-label" for="lock-reason">Reason (optional)</label>
                <input
                  id="lock-reason"
                  v-model="lockReason"
                  type="text"
                  class="form-input"
                  placeholder="e.g. Active development, do not prune"
                />
              </div>
              <div v-if="store.error" class="modal-error">{{ store.error }}</div>
            </div>

            <div class="modal-footer">
              <button class="btn btn-sm" @click="showLockModal = false">Cancel</button>
              <button class="btn btn-primary btn-sm" @click="handleLock">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                Lock
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ─── Toast Notification ───────────────────────────────────── -->
    <Transition name="toast">
      <div v-if="actionToast" class="toast-notification">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
        {{ actionToast }}
      </div>
    </Transition>
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

.spinner {
  display: inline-block;
  width: 24px;
  height: 24px;
  border: 2.5px solid var(--border-default);
  border-top-color: var(--accent-fg);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner--sm {
  width: 14px;
  height: 14px;
  border-width: 2px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
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
  max-height: 340px;
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
  padding: 8px 12px;
  font-size: 0.8125rem;
  font-family: var(--font-family);
  background: var(--canvas-default);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color var(--transition-fast);
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

/* ─── Force Delete Checkbox ───────────────────────────────────── */
.force-delete-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.force-delete-checkbox {
  accent-color: var(--danger-fg);
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

.modal-dialog--sm {
  max-width: 420px;
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

/* Delete modal */
.delete-warning-text {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 14px;
}

.delete-target-box {
  padding: 10px 14px;
  background: var(--danger-subtle);
  border: 1px solid var(--danger-muted);
  border-radius: var(--radius-sm);
}

.delete-target-branch {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.delete-target-path {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  margin-top: 4px;
  word-break: break-all;
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

/* ─── Toast Notification ──────────────────────────────────────── */
.toast-notification {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 9999;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
