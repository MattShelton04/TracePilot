<script setup lang="ts">
import { formatRelativeTime } from "@tracepilot/ui";
import { computed } from "vue";
import { useOrchestrationHomeStore } from "@/stores/orchestrationHome";

const store = useOrchestrationHomeStore();

const feedIconClass = (type: string) => {
  const map: Record<string, string> = {
    session_launched: "feed-icon--accent",
    session_error: "feed-icon--danger",
    batch_completed: "feed-icon--success",
    budget_alert: "feed-icon--warning",
    config_changed: "feed-icon--accent",
  };
  return map[type] ?? "feed-icon--accent";
};

const feedIconLabel = (type: string) => {
  const map: Record<string, string> = {
    session_launched: "🚀",
    session_error: "❌",
    batch_completed: "✅",
    budget_alert: "💰",
    config_changed: "🔧",
  };
  return map[type] ?? "📋";
};

const mockFeed = [
  {
    id: "mock-1",
    type: "session_launched",
    message: "Session started in tracepilot",
    timestamp: new Date(Date.now() - 300_000).toISOString(),
  },
  {
    id: "mock-2",
    type: "batch_completed",
    message: "Batch run completed (3 sessions)",
    timestamp: new Date(Date.now() - 900_000).toISOString(),
  },
  {
    id: "mock-3",
    type: "budget_alert",
    message: "Budget threshold reached 60%",
    timestamp: new Date(Date.now() - 3_600_000).toISOString(),
  },
  {
    id: "mock-4",
    type: "config_changed",
    message: "Agent config updated",
    timestamp: new Date(Date.now() - 7_200_000).toISOString(),
  },
];

const feedItems = computed(() => (store.activityFeed.length > 0 ? store.activityFeed : mockFeed));
</script>

<template>
  <div class="panel">
    <div class="section-header">
      <svg class="section-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
      <span>Activity Feed</span>
      <span class="feed-badge">{{ feedItems.length }}</span>
    </div>
    <div class="feed-list">
      <div
        v-for="event in feedItems"
        :key="event.id"
        class="feed-item"
      >
        <span class="feed-icon" :class="feedIconClass(event.type)">{{ feedIconLabel(event.type) }}</span>
        <span class="feed-msg">{{ event.message }}</span>
        <span class="feed-time">{{ formatRelativeTime(event.timestamp) }}</span>
      </div>
      <div v-if="feedItems.length === 0" class="feed-empty">No recent activity</div>
    </div>
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
  max-height: 360px;
  overflow-y: auto;
}

.feed-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-muted);
  font-size: 0.8125rem;
  transition: background var(--transition-fast);
  border-radius: var(--radius-sm);
  padding-left: 4px;
  padding-right: 4px;
}

.feed-item:hover {
  background: var(--canvas-subtle);
}

.feed-item:last-child {
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
  font-size: 0.75rem;
}

.feed-icon--accent {
  background: var(--accent-muted);
  color: var(--accent-fg);
}

.feed-icon--danger {
  background: var(--danger-muted);
  color: var(--danger-fg);
}

.feed-icon--success {
  background: var(--success-muted);
  color: var(--success-fg);
}

.feed-icon--warning {
  background: var(--warning-muted);
  color: var(--warning-fg);
}

.feed-msg {
  flex: 1;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feed-time {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.feed-empty {
  text-align: center;
  padding: 32px 0;
  color: var(--text-placeholder);
  font-size: 0.8125rem;
}
</style>
