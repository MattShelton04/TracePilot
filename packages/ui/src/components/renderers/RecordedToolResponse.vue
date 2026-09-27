<script setup lang="ts">
/** Preserves the server's exact response alongside a parsed presentation. */
defineProps<{ content: string }>();
</script>

<template>
  <details v-if="content" class="recorded-tool-response">
    <summary>Raw response</summary>
    <pre>{{ content }}</pre>
  </details>
</template>

<style scoped>
.recorded-tool-response {
  min-width: 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.recorded-tool-response summary {
  width: fit-content;
  max-width: 100%;
  padding: 4px 0;
  cursor: pointer;
}
.recorded-tool-response summary:hover { color: var(--text-primary); }
.recorded-tool-response summary:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 3px;
  border-radius: var(--radius-sm);
}
.recorded-tool-response pre {
  margin: 8px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  background: var(--canvas-inset);
  font: 12px/1.6 var(--font-mono, monospace);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
