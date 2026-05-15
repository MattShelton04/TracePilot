<script setup lang="ts">
import type { SessionListItem } from "@tracepilot/types";
import { formatRelativeTime } from "@tracepilot/types";
import Badge from "./Badge.vue";

defineProps<{
  session: SessionListItem;
}>();

const emit = defineEmits<{
  select: [event: MouseEvent, sessionId: string];
}>();

function isActive(session: SessionListItem): boolean {
  return session.isRunning === true;
}
</script>

<template>
  <div
    class="card card-interactive session-card-new"
    :class="{ 'card--active': isActive(session) }"
    role="link"
    tabindex="0"
    @click="emit('select', $event, session.id)"
    @keydown.enter="emit('select', $event as unknown as MouseEvent, session.id)"
    @keydown.space.prevent="emit('select', $event as unknown as MouseEvent, session.id)"
  >
    <Transition name="active-pop">
      <span v-if="isActive(session)" class="active-pop-wrapper active-badge-topright">
        <Badge variant="success" class="active-badge">Active</Badge>
      </span>
    </Transition>
    
    <div class="card-header-new">
      <Transition name="active-pop">
        <span v-if="isActive(session)" class="active-pop-wrapper">
          <span class="active-dot" title="Session is currently active" />
        </span>
      </Transition>
      <h3 class="card-title-new">{{ session.summary || 'Untitled Session' }}</h3>
    </div>

    <div class="card-badges-new">
      <Badge v-if="session.repository" variant="accent">{{ session.repository }}</Badge>
      <Badge v-if="session.branch" variant="success">{{ session.branch }}</Badge>
      <Badge v-if="session.currentModel" variant="done">{{ session.currentModel }}</Badge>
      <Badge variant="neutral">{{ session.hostType || 'cli' }}</Badge>
    </div>

    <div class="card-footer-new">
      <div class="card-stats-new">
        <span class="stat-item-inline" title="Total Events">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          {{ session.eventCount ?? 0 }}
        </span>
        <span class="stat-item-inline" title="Conversation Turns">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          {{ session.turnCount ?? 0 }}
        </span>
        <span v-if="session.errorCount" class="stat-item-inline error" :title="`${session.errorCount} error${session.errorCount !== 1 ? 's' : ''} encountered`">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {{ session.errorCount }}
        </span>
        <span v-if="session.compactionCount" class="stat-item-inline warning" :title="`${session.compactionCount} context compaction${session.compactionCount !== 1 ? 's' : ''} performed`">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          {{ session.compactionCount }}
        </span>
      </div>
      <span class="card-time-new" :title="session.updatedAt ?? undefined">{{ formatRelativeTime(session.updatedAt) }}</span>
    </div>
  </div>
</template>

<style scoped>
.session-card-new {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  position: relative;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
}

.card-header-new {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
  padding-right: 48px; /* space for active badge */
}

.card-title-new {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.card-badges-new {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 24px;
}

.card-footer-new {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.card-stats-new {
  display: flex;
  align-items: center;
  gap: 14px;
}

.stat-item-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.stat-item-inline svg {
  color: var(--text-tertiary);
}

.stat-item-inline.error {
  color: var(--danger-fg);
}
.stat-item-inline.error svg {
  color: var(--danger-fg);
}

.stat-item-inline.warning {
  color: var(--warning-fg);
}
.stat-item-inline.warning svg {
  color: var(--warning-fg);
}

.card-time-new {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
}

/* --- Active State Animations --- */
.card--active {
  border-color: var(--success-muted, rgba(52, 211, 153, 0.3));
  box-shadow: 0 0 0 1px var(--success-muted, rgba(52, 211, 153, 0.15));
  animation: card-active-pulse 2s ease-in-out infinite;
}
@keyframes card-active-pulse {
  0%, 100% {
    border-color: var(--success-muted, rgba(52, 211, 153, 0.3));
    box-shadow: 0 0 0 1px var(--success-muted, rgba(52, 211, 153, 0.15));
  }
  50% {
    border-color: var(--success-fg, rgba(52, 211, 153, 0.6));
    box-shadow: 0 0 0 2px var(--success-muted, rgba(52, 211, 153, 0.25));
  }
}

.active-badge-topright {
  position: absolute;
  top: 16px;
  right: 16px;
}

.active-pop-wrapper {
  display: inline-flex;
  align-items: center;
  margin-top: 4px; /* align dot with first line of title */
}

.active-pop-enter-active,
.active-pop-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.active-pop-enter-from { opacity: 0; transform: scale(0); }
.active-pop-leave-to { opacity: 0; transform: scale(0); }

.active-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-fg);
  flex-shrink: 0;
  overflow: visible;
  position: relative;
  animation: dot-sync-pulse 2s ease-in-out infinite;
}

@keyframes dot-sync-pulse {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.15); opacity: 1; }
}

.active-badge {
  flex-shrink: 0;
  font-size: 0.625rem;
}
</style>
