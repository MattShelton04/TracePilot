<script setup lang="ts">
import type { WorktreeDetails, WorktreeInfo } from "@tracepilot/types";
import { formatBytes, formatRelativeTime, LoadingSpinner } from "@tracepilot/ui";

defineProps<{
  worktree: WorktreeInfo | null;
  details: WorktreeDetails | null;
  detailsLoading: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open-explorer", path: string): void;
  (e: "open-terminal", path: string): void;
  (e: "navigate-session", sessionId: string): void;
  (e: "navigate-launcher", wt: WorktreeInfo): void;
  (e: "lock", wt: WorktreeInfo): void;
  (e: "unlock", wt: WorktreeInfo): void;
  (e: "delete", wt: WorktreeInfo): void;
}>();
</script>

<template>
  <div class="wt-detail-panel" :class="{ 'wt-detail-panel--open': worktree }">
    <template v-if="worktree">
      <div class="detail-header">
        <div class="detail-header-left">
          <div class="wt-row-icon" :class="worktree.isMainWorktree ? 'wt-row-icon--main' : 'wt-row-icon--' + worktree.status">
            <svg v-if="worktree.isMainWorktree" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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
          <span class="detail-branch">{{ worktree.branch }}</span>
          <span class="badge" :class="'badge-' + worktree.status">{{ worktree.status }}</span>
          <span v-if="worktree.isLocked" class="badge badge-locked" :title="worktree.lockedReason">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            locked
          </span>
        </div>
        <button class="icon-btn" aria-label="Close" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-item-label">Repository</span>
          <span class="detail-item-value">{{ worktree.repoRoot }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-item-label">Branch</span>
          <span class="detail-item-value">{{ worktree.branch }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-item-label">Path</span>
          <span class="detail-item-value detail-item-value--mono">{{ worktree.path }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-item-label">Disk Usage</span>
          <span class="detail-item-value">{{ formatBytes(worktree.diskUsageBytes) }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-item-label">Session</span>
          <span class="detail-item-value">
            <span
              v-if="worktree.linkedSessionId"
              class="session-link"
              @click="emit('navigate-session', worktree.linkedSessionId!)"
            >{{ worktree.linkedSessionId }}</span>
            <span v-else>—</span>
          </span>
        </div>
        <div class="detail-item">
          <span class="detail-item-label">Created</span>
          <span class="detail-item-value">{{ formatRelativeTime(worktree.createdAt) }}</span>
        </div>
        <template v-if="detailsLoading">
          <div class="detail-item">
            <span class="detail-item-label">Details</span>
            <span class="detail-item-value"><LoadingSpinner size="sm" /> Loading…</span>
          </div>
        </template>
        <template v-else-if="details">
          <div class="detail-item">
            <span class="detail-item-label">Uncommitted</span>
            <span class="detail-item-value">{{ details.uncommittedCount }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-item-label">Ahead / Behind</span>
            <span class="detail-item-value">{{ details.ahead }} ↑ / {{ details.behind }} ↓</span>
          </div>
        </template>
        <template v-if="worktree.isLocked && worktree.lockedReason">
          <div class="detail-item">
            <span class="detail-item-label">Lock Reason</span>
            <span class="detail-item-value">{{ worktree.lockedReason }}</span>
          </div>
        </template>
      </div>

      <div class="detail-actions">
        <button class="btn btn-sm" @click="emit('open-explorer', worktree!.path)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          Open Folder
        </button>
        <button class="btn btn-sm" @click="emit('open-terminal', worktree!.path)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
          Open Terminal
        </button>
        <button class="btn btn-sm" @click="emit('navigate-launcher', worktree!)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" /></svg>
          Launch Session Here
        </button>
        <button
          v-if="worktree.linkedSessionId"
          class="btn btn-sm"
          @click="emit('navigate-session', worktree.linkedSessionId!)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
          View Session
        </button>
        <button
          class="btn btn-sm"
          :disabled="worktree.isMainWorktree"
          :title="worktree.isMainWorktree ? 'Cannot lock main worktree' : worktree.isLocked ? 'Unlock' : 'Lock'"
          @click="worktree!.isLocked ? emit('unlock', worktree!) : emit('lock', worktree!)"
        >
          <svg v-if="worktree.isLocked" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5" /></svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          {{ worktree.isLocked ? 'Unlock' : 'Lock' }}
        </button>
        <button
          class="btn btn-sm btn-danger"
          :disabled="worktree.isMainWorktree || worktree.isLocked"
          :title="worktree.isMainWorktree ? 'Cannot remove main worktree' : worktree.isLocked ? 'Unlock to remove' : 'Remove worktree'"
          @click="emit('delete', worktree!)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
          Remove
        </button>
      </div>
    </template>
  </div>
</template>
