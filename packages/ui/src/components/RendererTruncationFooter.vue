<!--
  Shared truncation footer for renderer bodies. Renders a single line of
  hairline-bordered chrome containing "Output was truncated." and an
  inline accent-bordered "Load full output" button. See docs/design/adding-tool-renderers.md.
-->
<script setup lang="ts">
defineProps<{ loading?: boolean; failed?: boolean }>();
const emit = defineEmits<{
  "load-full": [];
  retry: [];
}>();
</script>

<template>
  <div class="rs-trunc-row">
    <span class="rs-trunc-text" role="status">{{ failed ? 'Full output could not be loaded.' : 'Showing a preview of the output.' }}</span>
    <button class="rs-trunc-btn" type="button" :disabled="loading" @click="failed ? emit('retry') : emit('load-full')">
      {{ loading ? 'Loading full output…' : failed ? 'Retry full output' : 'Load full output' }}
    </button>
  </div>
</template>

<style scoped>
.rs-trunc-row {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-subtle);
  background: var(--canvas-inset);
  font-size: 12px;
  color: var(--text-secondary);
}

.rs-trunc-text {
  min-width: 0;
}

.rs-trunc-btn {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent-fg);
  background: transparent;
  border: 1px solid var(--accent-emphasis);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.rs-trunc-btn:hover {
  background: var(--accent-subtle);
}
.rs-trunc-btn:disabled { cursor: wait; opacity: 0.65; }

.rs-trunc-btn:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
</style>
