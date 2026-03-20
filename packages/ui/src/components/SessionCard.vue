<script setup lang="ts">
import type { SessionListItem } from "@tracepilot/types";
import Badge from "./Badge.vue";

defineProps<{
  session: SessionListItem;
}>();

const emit = defineEmits<{
  select: [sessionId: string];
}>();

function relativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function isActive(session: SessionListItem): boolean {
  return session.isRunning === true;
}
</script>

<template>
  <div
    class="card card-interactive cursor-pointer"
    :class="{ 'card--active': isActive(session) }"
    role="button"
    tabindex="0"
    @click="emit('select', session.id)"
    @keydown.enter="emit('select', session.id)"
    @keydown.space.prevent="emit('select', session.id)"
  >
    <div class="flex items-center gap-2 mb-2">
      <span v-if="isActive(session)" class="active-dot" title="Session is currently active" />
      <h3 class="card-title text-sm font-semibold truncate" style="color: var(--text-primary); transition: color var(--transition-fast); flex: 1; margin: 0;">
        {{ session.summary || 'Untitled Session' }}
      </h3>
      <Badge v-if="isActive(session)" variant="success" class="active-badge">Active</Badge>
    </div>

    <div class="flex flex-wrap gap-1.5 mb-3 min-w-0">
      <Badge v-if="session.repository" variant="accent">{{ session.repository }}</Badge>
      <Badge v-if="session.branch" variant="success">{{ session.branch }}</Badge>
      <Badge v-if="session.hostType" variant="neutral">{{ session.hostType }}</Badge>
      <Badge v-if="session.currentModel" variant="done">{{ session.currentModel }}</Badge>
    </div>

    <div class="flex items-center gap-3 text-xs" style="color: var(--text-secondary);">
      <span v-if="session.eventCount != null" class="flex items-center gap-1">
        <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        {{ session.eventCount }}
      </span>
      <span v-if="session.turnCount != null" class="flex items-center gap-1">
        <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
        {{ session.turnCount }}
      </span>
      <span v-if="session.errorCount" class="flex items-center gap-1 stat-item--danger" :title="`${session.errorCount} errors (${session.rateLimitCount || 0} rate limits)`">
        ⚠ {{ session.errorCount }}
      </span>
      <span v-if="session.compactionCount" class="flex items-center gap-1" title="Context compactions">
        ↻ {{ session.compactionCount }}
      </span>
      <span class="ml-auto" style="color: var(--text-tertiary);" :title="session.updatedAt">
        {{ relativeTime(session.updatedAt) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.card--active {
  border-color: var(--success-muted, rgba(52, 211, 153, 0.3));
  box-shadow: 0 0 0 1px var(--success-muted, rgba(52, 211, 153, 0.15));
}

.active-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-fg);
  flex-shrink: 0;
  margin-left: 2px;
  animation: pulse-dot 2s ease-in-out infinite;
  overflow: visible;
  position: relative;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.85); }
}

.active-badge {
  flex-shrink: 0;
  font-size: 0.625rem;
}

.stat-item--danger {
  color: var(--color-danger, #ef4444);
}
</style>
