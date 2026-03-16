<script setup lang="ts">
/**
 * PlainTextRenderer — fallback renderer for unknown or disabled tool types.
 * Simply wraps text in a scrollable <pre>.
 */
defineProps<{
  content: string;
}>();
</script>

<template>
  <pre class="plain-text-renderer">{{ content }}</pre>
</template>

<style scoped>
.plain-text-renderer {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 10px 12px;
  margin: 0;
  max-height: 400px;
  overflow: auto;
  color: var(--text-secondary);
  background: var(--canvas-default);
}
</style>
