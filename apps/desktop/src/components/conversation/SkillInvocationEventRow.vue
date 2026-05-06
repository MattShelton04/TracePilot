<script setup lang="ts">
/**
 * SkillInvocationEventRow — collapsible disclosure for skill invocations.
 *
 * Compact header shows the skill emoji, name and one-line description so the
 * row sits in the conversation flow. It renders inside the originating `skill`
 * tool row when correlation is available, and remains usable as a fallback for
 * standalone `skill.invoked` session events.
 */
import type { SkillInvocationEvent, TurnSessionEvent, TurnToolCall } from "@tracepilot/types";
import { ExpandChevron, formatDuration, formatTime } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { usePreferencesStore } from "@/stores/preferences";

const props = defineProps<{
  event?: TurnSessionEvent;
  toolCall?: TurnToolCall;
}>();

const router = useRouter();
const prefs = usePreferencesStore();

const expanded = ref(false);

const skill = computed<SkillInvocationEvent | undefined>(
  () => props.toolCall?.skillInvocation ?? props.event?.skillInvocation,
);
const skillName = computed(() => skill.value?.name?.trim() || "");
const skillDescription = computed(() => skill.value?.description?.trim() || "");
const skillPath = computed(() => skill.value?.path?.trim() || "");
const skillContent = computed(() => skill.value?.content ?? "");
const capturedContentLength = computed(() => Array.from(skillContent.value).length);
const fullContentLength = computed(() => skill.value?.contentLength ?? 0);
const isContentTruncated = computed(
  () => capturedContentLength.value > 0 && fullContentLength.value > capturedContentLength.value,
);

const editorTarget = computed(() => {
  const path = skillPath.value;
  if (!path) return "";
  if (!/[\\/]SKILL\.md$/i.test(path)) return "";
  return path.replace(/[\\/]SKILL\.md$/i, "");
});

const canOpenEditor = computed(
  () => Boolean(editorTarget.value) && prefs.isFeatureEnabled("skills"),
);

const timestamp = computed(() => props.event?.timestamp ?? props.toolCall?.startedAt);
const durationMs = computed(() => props.toolCall?.durationMs);
const success = computed(() => props.toolCall?.success);
const headerLabel = computed(() => skillName.value || props.event?.summary || "Skill invoked");
const ariaLabel = computed(
  () => `${expanded.value ? "Collapse" : "Expand"} skill ${headerLabel.value}`,
);

function toggle() {
  expanded.value = !expanded.value;
}

function openEditor(e: MouseEvent) {
  e.stopPropagation();
  if (!canOpenEditor.value) return;
  pushRoute(router, ROUTE_NAMES.skillEditor, {
    params: { name: encodeURIComponent(editorTarget.value) },
  });
}
</script>

<template>
  <div class="skill-row" :class="{ 'skill-row--expanded': expanded }">
    <button
      type="button"
      class="skill-row__header"
      :aria-expanded="expanded"
      :aria-label="ariaLabel"
      @click="toggle"
    >
      <span class="skill-row__icon" aria-hidden="true">⚡</span>
      <span class="skill-row__tag">skill</span>
      <span class="skill-row__name">{{ headerLabel }}</span>
      <span v-if="skillDescription" class="skill-row__desc">— {{ skillDescription }}</span>
      <span v-if="timestamp" class="skill-row__time">
        {{ formatTime(timestamp) }}
      </span>
      <span v-if="durationMs != null" class="skill-row__duration">
        {{ formatDuration(durationMs) }}
      </span>
      <span v-if="success === true" class="skill-row__status skill-row__status--success">✓</span>
      <span v-else-if="success === false" class="skill-row__status skill-row__status--failed">✗</span>
      <span class="skill-row__chev" aria-hidden="true">
        <ExpandChevron :expanded="expanded" />
      </span>
    </button>

    <div v-if="expanded" class="skill-row__body">
      <div v-if="skillPath || canOpenEditor" class="skill-row__meta">
        <span v-if="skillPath" class="skill-row__path" :title="skillPath">
          {{ skillPath }}
        </span>
        <button
          v-if="canOpenEditor"
          type="button"
          class="skill-row__editor-btn"
          @click="openEditor"
        >
          Open in editor
        </button>
      </div>

      <pre v-if="skillContent" class="skill-row__content">{{ skillContent }}</pre>
      <p v-else class="skill-row__empty">No skill content captured for this invocation.</p>

      <p v-if="isContentTruncated" class="skill-row__truncated">
        Showing first {{ capturedContentLength.toLocaleString() }} of
        {{ fullContentLength.toLocaleString() }} characters.
      </p>
    </div>
  </div>
</template>

<style scoped>
.skill-row {
  margin: 4px 0;
  border: 1px solid var(--border-default, rgba(110, 118, 129, 0.2));
  border-radius: var(--radius-md, 8px);
  background: var(--canvas-subtle, rgba(110, 118, 129, 0.06));
  font-size: 12px;
  overflow: clip;
  contain: layout style;
}

.skill-row--expanded {
  background: var(--canvas-default, #0d1117);
}

.skill-row__header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: none;
  border: none;
  color: var(--text-secondary, #8b949e);
  cursor: pointer;
  text-align: left;
  font: inherit;
  min-width: 0;
}

.skill-row__header:hover {
  background: var(--canvas-subtle-hover, rgba(110, 118, 129, 0.12));
}

.skill-row__header:focus-visible {
  outline: 2px solid var(--accent-fg, #58a6ff);
  outline-offset: -2px;
}

.skill-row__icon {
  flex-shrink: 0;
}

.skill-row__tag {
  flex-shrink: 0;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-fg, #58a6ff);
}

.skill-row__name {
  flex-shrink: 0;
  color: var(--text-primary, #e6edf3);
  font-weight: 500;
}

.skill-row__desc {
  flex: 1;
  min-width: 0;
  color: var(--text-muted, #6e7681);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-row__time {
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.6;
}

.skill-row__duration,
.skill-row__status {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted, #6e7681);
}

.skill-row__status {
  font-weight: 700;
}

.skill-row__status--success {
  color: var(--success-fg, #3fb950);
}

.skill-row__status--failed {
  color: var(--danger-fg, #f85149);
}

.skill-row__chev {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-muted, #6e7681);
}

.skill-row__body {
  padding: 10px 14px 12px;
  border-top: 1px solid var(--border-default, rgba(110, 118, 129, 0.2));
  color: var(--text-primary, #e6edf3);
}

.skill-row__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.skill-row__path {
  flex: 1;
  min-width: 0;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--text-muted, #6e7681);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-row__editor-btn {
  flex-shrink: 0;
  padding: 3px 10px;
  border: 1px solid var(--accent-muted, rgba(56, 139, 253, 0.4));
  border-radius: var(--radius-sm, 4px);
  background: var(--accent-subtle, rgba(56, 139, 253, 0.08));
  color: var(--accent-fg, #58a6ff);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.skill-row__editor-btn:hover {
  background: var(--accent-muted, rgba(56, 139, 253, 0.2));
  border-color: var(--accent-fg, #58a6ff);
}

.skill-row__editor-btn:focus-visible {
  outline: 2px solid var(--accent-fg, #58a6ff);
  outline-offset: 2px;
}

.skill-row__content {
  margin: 0;
  padding: 10px 12px;
  max-height: 360px;
  overflow: auto;
  background: var(--canvas-subtle, rgba(110, 118, 129, 0.08));
  border: 1px solid var(--border-default, rgba(110, 118, 129, 0.18));
  border-radius: var(--radius-sm, 4px);
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.skill-row__empty,
.skill-row__truncated {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-muted, #6e7681);
}
</style>
