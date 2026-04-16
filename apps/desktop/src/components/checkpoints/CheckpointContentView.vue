<script setup lang="ts">
import { ExpandChevron, MarkdownContent } from "@tracepilot/ui";
import { computed, ref } from "vue";
import {
  type CheckpointSections,
  parseCheckpointSections,
  SECTION_DEFS,
  type SectionMeta,
} from "./checkpointParser";

const props = defineProps<{
  content: string;
}>();

const sections = computed(() => parseCheckpointSections(props.content));
const showRaw = ref(false);
const copied = ref(false);

async function copyContent() {
  await navigator.clipboard.writeText(props.content);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 1500);
}

// Track expanded state per section (overview expanded by default)
const expanded = ref<Set<string>>(
  new Set(SECTION_DEFS.filter((d) => d.defaultExpanded).map((d) => d.key)),
);

function toggle(key: string) {
  if (expanded.value.has(key)) {
    expanded.value.delete(key);
  } else {
    expanded.value.add(key);
  }
}

function expandAll() {
  for (const def of SECTION_DEFS) {
    if (sections.value?.[def.key]) expanded.value.add(def.key);
  }
}

function collapseAll() {
  expanded.value.clear();
}

const availableSections = computed<SectionMeta[]>(() => {
  if (!sections.value) return [];
  return SECTION_DEFS.filter((d) => sections.value![d.key]);
});

function sectionContent(key: keyof CheckpointSections): string {
  return sections.value?.[key] ?? "";
}

const allExpanded = computed(() =>
  availableSections.value.every((d) => expanded.value.has(d.key)),
);
</script>

<template>
  <!-- Structured rendering -->
  <div v-if="sections && !showRaw" class="cp-structured">
    <div class="cp-toolbar">
      <button class="cp-tool-btn" @click="allExpanded ? collapseAll() : expandAll()">
        {{ allExpanded ? 'Collapse all' : 'Expand all' }}
      </button>
      <button class="cp-tool-btn" @click="showRaw = true">View raw</button>
      <button class="cp-tool-btn" @click="copyContent()">{{ copied ? '✓ Copied' : 'Copy' }}</button>
    </div>

    <div
      v-for="def in availableSections"
      :key="def.key"
      class="cp-section"
    >
      <button class="cp-section-header" @click="toggle(def.key)">
        <span class="cp-section-icon">{{ def.icon }}</span>
        <span class="cp-section-label">{{ def.label }}</span>
        <ExpandChevron :expanded="expanded.has(def.key)" class="cp-chevron" />
      </button>
      <div v-if="expanded.has(def.key)" class="cp-section-body">
        <MarkdownContent :content="sectionContent(def.key)" />
      </div>
    </div>
  </div>

  <!-- Raw view (toggled from structured) -->
  <div v-else-if="sections && showRaw" class="cp-raw">
    <div class="cp-toolbar">
      <button class="cp-tool-btn" @click="showRaw = false">Structured view</button>
      <button class="cp-tool-btn" @click="copyContent()">{{ copied ? '✓ Copied' : 'Copy' }}</button>
    </div>
    <pre class="cp-raw-content">{{ content }}</pre>
  </div>

  <!-- Fallback: plain markdown -->
  <div v-else class="cp-fallback">
    <div class="cp-toolbar">
      <button class="cp-tool-btn" @click="copyContent()">{{ copied ? '✓ Copied' : 'Copy' }}</button>
    </div>
    <MarkdownContent :content="content" />
  </div>
</template>

<style scoped>
.cp-structured {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cp-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-bottom: 4px;
}

.cp-tool-btn {
  background: none;
  border: none;
  color: var(--accent-fg, #58a6ff);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm, 4px);
}

.cp-tool-btn:hover {
  background: var(--surface-secondary, rgba(255, 255, 255, 0.05));
}

.cp-section {
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
}

.cp-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: var(--surface-secondary, rgba(255, 255, 255, 0.04));
  border: none;
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary, #e6edf3);
  transition: background 0.15s;
}

.cp-section-header:hover {
  background: var(--surface-tertiary, rgba(255, 255, 255, 0.08));
}

.cp-section-icon {
  flex-shrink: 0;
  font-size: 0.875rem;
}

.cp-section-label {
  flex-grow: 1;
  text-align: left;
}

.cp-chevron {
  flex-shrink: 0;
  opacity: 0.5;
}

.cp-section-body {
  padding: 8px 12px 12px 34px;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--text-secondary, #8b949e);
}

.cp-fallback {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-secondary, #8b949e);
}

.cp-raw {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cp-raw-content {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-secondary, #8b949e);
  background: var(--surface-secondary, rgba(255, 255, 255, 0.03));
  border-radius: var(--radius-md, 8px);
  padding: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
