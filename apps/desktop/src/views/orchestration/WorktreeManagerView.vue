<script setup lang="ts">
import { ref, computed } from 'vue';
import type { CreateWorktreeRequest, WorktreeInfo } from '@tracepilot/types';
import { useWorktreesStore } from '@/stores/worktrees';

const store = useWorktreesStore();

// Local state
const repoPathInput = ref('');
const loaded = ref(false);
const showCreateModal = ref(false);
const pruneMessage = ref<string | null>(null);

// Create form state
const newBranch = ref('');
const newBaseBranch = ref('');
const newTargetDir = ref('');

// Computed
const totalDiskUsage = computed(() =>
  store.worktrees.reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0),
);
const activeCount = computed(() =>
  store.worktrees.filter((w) => w.status === 'active').length,
);

// Helpers
function formatBytes(bytes?: number): string {
  if (bytes == null || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function shortCommit(hash: string): string {
  return hash ? hash.slice(0, 8) : '—';
}

function statusClass(status: WorktreeInfo['status']): string {
  if (status === 'active') return 'badge badge-success';
  if (status === 'stale') return 'badge badge-warning';
  return 'badge badge-muted';
}

// Actions
async function handleLoad() {
  const path = repoPathInput.value.trim();
  if (!path) return;
  pruneMessage.value = null;
  await Promise.all([store.loadWorktrees(path), store.loadBranches(path)]);
  loaded.value = true;
}

function openCreateModal() {
  newBranch.value = '';
  newBaseBranch.value = '';
  newTargetDir.value = '';
  showCreateModal.value = true;
}

async function handleCreate() {
  if (!newBranch.value.trim()) return;
  const request: CreateWorktreeRequest = {
    repoPath: store.currentRepoPath,
    branch: newBranch.value.trim(),
    baseBranch: newBaseBranch.value.trim() || undefined,
    targetDir: newTargetDir.value.trim() || undefined,
  };
  const result = await store.addWorktree(request);
  if (result) {
    showCreateModal.value = false;
  }
}

async function handleDelete(wt: WorktreeInfo) {
  const confirmed = confirm(`Delete worktree on branch "${wt.branch}" at ${wt.path}?`);
  if (!confirmed) return;
  await store.deleteWorktree(wt.path);
}

async function handlePrune() {
  pruneMessage.value = null;
  const result = await store.prune();
  if (result) {
    pruneMessage.value =
      result.prunedCount > 0
        ? `Pruned ${result.prunedCount} stale worktree(s).`
        : 'Nothing to prune — all worktrees are clean.';
  }
}
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- Header -->
      <header class="wt-header">
        <div>
          <h1 class="page-title">Worktree Manager</h1>
          <p class="page-subtitle">Create, inspect, and manage Git worktrees for parallel development sessions.</p>
        </div>
      </header>

      <!-- Repo path input -->
      <div class="repo-input-bar">
        <label class="repo-input-label" for="repo-path">Repository Path</label>
        <div class="repo-input-row">
          <input
            id="repo-path"
            v-model="repoPathInput"
            type="text"
            class="repo-input"
            placeholder="/home/user/my-project"
            @keydown.enter="handleLoad"
          />
          <button class="btn btn-primary" :disabled="!repoPathInput.trim() || store.loading" @click="handleLoad">
            {{ store.loading ? 'Loading…' : 'Load' }}
          </button>
        </div>
      </div>

      <!-- Loading state -->
      <div v-if="store.loading" class="empty-state">
        <div class="empty-state-icon">
          <span class="spinner" />
        </div>
        <h2 class="empty-state-title">Loading worktrees…</h2>
      </div>

      <!-- Error state -->
      <div v-else-if="store.error" class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <h2 class="empty-state-title">Error</h2>
        <p class="empty-state-desc">{{ store.error }}</p>
      </div>

      <!-- Empty / not loaded -->
      <div v-else-if="!loaded" class="empty-state">
        <div class="empty-state-icon">📂</div>
        <h2 class="empty-state-title">No Repository Loaded</h2>
        <p class="empty-state-desc">Enter a repository path above and click <strong>Load</strong> to get started.</p>
      </div>

      <!-- Main content -->
      <template v-else>
        <!-- Stats bar -->
        <div class="grid-3 stats-bar">
          <div class="stat-card">
            <div class="stat-card-value">{{ store.worktreeCount }}</div>
            <div class="stat-card-label">Total Worktrees</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value success">{{ activeCount }}</div>
            <div class="stat-card-label">Active</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">{{ formatBytes(totalDiskUsage) }}</div>
            <div class="stat-card-label">Total Disk Usage</div>
          </div>
        </div>

        <!-- Main worktree card -->
        <section v-if="store.mainWorktree" class="main-wt-card" aria-label="Main worktree">
          <div class="main-wt-badge">Primary</div>
          <div class="main-wt-body">
            <div class="main-wt-branch">{{ store.mainWorktree.branch }}</div>
            <div class="main-wt-meta">
              <span class="meta-item"><span class="meta-label">Path</span> {{ store.mainWorktree.path }}</span>
              <span class="meta-item"><span class="meta-label">HEAD</span> <code>{{ shortCommit(store.mainWorktree.headCommit) }}</code></span>
              <span class="meta-item"><span class="meta-label">Disk</span> {{ formatBytes(store.mainWorktree.diskUsageBytes) }}</span>
            </div>
          </div>
        </section>

        <!-- Secondary worktrees -->
        <section class="section-panel" aria-label="Secondary worktrees">
          <div class="section-panel-header">
            Secondary Worktrees
            <span class="wt-count-badge">{{ store.secondaryWorktrees.length }}</span>
          </div>

          <div v-if="store.secondaryWorktrees.length === 0" class="panel-empty">
            No secondary worktrees. Click <strong>Create Worktree</strong> to add one.
          </div>

          <table v-else class="data-table" aria-label="Secondary worktrees list">
            <thead>
              <tr>
                <th>Branch</th>
                <th>Path</th>
                <th>HEAD</th>
                <th>Status</th>
                <th style="text-align: right;">Disk</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="wt in store.secondaryWorktrees" :key="wt.path">
                <td class="cell-branch">{{ wt.branch }}</td>
                <td class="cell-path" :title="wt.path">{{ wt.path }}</td>
                <td><code>{{ shortCommit(wt.headCommit) }}</code></td>
                <td><span :class="statusClass(wt.status)">{{ wt.status }}</span></td>
                <td style="text-align: right; font-variant-numeric: tabular-nums;">{{ formatBytes(wt.diskUsageBytes) }}</td>
                <td style="text-align: right;">
                  <button class="btn btn-sm btn-danger-outline" @click="handleDelete(wt)">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Prune message -->
        <div v-if="pruneMessage" class="prune-message">{{ pruneMessage }}</div>

        <!-- Action bar -->
        <div class="action-bar">
          <button class="btn btn-primary" @click="openCreateModal">+ Create Worktree</button>
          <button class="btn btn-outline" @click="handlePrune">Prune Stale</button>
        </div>
      </template>

      <!-- Create Worktree Modal -->
      <Teleport to="body">
        <div v-if="showCreateModal" class="modal-backdrop" @click.self="showCreateModal = false">
          <div class="modal-dialog" role="dialog" aria-labelledby="create-wt-title">
            <div class="modal-header">
              <h2 id="create-wt-title" class="modal-title">Create Worktree</h2>
              <button class="modal-close" aria-label="Close" @click="showCreateModal = false">✕</button>
            </div>

            <div class="modal-body">
              <div class="form-group">
                <label class="form-label" for="wt-branch">Branch Name</label>
                <select
                  v-if="store.branches.length"
                  id="wt-branch"
                  v-model="newBranch"
                  class="form-input"
                >
                  <option value="" disabled>Select a branch…</option>
                  <option v-for="b in store.branches" :key="b" :value="b">{{ b }}</option>
                </select>
                <input
                  v-else
                  id="wt-branch"
                  v-model="newBranch"
                  type="text"
                  class="form-input"
                  placeholder="feature/my-branch"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="wt-base">Base Branch <span class="form-hint">(optional)</span></label>
                <select
                  v-if="store.branches.length"
                  id="wt-base"
                  v-model="newBaseBranch"
                  class="form-input"
                >
                  <option value="">None (use current HEAD)</option>
                  <option v-for="b in store.branches" :key="b" :value="b">{{ b }}</option>
                </select>
                <input
                  v-else
                  id="wt-base"
                  v-model="newBaseBranch"
                  type="text"
                  class="form-input"
                  placeholder="main"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="wt-dir">Target Directory <span class="form-hint">(optional)</span></label>
                <input
                  id="wt-dir"
                  v-model="newTargetDir"
                  type="text"
                  class="form-input"
                  placeholder="/home/user/worktrees/my-branch"
                />
              </div>

              <!-- Modal error -->
              <div v-if="store.error" class="modal-error">{{ store.error }}</div>
            </div>

            <div class="modal-footer">
              <button class="btn btn-outline" @click="showCreateModal = false">Cancel</button>
              <button class="btn btn-primary" :disabled="!newBranch.trim()" @click="handleCreate">Create</button>
            </div>
          </div>
        </div>
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
/* ─── Header ──────────────────────────────────────────────────── */
.wt-header {
  margin-bottom: 20px;
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: 0.8125rem;
  margin-top: 4px;
}

/* ─── Repo Input Bar ──────────────────────────────────────────── */
.repo-input-bar {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.repo-input-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.repo-input-row {
  display: flex;
  gap: 10px;
}

.repo-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 0.8125rem;
  font-family: inherit;
  background: var(--canvas-default);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s;
}

.repo-input:focus {
  border-color: var(--accent-fg);
}

.repo-input::placeholder {
  color: var(--text-tertiary);
}

/* ─── Buttons ─────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 0.8125rem;
  font-weight: 600;
  font-family: inherit;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent-emphasis);
  color: #fff;
  border-color: var(--accent-emphasis);
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-outline {
  background: transparent;
  color: var(--text-primary);
  border-color: var(--border-default);
}

.btn-outline:hover:not(:disabled) {
  background: var(--canvas-subtle);
}

.btn-sm {
  padding: 4px 10px;
  font-size: 0.75rem;
}

.btn-danger-outline {
  background: transparent;
  color: var(--danger-fg);
  border-color: var(--danger-fg);
}

.btn-danger-outline:hover:not(:disabled) {
  background: var(--danger-fg);
  color: #fff;
}

/* ─── Stats Bar ───────────────────────────────────────────────── */
.stats-bar {
  margin-bottom: 24px;
}

/* ─── Main Worktree Card ──────────────────────────────────────── */
.main-wt-card {
  background: var(--canvas-subtle);
  border: 1px solid var(--accent-fg);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  position: relative;
}

.main-wt-badge {
  display: inline-block;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent-fg);
  background: var(--canvas-default);
  border: 1px solid var(--accent-fg);
  border-radius: 4px;
  padding: 2px 8px;
  margin-bottom: 12px;
}

.main-wt-branch {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.main-wt-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.meta-item {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.meta-label {
  font-weight: 600;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-right: 6px;
}

.meta-item code {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.8125rem;
  background: var(--canvas-inset);
  padding: 1px 6px;
  border-radius: 4px;
}

/* ─── Section Panel ───────────────────────────────────────────── */
.wt-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  font-size: 0.6875rem;
  font-weight: 700;
  background: var(--canvas-inset);
  color: var(--text-secondary);
  border-radius: 10px;
  padding: 0 6px;
  margin-left: 8px;
}

.panel-empty {
  padding: 32px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}

/* ─── Table Cells ─────────────────────────────────────────────── */
.cell-branch {
  font-weight: 600;
  color: var(--text-primary);
}

.cell-path {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.data-table code {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.75rem;
  background: var(--canvas-inset);
  padding: 1px 5px;
  border-radius: 3px;
}

/* ─── Status Badges ───────────────────────────────────────────── */
.badge-success {
  color: var(--success-fg);
  background: var(--canvas-default);
  border: 1px solid var(--success-fg);
}

.badge-warning {
  color: var(--warning-fg);
  background: var(--canvas-default);
  border: 1px solid var(--warning-fg);
}

.badge-muted {
  color: var(--text-tertiary);
  background: var(--canvas-default);
  border: 1px solid var(--border-muted);
}

/* ─── Prune Message ───────────────────────────────────────────── */
.prune-message {
  padding: 10px 14px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

/* ─── Action Bar ──────────────────────────────────────────────── */
.action-bar {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

/* ─── Spinner ─────────────────────────────────────────────────── */
.spinner {
  display: inline-block;
  width: 28px;
  height: 28px;
  border: 3px solid var(--border-default);
  border-top-color: var(--accent-fg);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ─── Modal ───────────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.modal-dialog {
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
  width: 480px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-default);
}

.modal-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1rem;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  border-radius: 4px;
}

.modal-close:hover {
  color: var(--text-primary);
  background: var(--canvas-subtle);
}

.modal-body {
  padding: 20px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-default);
}

.modal-error {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--canvas-subtle);
  border: 1px solid var(--danger-fg);
  border-radius: 6px;
  font-size: 0.8125rem;
  color: var(--danger-fg);
}

/* ─── Form ────────────────────────────────────────────────────── */
.form-group {
  margin-bottom: 16px;
}

.form-group:last-of-type {
  margin-bottom: 0;
}

.form-label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.form-hint {
  font-weight: 400;
  color: var(--text-tertiary);
}

.form-input {
  display: block;
  width: 100%;
  padding: 8px 12px;
  font-size: 0.8125rem;
  font-family: inherit;
  background: var(--canvas-inset);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: var(--accent-fg);
}

select.form-input {
  appearance: auto;
}
</style>
