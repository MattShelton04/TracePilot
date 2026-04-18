<script setup lang="ts">
import { formatBytes, LoadingSpinner } from "@tracepilot/ui";
import { computed } from "vue";
import { useWorktreesStore } from "@/stores/worktrees";

defineProps<{
  selectedRepoPath: string | null;
  loaded: boolean;
  worktreeCountByRepo: Map<string, number>;
}>();

const emit = defineEmits<{
  (e: "add-repo"): void;
  (e: "discover-repos"): void;
  (e: "select-repo", path: string | null): void;
  (e: "remove-repo", path: string): void;
}>();

const store = useWorktreesStore();

const totalDiskUsage = computed(() =>
  store.worktrees.reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0),
);

const staleDiskUsage = computed(() =>
  store.worktrees
    .filter((w) => w.status === "stale")
    .reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0),
);
</script>

<template>
  <aside class="left-panel">
    <div class="left-header">Repositories</div>

    <!-- Repo actions -->
    <div class="repo-actions">
      <button class="btn btn-primary btn-sm repo-action-btn" @click="emit('add-repo')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        Add Repository
      </button>
      <button class="btn btn-sm repo-action-btn" @click="emit('discover-repos')">
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
          @click="emit('select-repo', null)"
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
          @click="emit('select-repo', repo.path)"
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
            @click.stop="emit('remove-repo', repo.path)"
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
</template>
