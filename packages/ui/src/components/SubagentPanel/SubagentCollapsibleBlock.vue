<script setup lang="ts">
import { computed } from "vue";
import MarkdownContent from "../MarkdownContent.vue";

const props = defineProps<{
  label: string;
  content: string;
  threshold: number;
  expanded: boolean;
  variant: "prompt" | "output";
  renderMarkdown: boolean;
}>();

const emit = defineEmits<{ "update:expanded": [value: boolean] }>();

const isLong = computed(() => props.content.length > props.threshold);
</script>

<template>
  <div class="sap-section">
    <div class="sap-section-header">
      <div class="sap-section-label">{{ label }}</div>
      <button
        v-if="isLong"
        class="sap-toggle"
        :aria-expanded="expanded"
        :aria-label="`Toggle ${label.toLowerCase()} visibility`"
        @click="emit('update:expanded', !expanded)"
      >
        {{ expanded ? "Collapse" : "Expand" }}
        <span :class="['sap-chevron', { open: expanded }]">▸</span>
      </button>
    </div>
    <div
      :class="[
        variant === 'output' ? 'sap-block-output' : 'sap-block-prompt',
        { collapsed: isLong && !expanded },
      ]"
    >
      <MarkdownContent :content="content" :render="renderMarkdown" />
    </div>
  </div>
</template>

<style scoped>
.sap-section { margin: 0; }
.sap-section-label { font-size: 0.6875rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.sap-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.sap-toggle { display: inline-flex; align-items: center; gap: 4px; border: none; background: transparent; color: var(--accent-fg); font-size: 0.6875rem; cursor: pointer; padding: 2px 6px; border-radius: var(--radius-sm); transition: background var(--transition-fast); }
.sap-toggle:hover { background: var(--accent-subtle); }
.sap-chevron { display: inline-block; font-size: 10px; transition: transform var(--transition-fast); }
.sap-chevron.open { transform: rotate(90deg); }
.sap-block-prompt { font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.55; white-space: pre-wrap; word-break: break-word; padding: 10px 12px; background: var(--canvas-inset); border-radius: var(--radius-md); border: 1px solid var(--border-muted); }
.sap-block-prompt.collapsed { max-height: 120px; overflow: hidden; mask-image: linear-gradient(to bottom, black 70%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%); }
.sap-block-output { font-size: 0.75rem; font-family: "JetBrains Mono", monospace; color: var(--text-secondary); line-height: 1.5; white-space: pre-wrap; word-break: break-all; padding: 10px 12px; background: var(--canvas-inset); border-radius: var(--radius-md); border: 1px solid var(--border-muted); }
.sap-block-output.collapsed { max-height: 160px; overflow: hidden; mask-image: linear-gradient(to bottom, black 70%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%); }
</style>
