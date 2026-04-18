<script setup lang="ts">
import { formatBytes, LoadingSpinner } from "@tracepilot/ui";
import { computed } from "vue";
import { useWorktreesStore } from "@/stores/worktrees";

const props = defineProps<{
  searchQuery: string;
  selectedRepoPath: string | null;
  refreshing: boolean;
  cleaningStale: boolean;
}>();

const emit = defineEmits<{
  (e: "update:searchQuery", v: string): void;
  (e: "create"): void;
  (e: "clean-stale"): void;
  (e: "prune"): void;
  (e: "refresh"): void;
}>();

const store = useWorktreesStore();

const totalDiskUsage = computed(() =>
  store.worktrees.reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0),
);

const searchModel = computed({
  get: () => props.searchQuery,
  set: (v: string) => emit("update:searchQuery", v),
});
</script>

<template>
  <div class="toolbar">
    <button class="btn btn-primary btn-sm" @click="emit('create')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      Create Worktree
    </button>
    <button
      class="btn btn-sm"
      :disabled="store.staleCount === 0 || cleaningStale"
      @click="emit('clean-stale')"
    >
      <LoadingSpinner v-if="cleaningStale" size="sm" />
      <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
      {{ cleaningStale ? 'Cleaning…' : 'Clean Stale' }}
    </button>
    <button class="btn btn-sm" @click="emit('prune')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
      {{ selectedRepoPath ? 'Prune This Repo' : 'Prune All Repos' }}
    </button>
    <button class="btn btn-sm" :disabled="refreshing" :class="{ 'btn-refreshing': refreshing }" @click="emit('refresh')">
      <svg :class="{ 'spin-animation': refreshing }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
      {{ refreshing ? 'Refreshing…' : 'Refresh' }}
    </button>

    <div class="toolbar-divider" />

    <div class="search-wrapper">
      <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input
        v-model="searchModel"
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
</template>
