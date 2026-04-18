<script setup lang="ts">
/**
 * SystemMessagePanel — collapsible disclosure for system.message event content.
 *
 * Displays the injected system message (role="system" or role="developer" in
 * the OpenAI API sense) from events.jsonl. Empirically this is always the full
 * Copilot CLI system prompt, emitted once per turn in auto-model-selection
 * sessions and also re-emitted after each context compaction.
 */
import { ExpandChevron, MarkdownContent, useClipboard } from "@tracepilot/ui";
import { computed, ref } from "vue";

const props = defineProps<{
  content: string;
  /** Display index when multiple system messages exist in one turn (0-based). */
  index?: number;
}>();

const expanded = ref(false);
const { copy, copied } = useClipboard();

/** Approximate word count — cached, only recomputes when content changes. */
const wordCount = computed(() => {
  return props.content.trim().split(/\s+/).filter(Boolean).length;
});

const label = computed(() => {
  const suffix = props.index != null && props.index > 0 ? ` #${props.index + 1}` : "";
  return `System Message${suffix}`;
});

async function handleCopy(e: MouseEvent) {
  e.stopPropagation();
  await copy(props.content);
}
</script>

<template>
  <div class="smp-wrapper">
    <div class="smp-header">
      <button
        class="smp-toggle"
        :aria-expanded="expanded"
        :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${label}`"
        @click="expanded = !expanded"
      >
        <span class="smp-icon" aria-hidden="true">🔧</span>
        <span class="smp-label">{{ label }}</span>
        <span class="smp-badge">{{ wordCount.toLocaleString() }} words</span>
      </button>
      <button
        class="smp-copy"
        :title="copied ? 'Copied!' : 'Copy to clipboard'"
        :aria-label="copied ? 'Copied!' : 'Copy system message to clipboard'"
        @click="handleCopy"
      >{{ copied ? "✓ Copied" : "Copy" }}</button>
      <button
        class="smp-expand-btn"
        :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${label}`"
        @click="expanded = !expanded"
      >
        <ExpandChevron :expanded="expanded" />
      </button>
    </div>

    <div v-if="expanded" class="smp-body">
      <MarkdownContent :content="content" :render="true" />
    </div>
  </div>
</template>

<style scoped>
.smp-wrapper {
  margin: 4px 0 6px;
  border: 1px solid var(--border-default, rgba(110, 118, 129, 0.2));
  border-radius: var(--radius-md, 8px);
  overflow: clip;
  font-size: 12px;
  contain: layout style;
}

.smp-header {
  display: flex;
  align-items: center;
  width: 100%;
  background: var(--canvas-subtle, rgba(110, 118, 129, 0.06));
}

.smp-header:hover {
  background: var(--canvas-subtle-hover, rgba(110, 118, 129, 0.12));
}

.smp-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  padding: 6px 6px 6px 10px;
  background: none;
  border: none;
  color: var(--text-secondary, #8b949e);
  cursor: pointer;
  text-align: left;
  min-width: 0;
}

.smp-icon {
  flex-shrink: 0;
}

.smp-label {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.smp-badge {
  margin-left: 2px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--neutral-muted, rgba(110, 118, 129, 0.15));
  color: var(--text-muted, #6e7681);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.smp-copy {
  background: none;
  border: none;
  color: var(--accent-fg, #58a6ff);
  font-size: 0.7rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm, 4px);
  flex-shrink: 0;
}

.smp-copy:hover {
  background: var(--surface-secondary, rgba(255, 255, 255, 0.05));
}

.smp-expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 10px 0 4px;
  flex-shrink: 0;
}

.smp-toggle:hover .smp-chevron {
  color: var(--text-secondary, #8b949e);
}

.smp-body {
  padding: 10px 14px;
  background: var(--canvas-default, #0d1117);
  color: var(--text-primary, #e6edf3);
  font-size: 12px;
  border-top: 1px solid var(--border-default, rgba(110, 118, 129, 0.2));
  max-height: 500px;
  overflow-y: auto;
}
</style>
