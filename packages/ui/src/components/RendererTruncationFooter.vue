<!--
  Shared truncation footer for renderer bodies. Renders a single line of
  hairline-bordered chrome containing "Output was truncated." and an
  inline accent-bordered "Show Full Output" button. See 13-tool-renderers.md.
-->
<script setup lang="ts">
const emit = defineEmits<{
  "load-full": [];
}>();
</script>

<template>
  <div class="rs-trunc-row">
    <span class="rs-trunc-text">Output was truncated.</span>
    <button class="rs-trunc-btn" type="button" @click="emit('load-full')">
      Show Full Output
    </button>
  </div>
</template>

<style scoped>
.rs-trunc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-top: 1px solid var(--border-subtle);
  background: var(--canvas-inset);
  font-size: 12px;
  color: var(--text-secondary);
}

.rs-trunc-text {
  flex: 1;
  min-width: 0;
}

.rs-trunc-btn {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent-fg);
  background: transparent;
  border: 1px solid var(--accent-emphasis);
  border-radius: 999px;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.rs-trunc-btn:hover {
  background: var(--accent-subtle);
}

.rs-trunc-btn:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
</style>
