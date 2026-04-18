<script setup lang="ts">
import { formatBytes, LoadingSpinner } from "@tracepilot/ui";
import CreateWorktreeModal from "@/components/worktree/CreateWorktreeModal.vue";
import WorktreeDetailPanel from "@/components/worktree/WorktreeDetailPanel.vue";
import WorktreeList from "@/components/worktree/WorktreeList.vue";
import WorktreeRepoSidebar from "@/components/worktree/WorktreeRepoSidebar.vue";
import WorktreeToolbar from "@/components/worktree/WorktreeToolbar.vue";
import { useWorktreeManager } from "@/composables/useWorktreeManager";
import "@/styles/features/worktree-manager.css";

const {
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
} = useWorktreeManager();
</script>

<template>
  <div class="wt-manager">
    <WorktreeRepoSidebar
      :selected-repo-path="selectedRepoPath"
      :loaded="loaded"
      :worktree-count-by-repo="worktreeCountByRepo"
      @add-repo="handleAddRepo"
      @discover-repos="handleDiscoverRepos"
      @select-repo="handleSelectRepo"
      @remove-repo="handleRemoveRepo"
    />

    <main class="right-panel">
      <div v-if="store.loading && !loaded" class="empty-state">
        <LoadingSpinner size="md" />
        <span class="empty-state-text">Loading worktrees…</span>
      </div>

      <div v-else-if="store.error && !loaded" class="empty-state empty-state--error">
        <svg class="empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--danger-fg)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span class="empty-state-text">{{ store.error }}</span>
        <button class="btn btn-sm" @click="handleLoad">Retry</button>
      </div>

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

      <template v-else>
        <WorktreeToolbar
          v-model:search-query="searchQuery"
          :selected-repo-path="selectedRepoPath"
          :refreshing="refreshing"
          :cleaning-stale="cleaningStale"
          @create="openCreateModal"
          @clean-stale="handleCleanStale"
          @prune="handlePrune"
          @refresh="handleRefresh"
        />

        <div v-if="pruneMessage" class="prune-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          {{ pruneMessage }}
        </div>

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

        <WorktreeList
          :filtered-worktrees="filteredWorktrees"
          :selected-worktree-path="selectedWorktree?.path ?? null"
          :search-query="searchQuery"
          @select="selectWorktree"
          @open-explorer="handleOpenExplorer"
          @open-terminal="handleOpenTerminal"
          @navigate-session="navigateToSession"
          @navigate-launcher="navigateToLauncher"
          @lock="handleLockInline"
          @unlock="handleUnlock"
          @delete="confirmDelete"
        />

        <WorktreeDetailPanel
          :worktree="selectedWorktree"
          :details="worktreeDetails"
          :details-loading="detailsLoading"
          @close="closeDetail"
          @open-explorer="handleOpenExplorer"
          @open-terminal="handleOpenTerminal"
          @navigate-session="navigateToSession"
          @navigate-launcher="navigateToLauncher"
          @lock="handleLockInline"
          @unlock="handleUnlock"
          @delete="confirmDelete"
        />
      </template>
    </main>

    <CreateWorktreeModal
      v-model="showCreateModal"
      :locked-repo-path="selectedRepoPath"
      :initial-repo-path="initialRepoPath"
    />
  </div>
</template>
