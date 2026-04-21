<script setup lang="ts">
import { MarkdownContent, truncateText } from "@tracepilot/ui";
import { computed } from "vue";

const props = defineProps<{
  label: string;
  content: string;
  /** Character threshold above which the block becomes collapsible. */
  threshold: number;
  /** Initial expanded state. */
  expanded: boolean;
  /** Visual variant — "prompt" is prose; "output" uses mono font. */
  variant: "prompt" | "output";
  renderMarkdown: boolean;
}>();

const emit = defineEmits<{
  "update:expanded": [value: boolean];
}>();

const isLong = computed(() => props.content.length > props.threshold);
const displayContent = computed(() =>
  isLong.value && !props.expanded ? truncateText(props.content, props.threshold) : props.content,
);
</script>

<template>
  <div class="cv-panel-section">
    <div class="cv-panel-section-header">
      <div class="cv-panel-section-label">{{ label }}</div>
      <button
        v-if="isLong"
        class="cv-panel-toggle"
        :aria-expanded="expanded"
        :aria-label="`Toggle ${label.toLowerCase()} visibility`"
        @click="emit('update:expanded', !expanded)"
      >
        {{ expanded ? "Collapse" : "Expand" }}
        <span :class="['cv-panel-chevron', { open: expanded }]">▸</span>
      </button>
    </div>
    <div
      :class="[
        variant === 'output' ? 'cv-panel-result' : 'cv-panel-prompt',
        { collapsed: isLong && !expanded },
      ]"
    >
      <MarkdownContent :content="displayContent" :render="renderMarkdown" />
    </div>
  </div>
</template>

<style scoped>
.cv-panel-section {
  margin-bottom: 16px;
}

.cv-panel-section-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.cv-panel-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.cv-panel-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--accent-fg);
  font-size: 0.6875rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.cv-panel-toggle:hover {
  background: var(--accent-subtle);
}

.cv-panel-chevron {
  display: inline-block;
  font-size: 10px;
  transition: transform var(--transition-fast);
}

.cv-panel-chevron.open {
  transform: rotate(90deg);
}

/* ── Prompt variant ───────────────────────────────────────────── */

.cv-panel-prompt {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 10px 12px;
  background: var(--canvas-inset);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-muted);
}

.cv-panel-prompt.collapsed {
  max-height: 120px;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
}

/* ── Output variant ───────────────────────────────────────────── */

.cv-panel-result {
  font-size: 0.75rem;
  font-family: "JetBrains Mono", monospace;
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  padding: 10px 12px;
  background: var(--canvas-inset);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-muted);
}

.cv-panel-result.collapsed {
  max-height: 160px;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
}
</style>
