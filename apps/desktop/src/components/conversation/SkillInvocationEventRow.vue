<script setup lang="ts">
import type { TurnSessionEvent } from "@tracepilot/types";
import { formatTime } from "@tracepilot/ui";
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
const editorDirectory = computed(() => {
  const p = skillPath.value;
  if (!p) return undefined;
  const dir = p.replace(/[\\/]SKILL\.md$/i, "");
  return dir === p ? undefined : dir;
});

const metaItems = computed(() => {
  const items: Array<{ label: string; value: string; mono?: boolean }> = [];
  if (skillPath.value) items.push({ label: "Path", value: skillPath.value, mono: true });
  if (skill.value?.contextLength != null) {
    items.push({ label: "Context", value: `${skill.value.contextLength.toLocaleString()} chars` });
  }
  if (skill.value?.contentLength != null) {
    items.push({ label: "Content", value: `${skill.value.contentLength.toLocaleString()} chars` });
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
  <div class="cv-skill-invoked" :class="{ expanded }">
    <button
      type="button"
      class="cv-skill-toggle"
      :aria-expanded="expanded"
      :aria-label="`Skill ${skillName}, ${expanded ? 'collapse' : 'expand'} details`"
      @click="toggle"
    >
      <span class="cv-skill-glyph" aria-hidden="true">⚡</span>
      <span class="cv-skill-label">skill</span>
      <span class="cv-skill-name">{{ skillName }}</span>
      <span
        v-if="skill?.contextFolded"
        class="cv-skill-folded"
        :title="skill.contextLength != null ? `${skill.contextLength.toLocaleString()} chars folded out of context` : 'Context folded'"
      >
        <span class="cv-skill-folded-dot" aria-hidden="true" />
        folded
      </span>
      <span class="cv-skill-spacer" />
      <span v-if="event.timestamp" class="cv-skill-time">
        {{ formatTime(event.timestamp) }}
      </span>
      <span class="cv-skill-chevron" :class="{ open: expanded }" aria-hidden="true">⌄</span>
    </button>

    <div v-if="expanded" class="cv-skill-details">
      <p v-if="skill?.description" class="cv-skill-description">
        {{ skill.description }}
      </p>
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
      </div>
    </div>
  </div>
</template>

<style scoped>
.cv-skill-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px 7px 8px;
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}

.cv-skill-invoked {
  margin: 4px 0;
  border: 1px solid rgba(56, 139, 253, 0.18);
  border-left: 3px solid var(--accent-emphasis, #1f6feb);
  border-radius: var(--radius-md, 8px);
  background: rgba(56, 139, 253, 0.06);
  color: var(--text-secondary, #8b949e);
  font-size: 12px;
  overflow: hidden;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.cv-skill-invoked.expanded {
  background: rgba(56, 139, 253, 0.09);
  border-color: rgba(56, 139, 253, 0.35);
}

.cv-skill-toggle:hover {
  background: rgba(56, 139, 253, 0.08);
}

.cv-skill-toggle:focus-visible,
.cv-skill-action:focus-visible {
  outline: 2px solid var(--accent-fg, #58a6ff);
  outline-offset: 2px;
}

.cv-skill-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 5px;
  background: rgba(56, 139, 253, 0.14);
  color: var(--accent-fg, #58a6ff);
}

.cv-skill-label,
.cv-skill-meta dt {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-placeholder, #6e7681);
}

.cv-skill-label {
  flex-shrink: 0;
}

.cv-skill-name {
  color: var(--text-primary, #c9d1d9);
  font-weight: 600;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.cv-skill-folded,
.cv-skill-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  font-weight: 500;
}

.cv-skill-folded {
  flex-shrink: 0;
  padding: 1px 7px 1px 6px;
  background: rgba(210, 153, 34, 0.12);
  color: var(--warning-fg, #d29922);
  font-size: 10.5px;
  letter-spacing: 0.01em;
}

.cv-skill-folded-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.cv-skill-spacer {
  flex: 1;
  min-width: 8px;
}

.cv-skill-time,
.cv-skill-chevron {
  flex-shrink: 0;
  color: var(--text-placeholder, #6e7681);
  font-size: 11px;
}

.cv-skill-time {
  font-variant-numeric: tabular-nums;
}

.cv-skill-chevron {
  transition: transform 0.18s ease, color 0.15s ease;
}

.cv-skill-chevron.open {
  transform: rotate(180deg);
  color: var(--accent-fg, #58a6ff);
}

.cv-skill-toggle:hover .cv-skill-chevron {
  color: var(--text-secondary, #8b949e);
}

.cv-skill-details {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: -1px;
  padding: 10px 12px 12px 36px;
  border-top: 1px solid rgba(56, 139, 253, 0.16);
}

.cv-skill-description {
  margin: 0;
  color: var(--text-primary, #c9d1d9);
  font-size: 12.5px;
  line-height: 1.5;
}

.cv-skill-meta {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 12px;
  row-gap: 4px;
  font-size: 11.5px;
}

.cv-skill-actions {
  display: flex;
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
  color: var(--text-primary, #c9d1d9);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
}

.cv-skill-action {
  padding: 4px 10px;
  border: 1px solid rgba(56, 139, 253, 0.35);
  background: rgba(56, 139, 253, 0.1);
  color: var(--accent-fg, #58a6ff);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.cv-skill-action:hover {
  background: rgba(56, 139, 253, 0.2);
  border-color: var(--accent-fg, #58a6ff);
}
</style>
