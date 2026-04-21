<script setup lang="ts">
import { formatTime, MarkdownContent } from "@tracepilot/ui";

defineProps<{
  content: string;
  turnIndex: number;
  timestamp?: string | null;
  eventIndex?: number | null;
  renderMarkdown: boolean;
}>();
</script>

<template>
  <div
    class="cv-user-anchor"
    :data-event-idx="eventIndex != null ? eventIndex : undefined"
  >
    <div class="cv-user-header">
      <span class="cv-user-avatar" aria-hidden="true">👤</span>
      <span class="cv-user-name">User</span>
      <span class="cv-user-turn">T{{ turnIndex }}</span>
      <span v-if="timestamp" class="cv-user-time">
        {{ formatTime(timestamp) }}
      </span>
    </div>
    <div class="cv-user-body">
      <MarkdownContent :content="content" :render="renderMarkdown" />
    </div>
  </div>
</template>

<style scoped>
.cv-user-anchor {
  border-left: 3px solid var(--accent-emphasis, #1f6feb);
  background: var(--canvas-subtle, #161b22);
  border-radius: 0 var(--radius-md, 8px) var(--radius-md, 8px) 0;
  padding: 12px 16px;
  margin: 12px 0 4px;
}

.cv-user-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.cv-user-avatar {
  font-size: 16px;
  flex-shrink: 0;
}

.cv-user-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--accent-fg, #58a6ff);
}

.cv-user-turn {
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
  color: var(--text-placeholder, #6e7681);
}

.cv-user-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-placeholder, #6e7681);
}

.cv-user-body {
  position: relative;
  background: var(--accent-subtle, rgba(56, 139, 253, 0.08));
  border: 1px solid var(--accent-muted, rgba(56, 139, 253, 0.15));
  border-radius: var(--radius-md, 8px);
  padding: 12px 16px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-primary, #c9d1d9);
  overflow-wrap: break-word;
}
</style>
