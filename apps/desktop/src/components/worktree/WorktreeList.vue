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

function sortOrder(field: "branch" | "status" | "createdAt" | "diskUsageBytes") {
  if (store.sortBy !== field) return "none";
  return store.sortDirection === "asc" ? "ascending" : "descending";
}
</script>

<template>
  <!-- One table and scrollport keep headers aligned with every row. -->
  <div class="wt-list">
    <table class="wt-table" aria-label="Worktrees">
      <colgroup>
        <col class="wt-col-icon" />
        <col class="wt-col-branch" />
        <col class="wt-col-session" />
        <col class="wt-col-disk" />
        <col class="wt-col-status" />
        <col class="wt-col-created" />
        <col class="wt-col-actions" />
      </colgroup>
      <thead>
        <tr class="col-headers">
          <th scope="col"><span class="sr-only">Type</span></th>
          <th scope="col" :aria-sort="sortOrder('branch')">
            <button type="button" class="col-header-sortable" @click="store.setSortBy('branch')">
              Path / Branch <span aria-hidden="true">{{ sortIcon('branch') }}</span>
            </button>
          </th>
          <th scope="col">Session</th>
          <th scope="col" :aria-sort="sortOrder('diskUsageBytes')">
            <button type="button" class="col-header-sortable" @click="store.setSortBy('diskUsageBytes')">
              Disk <span aria-hidden="true">{{ sortIcon('diskUsageBytes') }}</span>
            </button>
          </th>
          <th scope="col" :aria-sort="sortOrder('status')">
            <button type="button" class="col-header-sortable" @click="store.setSortBy('status')">
              Status <span aria-hidden="true">{{ sortIcon('status') }}</span>
            </button>
          </th>
          <th scope="col" :aria-sort="sortOrder('createdAt')">
            <button type="button" class="col-header-sortable" @click="store.setSortBy('createdAt')">
              Created <span aria-hidden="true">{{ sortIcon('createdAt') }}</span>
            </button>
          </th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr
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
          <td>
            <div class="wt-row-icon" :class="wt.isMainWorktree ? 'wt-row-icon--main' : 'wt-row-icon--' + wt.status">
              <svg v-if="wt.isMainWorktree" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="15" r="2" />
              </svg>
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            </div>
          </td>

          <!-- Branch + path -->
          <td>
            <button
              type="button"
              class="wt-row-info wt-row-select"
              :aria-label="`Details for ${wt.branch}`"
              :aria-expanded="selectedWorktreePath === wt.path"
              @click.stop="emit('select', wt)"
            >
              <span class="wt-row-branch-line">
                <span class="wt-row-branch" :title="wt.branch">{{ wt.branch }}</span>
                <span v-if="wt.isMainWorktree" class="badge badge-main">Main</span>
              </span>
              <span class="wt-row-path" :title="wt.path">{{ wt.path }}</span>
            </button>
          </td>

          <!-- Session -->
          <td>
            <div class="wt-row-session">
              <button
                v-if="wt.linkedSessionId"
                type="button"
                class="session-link"
                :aria-label="`Open session ${wt.linkedSessionId}`"
                @click.stop="emit('navigate-session', wt.linkedSessionId)"
              >{{ wt.linkedSessionId.slice(0, 8) }}</button>
              <span v-else class="session-none">No session</span>
            </div>
          </td>

          <!-- Disk -->
          <td>
            <div class="wt-row-disk">
              <div class="disk-mini-bar">
                <div class="disk-mini-fill" :style="{ width: diskBarPercent(wt) + '%', background: diskBarColor(wt) }" />
              </div>
              <span class="disk-label">{{ formatBytes(wt.diskUsageBytes) }}</span>
            </div>
          </td>

          <!-- Status + Lock -->
          <td>
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
                aria-hidden="true"
                :title="wt.lockedReason ? `Locked: ${wt.lockedReason}` : 'Locked'"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
          </td>

          <!-- Created -->
          <td><div class="wt-row-created">{{ formatRelativeTime(wt.createdAt) }}</div></td>

          <!-- Actions -->
          <td>
            <div class="wt-row-actions" @click.stop>
              <button class="icon-btn" title="Open Folder" aria-label="Open Folder" @click="emit('open-explorer', wt.path)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              </button>
              <button class="icon-btn" title="Open Terminal" aria-label="Open Terminal" @click="emit('open-terminal', wt.path)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
              </button>
              <button class="icon-btn" title="Launch Session Here" aria-label="Launch Session Here" @click="emit('navigate-launcher', wt)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              </button>
              <button
                class="icon-btn"
                :title="wt.isMainWorktree ? 'Cannot lock main worktree' : wt.isLocked ? 'Unlock Worktree' : 'Lock Worktree'"
                :aria-label="wt.isMainWorktree ? `Cannot lock main worktree ${wt.branch}` : wt.isLocked ? `Unlock worktree ${wt.branch}` : `Lock worktree ${wt.branch}`"
                :disabled="wt.isMainWorktree"
                @click="wt.isLocked ? emit('unlock', wt) : emit('lock', wt)"
              >
                <svg v-if="wt.isLocked" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5" /></svg>
                <svg v-else aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </button>
              <button
                class="icon-btn icon-btn--danger"
                :title="wt.isMainWorktree ? 'Cannot remove main worktree' : wt.isLocked ? 'Unlock to remove' : 'Remove'"
                :aria-label="wt.isMainWorktree ? `Cannot remove main worktree ${wt.branch}` : wt.isLocked ? `Unlock worktree ${wt.branch} to remove` : `Remove worktree ${wt.branch}`"
                :disabled="wt.isMainWorktree || wt.isLocked"
                @click="emit('delete', wt)"
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="filteredWorktrees.length === 0" class="empty-rows">
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-placeholder)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <span>{{ searchQuery ? 'No worktrees match your filter.' : 'No worktrees found.' }}</span>
    </div>
  </div>
</template>
