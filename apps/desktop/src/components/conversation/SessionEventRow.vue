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
import { useRouter } from "vue-router";
import { useCheckpointNavigation } from "@/composables/useCheckpointNavigation";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";

defineProps<{
  event: TurnSessionEvent;
}>();

const navigateToCheckpoint = useCheckpointNavigation();
const router = useRouter();

function isCompaction(evt: TurnSessionEvent): boolean {
  return evt.eventType === "session.compaction_complete";
}

function isSkillInvocation(evt: TurnSessionEvent): boolean {
  return evt.eventType === "skill.invoked";
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

function skillEditorDirectory(skillPath: string | undefined): string | undefined {
  const trimmed = skillPath?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/[\\/]SKILL\.md$/i, "");
}

function compactSkillPath(skillPath: string): string {
  const parts = skillPath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return skillPath;
  return `…${parts.slice(-3).join("\\")}`;
}

function formatChars(length: number | undefined): string {
  if (length == null) return "";
  return `${length.toLocaleString()} chars`;
}

function openSkillEditor(event: TurnSessionEvent) {
  const directory = skillEditorDirectory(event.skillPath);
  if (!directory) return;
  pushRoute(router, ROUTE_NAMES.skillEditor, {
    params: { name: encodeURIComponent(directory) },
  });
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

  <!-- Skill invocation with folded synthetic skill context -->
  <div
    v-else-if="isSkillInvocation(event)"
    class="cv-session-event cv-skill-invoked"
    :class="{ clickable: skillEditorDirectory(event.skillPath) }"
    :role="skillEditorDirectory(event.skillPath) ? 'button' : undefined"
    :tabindex="skillEditorDirectory(event.skillPath) ? 0 : undefined"
    :title="skillEditorDirectory(event.skillPath) ? 'Open skill in editor' : undefined"
    @click="openSkillEditor(event)"
    @keydown.enter="openSkillEditor(event)"
    @keydown.space.prevent="openSkillEditor(event)"
  >
    <span class="cv-session-event-icon">⚡</span>
    <div class="cv-skill-main">
      <div class="cv-skill-heading">
        <span class="cv-session-event-type">skill invoked</span>
        <span class="cv-skill-name">{{ event.skillName || "unnamed skill" }}</span>
        <span
          v-if="event.skillContextFolded"
          class="cv-skill-badge"
          :title="formatChars(event.skillContextLength)"
        >
          context folded
        </span>
      </div>
      <span class="cv-session-event-summary">
        {{ event.skillDescription || event.summary }}
      </span>
      <code
        v-if="event.skillPath"
        class="cv-skill-path"
        :title="event.skillPath"
      >
        {{ compactSkillPath(event.skillPath) }}
      </code>
    </div>
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

/* ─── Skill invocation accent ────────────────────────────────────── */

.cv-skill-invoked {
  align-items: flex-start;
  background: color-mix(in srgb, var(--accent-subtle, rgba(56, 139, 253, 0.08)) 70%, transparent);
  color: var(--text-secondary, #8b949e);
  border: 1px solid var(--accent-muted, rgba(56, 139, 253, 0.18));
  border-left: 3px solid var(--accent-emphasis, #1f6feb);
}

.cv-skill-invoked.clickable {
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.cv-skill-invoked.clickable:hover {
  background: var(--accent-subtle, rgba(56, 139, 253, 0.1));
  border-color: var(--accent-muted, rgba(56, 139, 253, 0.35));
}

.cv-skill-invoked.clickable:focus-visible {
  outline: 2px solid var(--accent-fg, #58a6ff);
  outline-offset: 2px;
}

.cv-skill-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.cv-skill-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.cv-skill-name {
  color: var(--text-primary, #c9d1d9);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-skill-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--accent-muted, rgba(56, 139, 253, 0.28));
  border-radius: 999px;
  background: var(--accent-subtle, rgba(56, 139, 253, 0.1));
  color: var(--accent-fg, #58a6ff);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.cv-skill-path {
  color: var(--text-placeholder, #6e7681);
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
