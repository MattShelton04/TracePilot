<script setup lang="ts">
/**
 * SessionEventRow — renders a single session event in the conversation view.
 *
 * Handles compaction events (blue accent + checkpoint pill), skill
 * invocations (lightning accent + optional editor link), and regular events
 * (severity-based colouring). Encapsulates the checkpoint navigation
 * concern so ChatViewMode doesn't need to know about it.
 */
import type { SessionEventSeverity, TurnSessionEvent } from "@tracepilot/types";
import { formatTime } from "@tracepilot/ui";
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useCheckpointNavigation } from "@/composables/useCheckpointNavigation";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";

const props = defineProps<{
  event: TurnSessionEvent;
}>();

const router = useRouter();
const navigateToCheckpoint = useCheckpointNavigation();

const isCompaction = computed(() => props.event.eventType === "session.compaction_complete");
const isSkill = computed(() => props.event.eventType === "skill.invoked");

const skill = computed(() => props.event.skillInvocation);
const skillName = computed(() => skill.value?.name?.trim() || "");
const skillDescription = computed(() => skill.value?.description?.trim() || "");
const skillPath = computed(() => skill.value?.path?.trim() || "");

const skillEditorTarget = computed(() => {
  const p = skillPath.value;
  if (!p) return "";
  const dir = p.replace(/[\\/]SKILL\.md$/i, "");
  return dir === p ? "" : dir;
});

const skillTooltip = computed(() => {
  const parts: string[] = [];
  if (skillDescription.value) parts.push(skillDescription.value);
  if (skillPath.value) parts.push(skillPath.value);
  if (skillEditorTarget.value) parts.push("Click to open in skill editor");
  return parts.join("\n");
});

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

function openSkillEditor() {
  const target = skillEditorTarget.value;
  if (!target) return;
  pushRoute(router, ROUTE_NAMES.skillEditor, {
    params: { name: encodeURIComponent(target) },
  });
}
</script>

<template>
  <!-- Compaction event with checkpoint pill -->
  <div
    v-if="isCompaction"
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

  <!-- Skill invocation: same row shape as a regular session event, but with
       a skill emoji, the skill name as the primary label, and an optional
       click target that opens the skill editor when a path is known. -->
  <component
    :is="skillEditorTarget ? 'button' : 'div'"
    v-else-if="isSkill"
    type="button"
    :class="[
      'cv-session-event',
      'cv-skill',
      { 'cv-skill-clickable': skillEditorTarget },
    ]"
    :title="skillTooltip || undefined"
    @click="skillEditorTarget ? openSkillEditor() : undefined"
  >
    <span class="cv-session-event-icon">⚡</span>
    <span class="cv-session-event-type">skill</span>
    <span class="cv-session-event-summary">
      <template v-if="skillName">{{ skillName }}</template>
      <template v-else>{{ event.summary }}</template>
      <span v-if="skillDescription" class="cv-skill-desc">
        — {{ skillDescription }}
      </span>
    </span>
    <span v-if="event.timestamp" class="cv-session-event-time">
      {{ formatTime(event.timestamp) }}
    </span>
  </component>

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

/* ─── Skill accent ───────────────────────────────────────────────── */

.cv-skill {
  background: var(--accent-subtle, rgba(56, 139, 253, 0.08));
  color: var(--text-secondary, #8b949e);
  border: 1px solid transparent;
  width: 100%;
  text-align: left;
  font: inherit;
}

button.cv-skill {
  cursor: default;
}

button.cv-skill.cv-skill-clickable {
  cursor: pointer;
}

button.cv-skill.cv-skill-clickable:hover {
  background: var(--accent-muted, rgba(56, 139, 253, 0.15));
  border-color: var(--accent-muted, rgba(56, 139, 253, 0.3));
}

button.cv-skill:focus-visible {
  outline: 2px solid var(--accent-fg, #58a6ff);
  outline-offset: 2px;
}

.cv-skill .cv-session-event-type {
  color: var(--accent-fg, #58a6ff);
  opacity: 1;
  font-weight: 600;
}

.cv-skill .cv-session-event-summary {
  color: var(--text-primary, #e6edf3);
}

.cv-skill-desc {
  color: var(--text-muted, #6e7681);
  margin-left: 4px;
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
