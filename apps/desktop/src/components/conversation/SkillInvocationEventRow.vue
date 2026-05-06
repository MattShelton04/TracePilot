<script setup lang="ts">
import type { TurnSessionEvent } from "@tracepilot/types";
import { ExpandChevron, formatTime } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";

const props = defineProps<{
  event: TurnSessionEvent;
}>();

const router = useRouter();
const expanded = ref(false);

const skill = computed(() => props.event.skillInvocation);
const skillName = computed(() => skill.value?.name?.trim() || "unnamed skill");
const skillPath = computed(() => skill.value?.path?.trim() || undefined);
const description = computed(() => skill.value?.description?.trim() || "");

const editorDirectory = computed(() => {
  const p = skillPath.value;
  if (!p) return undefined;
  const dir = p.replace(/[\\/]SKILL\.md$/i, "");
  return dir === p ? undefined : dir;
});

const metaItems = computed(() => {
  const items: Array<{ label: string; value: string; mono?: boolean }> = [];
  if (skillPath.value) items.push({ label: "Path", value: skillPath.value, mono: true });
  if (skill.value?.contentLength != null) {
    items.push({ label: "Size", value: `${skill.value.contentLength.toLocaleString()} chars` });
  }
  return items;
});

function toggle() {
  expanded.value = !expanded.value;
}

function openSkillEditor() {
  if (!editorDirectory.value) return;
  pushRoute(router, ROUTE_NAMES.skillEditor, {
    params: { name: encodeURIComponent(editorDirectory.value) },
  });
}
</script>

<template>
  <div class="cv-skill-row">
    <button
      type="button"
      class="cv-skill-toggle"
      :aria-expanded="expanded"
      :aria-label="`Skill ${skillName}, ${expanded ? 'collapse' : 'expand'} details`"
      @click="toggle"
    >
      <span class="cv-skill-icon" aria-hidden="true">⚡</span>
      <span class="cv-skill-label">skill</span>
      <span class="cv-skill-name">{{ skillName }}</span>
      <span class="cv-skill-spacer" />
      <span v-if="event.timestamp" class="cv-skill-time">
        {{ formatTime(event.timestamp) }}
      </span>
      <ExpandChevron :expanded="expanded" />
    </button>

    <div v-if="expanded" class="cv-skill-body">
      <div class="cv-skill-section">
        <div class="cv-skill-section-label">Skill preview</div>
        <p v-if="description" class="cv-skill-description">{{ description }}</p>
        <p v-else class="cv-skill-description cv-skill-description-empty">
          No description provided.
        </p>
      </div>

      <dl v-if="metaItems.length" class="cv-skill-meta">
        <div v-for="item in metaItems" :key="item.label" class="cv-skill-meta-row">
          <dt>{{ item.label }}</dt>
          <dd :class="{ mono: item.mono }">{{ item.value }}</dd>
        </div>
      </dl>

      <div v-if="editorDirectory" class="cv-skill-actions">
        <button
          type="button"
          class="cv-skill-action"
          @click="openSkillEditor"
        >
          Open in skill editor
          <span aria-hidden="true">→</span>
        </button>
        <span class="cv-skill-action-hint">Opens the editor in a new view.</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cv-skill-row {
  margin: 4px 0;
  border: 1px solid var(--border-default, rgba(110, 118, 129, 0.2));
  border-radius: var(--radius-md, 8px);
  background: var(--canvas-subtle, rgba(110, 118, 129, 0.06));
  font-size: 12px;
  overflow: clip;
  contain: layout style;
}

.cv-skill-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px 6px 10px;
  background: none;
  border: none;
  color: var(--text-secondary, #8b949e);
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}

.cv-skill-toggle:hover {
  background: var(--canvas-subtle-hover, rgba(110, 118, 129, 0.12));
}

.cv-skill-toggle:focus-visible,
.cv-skill-action:focus-visible {
  outline: 2px solid var(--accent-fg, #58a6ff);
  outline-offset: 2px;
}

.cv-skill-icon {
  flex-shrink: 0;
}

.cv-skill-label {
  flex-shrink: 0;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #8b949e);
}

.cv-skill-name {
  color: var(--text-primary, #e6edf3);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.cv-skill-spacer {
  flex: 1;
  min-width: 8px;
}

.cv-skill-time {
  flex-shrink: 0;
  color: var(--text-muted, #6e7681);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.cv-skill-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 14px 12px;
  background: var(--canvas-default, #0d1117);
  border-top: 1px solid var(--border-default, rgba(110, 118, 129, 0.2));
}

.cv-skill-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cv-skill-section-label,
.cv-skill-meta dt {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted, #6e7681);
}

.cv-skill-description {
  margin: 0;
  color: var(--text-primary, #e6edf3);
  font-size: 12.5px;
  line-height: 1.5;
}

.cv-skill-description-empty {
  color: var(--text-muted, #6e7681);
  font-style: italic;
}

.cv-skill-meta {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 12px;
  row-gap: 4px;
  font-size: 11.5px;
}

.cv-skill-meta-row {
  display: contents;
}

.cv-skill-meta dt {
  align-self: center;
}

.cv-skill-meta dd {
  margin: 0;
  color: var(--text-secondary, #8b949e);
  word-break: break-all;
}

.cv-skill-meta dd.mono {
  color: var(--text-primary, #e6edf3);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
}

.cv-skill-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.cv-skill-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid var(--border-default, rgba(110, 118, 129, 0.3));
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--accent-fg, #58a6ff);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.cv-skill-action:hover {
  background: var(--canvas-subtle-hover, rgba(110, 118, 129, 0.12));
}

.cv-skill-action-hint {
  color: var(--text-muted, #6e7681);
  font-size: 11px;
}
</style>
