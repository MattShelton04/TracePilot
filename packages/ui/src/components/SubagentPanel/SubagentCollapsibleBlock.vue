<script setup lang="ts">
import { computed } from "vue";
import MarkdownContent from "../MarkdownContent.vue";

defineProps<{
  label: string;
  content: string;
  threshold: number;
  expanded: boolean;
  renderMarkdown: boolean;
}>();

const emit = defineEmits<{ "update:expanded": [value: boolean] }>();

const isLong = (content: string, threshold: number) => content.length > threshold;
</script>

<template>
  <div class="sap-section">
    <div class="sap-section-header">
      <div class="sap-section-label">{{ label }}</div>
      <button
        v-if="isLong(content, threshold)"
        class="sap-toggle"
        :aria-expanded="expanded"
        :aria-label="`Toggle ${label.toLowerCase()} visibility`"
        @click="emit('update:expanded', !expanded)"
      >
        {{ expanded ? "Collapse" : "Expand" }}
        <span :class="['sap-chevron', { open: expanded }]">▸</span>
      </button>
    </div>
    <div :class="['sap-block', { collapsed: isLong(content, threshold) && !expanded }]">
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
.sap-block { font-size: 0.8125rem; color: var(--text-primary); line-height: 1.55; padding: 10px 12px; background: var(--canvas-inset); border-radius: var(--radius-md); border: 1px solid var(--border-muted); }
.sap-block.collapsed { max-height: 220px; overflow: hidden; mask-image: linear-gradient(to bottom, black 70%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%); }
.sap-block :deep(.markdown-content) { font-size: inherit; line-height: inherit; }
</style>
