<script setup lang="ts">
import type { TurnSessionEvent } from "@tracepilot/types";
import { formatTime } from "@tracepilot/ui";
import { computed } from "vue";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";

const props = defineProps<{
  event: TurnSessionEvent;
}>();

const router = useRouter();
const skill = computed(() => props.event.skillInvocation);
const skillPath = computed(() => skill.value?.path);
const editorDirectory = computed(() => skillEditorDirectory(skillPath.value));

function skillEditorDirectory(path: string | undefined): string | undefined {
  const trimmed = path?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/[\\/]SKILL\.md$/i, "");
}

function compactPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return path;
  return `…${parts.slice(-3).join("\\")}`;
}

function formatChars(length: number | undefined): string {
  if (length == null) return "";
  return `${length.toLocaleString()} chars`;
}

function openSkillEditor() {
  if (!editorDirectory.value) return;
  pushRoute(router, ROUTE_NAMES.skillEditor, {
    params: { name: encodeURIComponent(editorDirectory.value) },
  });
}
</script>

<template>
  <div
    class="cv-session-event cv-skill-invoked"
    :class="{ clickable: editorDirectory }"
    :role="editorDirectory ? 'button' : undefined"
    :tabindex="editorDirectory ? 0 : undefined"
    :title="editorDirectory ? 'Open skill in editor' : undefined"
    @click="openSkillEditor"
    @keydown.enter="openSkillEditor"
    @keydown.space.prevent="openSkillEditor"
  >
    <span class="cv-session-event-icon">⚡</span>
    <div class="cv-skill-main">
      <div class="cv-skill-heading">
        <span class="cv-session-event-type">skill invoked</span>
        <span class="cv-skill-name">{{ skill?.name || "unnamed skill" }}</span>
        <span
          v-if="skill?.contextFolded"
          class="cv-skill-badge"
          :title="formatChars(skill.contextLength)"
        >
          context folded
        </span>
      </div>
      <span class="cv-session-event-summary">
        {{ skill?.description || event.summary }}
      </span>
      <code
        v-if="skillPath"
        class="cv-skill-path"
        :title="skillPath"
      >
        {{ compactPath(skillPath) }}
      </code>
    </div>
    <span v-if="event.timestamp" class="cv-session-event-time">
      {{ formatTime(event.timestamp) }}
    </span>
  </div>
</template>

<style scoped>
.cv-session-event {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-md, 8px);
  margin: 4px 0;
  font-size: 12px;
}

.cv-session-event-icon,
.cv-session-event-time,
.cv-skill-badge {
  flex-shrink: 0;
}

.cv-session-event-type,
.cv-skill-path {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
}

.cv-session-event-type {
  opacity: 0.7;
}

.cv-session-event-summary,
.cv-skill-name,
.cv-skill-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-session-event-summary,
.cv-skill-main {
  min-width: 0;
}

.cv-session-event-time {
  font-size: 11px;
  opacity: 0.6;
}

.cv-skill-invoked {
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
}

.cv-skill-badge {
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
}
</style>
