<script setup lang="ts">
/**
 * MarkdownContent — placeholder for markdown rendering.
 *
 * Currently renders content as safe plaintext with pre-wrap formatting.
 * TODO: Replace with a proper markdown library (e.g., markdown-it, marked).
 */
import { computed } from 'vue';

const props = defineProps<{
  /** Markdown text to render. */
  content: string;
  /** Maximum height before showing a scrollbar (CSS value). */
  maxHeight?: string;
}>();

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const rendered = computed(() => escapeHtml(props.content));
</script>

<template>
  <div
    class="markdown-content"
    :style="maxHeight ? { maxHeight, overflowY: 'auto' } : undefined"
    v-html="rendered"
  />
</template>

<style scoped>
.markdown-content {
  font-size: 0.8125rem;
  line-height: 1.65;
  color: var(--text-primary);
  word-break: break-word;
  white-space: pre-wrap;
  font-family: inherit;
}
</style>
