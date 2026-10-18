<script setup lang="ts">
import { formatRelativeTime, runStatusBadge } from "@tracepilot/types";
import { EmptyState, LoadingSpinner } from "@tracepilot/ui";
import { Activity, CircleDot, History } from "lucide-vue-next";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { type ActivityEvent, useOrchestrationHomeStore } from "@/stores/orchestrationHome";

const store = useOrchestrationHomeStore();
const router = useRouter();

/** What the session is doing now, in the session list's words. */
function statusLabel(event: ActivityEvent): string {
  if (!event.isRunning) return "Last active";
  return runStatusBadge(event.runStatus, event.source)?.label ?? "Running";
}

function open(event: ActivityEvent) {
  void pushRoute(router, ROUTE_NAMES.sessionOverview, { params: { id: event.sessionId } });
}
</script>

<template>
  <div class="panel">
    <div class="section-header">
      <Activity class="section-icon" :size="16" :stroke-width="2" aria-hidden="true" />
      <span>Activity Feed</span>
      <span v-if="store.sessionsLoaded && store.activityFeed.length" class="feed-badge">
        {{ store.activityFeed.length }}
      </span>
    </div>
    <div v-if="!store.sessionsLoaded" class="feed-loading" role="status">
      <LoadingSpinner size="sm" aria-hidden="true" />
      <span>Loading recent sessions…</span>
    </div>
    <EmptyState
      v-else-if="store.activityFeed.length === 0"
      size="sm"
      title="No sessions yet"
      description="Sessions appear here as soon as you run one."
    />
    <ul v-else class="feed-list" aria-label="Recently active sessions">
      <li v-for="event in store.activityFeed" :key="event.sessionId">
        <button type="button" class="feed-item" @click="open(event)">
          <span class="feed-icon" :class="event.isRunning ? 'feed-icon--success' : 'feed-icon--neutral'">
            <component :is="event.isRunning ? CircleDot : History" :size="14" :stroke-width="1.75" aria-hidden="true" />
          </span>
          <span class="feed-text">
            <span class="feed-msg" :title="event.title ?? undefined">{{ event.title ?? "Untitled Session" }}</span>
            <span class="feed-meta">
              <template v-if="event.location">{{ event.location }} · </template>{{ statusLabel(event) }}
            </span>
          </span>
          <span class="feed-time" :title="event.timestamp ?? undefined">{{ formatRelativeTime(event.timestamp) }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.panel {
  min-width: 0;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-muted);
}

.section-icon {
  flex-shrink: 0;
  color: var(--accent-fg);
}

.feed-badge {
  margin-left: auto;
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}

.feed-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 360px;
  overflow-y: auto;
}

.feed-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 4px;
  border: none;
  border-bottom: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.8125rem;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.feed-item:hover {
  background: var(--canvas-subtle);
}

/* The list scrolls, which would clip an outer focus ring. */
.feed-item:focus-visible {
  outline-offset: -2px;
}

.feed-list li:last-child .feed-item {
  border-bottom: none;
}

.feed-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.feed-icon--success {
  background: var(--success-muted);
  color: var(--success-fg);
}

.feed-icon--neutral {
  background: var(--neutral-muted);
  color: var(--text-secondary);
}

.feed-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.feed-msg,
.feed-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feed-msg {
  color: var(--text-primary);
}

.feed-meta {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.feed-time {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.feed-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 0;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}
</style>
