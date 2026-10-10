<script setup lang="ts">
/**
 * The anchor of a turn that a background task's completion opened (a Claude
 * Code `<task-notification>` that woke an idle session), in place of the
 * "User" anchor: one compact row per task, its report behind a toggle and a
 * Monitor's event in view.
 */
import type { TaskNotification } from "@tracepilot/types";
import { formatNumberFull, formatTokens } from "@tracepilot/types";
import type { StatusPillTone } from "@tracepilot/ui";
import { ExpandChevron, formatTime, MarkdownContent, StatusPill } from "@tracepilot/ui";
import { Activity, Bell, Bot, CornerUpLeft, SquareTerminal } from "lucide-vue-next";
import { reactive } from "vue";

const props = defineProps<{
  notifications: TaskNotification[];
  turnIndex: number;
  timestamp?: string | null;
  eventIndex?: number | null;
  renderMarkdown: boolean;
  /** Whether the call that launched a task is in this conversation. */
  canRevealLaunch?: (toolUseId: string) => boolean;
}>();

const emit = defineEmits<{
  revealLaunch: [toolUseId: string];
}>();

const openResults = reactive(new Set<number>());

function toggleResult(index: number) {
  if (openResults.has(index)) openResults.delete(index);
  else openResults.add(index);
}

const KIND_LABEL: Record<TaskNotification["kind"], string> = {
  agent: "Agent",
  shell: "Background shell",
  monitor: "Monitor",
};

function title(note: TaskNotification): string {
  if (note.summary) return note.summary;
  const status = note.status ?? "finished";
  if (note.kind === "monitor") return "Monitor event";
  return note.kind === "agent" ? `Agent ${status}` : `Background command ${status}`;
}

/** `9s`, `10m`, `2m 30s`, `1h 5m`: as the turn's readable line writes it. */
function compactDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const [hours, mins, secs] = [
    Math.floor(total / 3600),
    Math.floor((total % 3600) / 60),
    total % 60,
  ];
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  if (mins > 0) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  return `${secs}s`;
}

function tone(note: TaskNotification): StatusPillTone {
  switch (note.status) {
    case "completed":
      return note.exitCode != null && note.exitCode !== 0 ? "danger" : "success";
    case "failed":
      return "danger";
    case "stopped":
    case "killed":
    case "cancelled":
      return "neutral";
    default:
      return "accent";
  }
}

function stats(note: TaskNotification): string[] {
  const parts: string[] = [];
  if (note.totalTokens != null) parts.push(`${formatTokens(note.totalTokens)} tokens`);
  if (note.toolUses != null) {
    parts.push(
      `${formatNumberFull(note.toolUses)} ${note.toolUses === 1 ? "tool use" : "tool uses"}`,
    );
  }
  if (note.durationMs != null) parts.push(compactDuration(note.durationMs));
  if (note.exitCode != null) parts.push(`exit ${note.exitCode}`);
  return parts;
}

function canReveal(note: TaskNotification): boolean {
  return note.toolUseId != null && (props.canRevealLaunch?.(note.toolUseId) ?? false);
}
</script>

<template>
  <div
    class="cv-notice"
    data-testid="task-notification"
    :data-event-idx="eventIndex != null ? eventIndex : undefined"
  >
    <div class="cv-notice-header">
      <Bell :size="14" class="cv-notice-bell" aria-hidden="true" />
      <span class="cv-notice-name">Notification</span>
      <span class="cv-notice-turn">T{{ turnIndex }}</span>
      <span v-if="timestamp" class="cv-notice-time">{{ formatTime(timestamp) }}</span>
    </div>
    <div
      v-for="(note, index) in notifications"
      :key="`${note.taskId ?? 'task'}-${index}`"
      class="cv-notice-task"
      :data-tool-use-id="note.toolUseId"
    >
      <div class="cv-notice-row">
        <span class="cv-notice-kind" :title="KIND_LABEL[note.kind]">
          <Bot v-if="note.kind === 'agent'" :size="14" aria-hidden="true" />
          <Activity v-else-if="note.kind === 'monitor'" :size="14" aria-hidden="true" />
          <SquareTerminal v-else :size="14" aria-hidden="true" />
        </span>
        <span class="cv-notice-title">{{ title(note) }}</span>
        <StatusPill v-if="note.status" :tone="tone(note)" :label="note.status" size="xs" />
      </div>
      <pre v-if="note.event" class="cv-notice-event">{{ note.event }}</pre>
      <div
        v-if="stats(note).length || note.result || canReveal(note)"
        class="cv-notice-meta"
      >
        <span v-if="stats(note).length" class="cv-notice-stats">{{ stats(note).join(" · ") }}</span>
        <button
          v-if="note.result"
          type="button"
          class="cv-notice-action"
          :aria-expanded="openResults.has(index)"
          @click="toggleResult(index)"
        >
          <ExpandChevron :expanded="openResults.has(index)" />
          Result
        </button>
        <button
          v-if="canReveal(note)"
          type="button"
          class="cv-notice-action"
          @click="emit('revealLaunch', note.toolUseId!)"
        >
          <CornerUpLeft :size="12" aria-hidden="true" />
          Go to launch
        </button>
      </div>
      <div v-if="note.result && openResults.has(index)" class="cv-notice-result">
        <MarkdownContent :content="note.result" :render="renderMarkdown" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.cv-notice {
  border-left: 3px solid var(--border-emphasis);
  background: var(--canvas-subtle);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  padding: 8px 16px;
  margin: 12px 0 4px;
}

.cv-notice-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.cv-notice-bell {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.cv-notice-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-secondary);
}

.cv-notice-turn {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-placeholder);
}

.cv-notice-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-placeholder);
}

.cv-notice-task {
  padding: 4px 0;
}

.cv-notice-task + .cv-notice-task {
  border-top: 1px solid var(--border-subtle);
}

.cv-notice-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.cv-notice-kind {
  display: inline-flex;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.cv-notice-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.cv-notice-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 4px 0 0 22px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.cv-notice-stats {
  font-family: var(--font-mono);
  font-size: 11px;
}

.cv-notice-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  background: none;
  border: none;
  color: var(--text-link);
  font-size: 12px;
  cursor: pointer;
}

.cv-notice-action:hover {
  text-decoration: underline;
}

.cv-notice-action:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

.cv-notice-event {
  margin: 4px 0 0 22px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--canvas-inset);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow-y: auto;
}

.cv-notice-result {
  margin: 8px 0 4px 22px;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
  font-size: 13px;
  line-height: 1.55;
  max-height: 480px;
  overflow-y: auto;
}
</style>
