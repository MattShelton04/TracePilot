<script setup lang="ts">
/**
 * SessionEventRow — renders a single session event in the conversation view.
 *
 * Handles both compaction events (blue accent + checkpoint pill) and regular
 * events (severity-based colouring). Encapsulates the checkpoint navigation
 * concern so ChatViewMode doesn't need to know about it.
 */
import type { SessionEventSeverity, TurnSessionEvent } from "@tracepilot/types";
import { formatTime } from "@tracepilot/ui";
import { useCheckpointNavigation } from "@/composables/useCheckpointNavigation";

defineProps<{
  event: TurnSessionEvent;
}>();

const navigateToCheckpoint = useCheckpointNavigation();

function isCompaction(evt: TurnSessionEvent): boolean {
  return evt.eventType === "session.compaction_complete";
}

function severityClass(severity: SessionEventSeverity | undefined): string {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

function severityIcon(severity: SessionEventSeverity | undefined): string {
  if (severity === "error") return "⚠️";
  if (severity === "warning") return "⚠️";
  return "ℹ️";
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    "permission.requested": "permission requested",
    "permission.completed": "permission result",
    "external_tool.requested": "external tool",
  };
  return labels[eventType] ?? eventType;
}
</script>

<template>
  <!-- Compaction event with checkpoint pill -->
  <div
    v-if="isCompaction(event)"
    class="cv-session-event cv-compaction"
  >
    <span class="cv-session-event-icon">🗜️</span>
    <button
      v-if="event.checkpointNumber != null"
      class="cv-checkpoint-pill"
      :title="`View Checkpoint #${event.checkpointNumber} in Overview tab`"
      @click="navigateToCheckpoint(event.checkpointNumber!)"
    >
      📋 Checkpoint #{{ event.checkpointNumber }}
    </button>
    <span v-else class="cv-session-event-type">compaction</span>
    <span class="cv-session-event-summary">{{ event.summary }}</span>
    <span v-if="event.timestamp" class="cv-session-event-time">
      {{ formatTime(event.timestamp) }}
    </span>
  </div>

  <!-- Regular session event -->
  <div
    v-else
    :class="['cv-session-event', severityClass(event.severity)]"
  >
    <span class="cv-session-event-icon">{{ severityIcon(event.severity) }}</span>
    <span class="cv-session-event-type">{{ eventLabel(event.eventType) }}</span>
    <span class="cv-session-event-summary">{{ event.summary }}</span>
    <span v-if="event.timestamp" class="cv-session-event-time">
      {{ formatTime(event.timestamp) }}
    </span>
  </div>
</template>

<style scoped>
.cv-session-event {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-md, 8px);
  font-size: 12px;
  margin: 4px 0;
}

.cv-session-event.info {
  background: var(--neutral-subtle, rgba(110, 118, 129, 0.1));
  color: var(--text-secondary, #8b949e);
}

.cv-session-event.warning {
  background: var(--warning-subtle, rgba(210, 153, 34, 0.1));
  color: var(--warning-fg, #d29922);
}

.cv-session-event.error {
  background: var(--danger-subtle, rgba(248, 81, 73, 0.1));
  color: var(--danger-fg, #f85149);
}

.cv-session-event-icon {
  flex-shrink: 0;
}

.cv-session-event-type {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  opacity: 0.7;
}

.cv-session-event-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-session-event-time {
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.6;
}

/* ─── Compaction accent ──────────────────────────────────────────── */

.cv-compaction {
  background: var(--accent-subtle, rgba(56, 139, 253, 0.08));
  color: var(--accent-fg, #58a6ff);
  border-left: 3px solid var(--accent-emphasis, #1f6feb);
}

.cv-checkpoint-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border: 1px solid var(--accent-muted, rgba(56, 139, 253, 0.4));
  border-radius: 12px;
  background: var(--accent-subtle, rgba(56, 139, 253, 0.1));
  color: var(--accent-fg, #58a6ff);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}

.cv-checkpoint-pill:hover {
  background: var(--accent-muted, rgba(56, 139, 253, 0.25));
  border-color: var(--accent-fg, #58a6ff);
}
</style>
