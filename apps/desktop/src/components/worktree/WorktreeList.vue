<script setup lang="ts">
import type { WorktreeInfo } from "@tracepilot/types";
import { formatBytes, formatRelativeTime } from "@tracepilot/ui";
import { computed } from "vue";
import { useWorktreesStore } from "@/stores/worktrees";

const props = defineProps<{
  filteredWorktrees: WorktreeInfo[];
  selectedWorktreePath: string | null;
  searchQuery: string;
}>();

const emit = defineEmits<{
  (e: "select", wt: WorktreeInfo): void;
  (e: "open-explorer", path: string): void;
  (e: "open-terminal", path: string): void;
  (e: "navigate-session", sessionId: string): void;
  (e: "navigate-launcher", wt: WorktreeInfo): void;
  (e: "lock", wt: WorktreeInfo): void;
  (e: "unlock", wt: WorktreeInfo): void;
  (e: "delete", wt: WorktreeInfo): void;
}>();

const store = useWorktreesStore();

const maxWorktreeDisk = computed(() =>
  Math.max(...props.filteredWorktrees.map((w) => w.diskUsageBytes ?? 0), 1),
);

function diskBarPercent(wt: WorktreeInfo): number {
  if (!wt.diskUsageBytes) return 0;
  return Math.min(100, Math.round((wt.diskUsageBytes / maxWorktreeDisk.value) * 100));
}

function diskBarColor(wt: WorktreeInfo): string {
  const pct = diskBarPercent(wt);
  if (pct < 40) return "var(--success-fg)";
  if (pct < 75) return "var(--accent-fg)";
  return "var(--warning-fg)";
}

function sortIcon(field: "branch" | "status" | "createdAt" | "diskUsageBytes"): string {
  if (store.sortBy !== field) return "";
  return store.sortDirection === "asc" ? "↑" : "↓";
}
</script>

<template>
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
        'wt-row--selected': selectedWorktreePath === wt.path,
        'wt-row--stale': wt.status === 'stale',
      }"
      @click="emit('select', wt)"
    >
      <!-- Icon -->
      <div class="wt-row-icon" :class="wt.isMainWorktree ? 'wt-row-icon--main' : 'wt-row-icon--' + wt.status">
        <svg v-if="wt.isMainWorktree" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
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
          @click.stop="emit('navigate-session', wt.linkedSessionId)"
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
        <button class="icon-btn" title="Open Folder" @click="emit('open-explorer', wt.path)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
        </button>
        <button class="icon-btn" title="Open Terminal" @click="emit('open-terminal', wt.path)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
        </button>
        <button class="icon-btn" title="Launch Session Here" @click="emit('navigate-launcher', wt)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        </button>
        <button
          class="icon-btn"
          :title="wt.isMainWorktree ? 'Cannot lock main worktree' : wt.isLocked ? 'Unlock Worktree' : 'Lock Worktree'"
          :disabled="wt.isMainWorktree"
          @click="wt.isLocked ? emit('unlock', wt) : emit('lock', wt)"
        >
          <svg v-if="wt.isLocked" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5" /></svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </button>
        <button
          class="icon-btn icon-btn--danger"
          :title="wt.isMainWorktree ? 'Cannot remove main worktree' : wt.isLocked ? 'Unlock to remove' : 'Remove'"
          :disabled="wt.isMainWorktree || wt.isLocked"
          @click="emit('delete', wt)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
        </button>
      </div>
    </div>
  </div>
</template>
