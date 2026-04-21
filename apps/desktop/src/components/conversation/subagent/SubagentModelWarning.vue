<script setup lang="ts">
defineProps<{
  requestedModel: string;
  model: string;
}>();
</script>

<template>
  <div class="cv-panel-model-warn">
    <span class="cv-panel-model-warn-icon">⚠</span>
    <span>Requested <code>{{ requestedModel }}</code> but ran as <code>{{ model }}</code></span>
  </div>
</template>

<style scoped>
.cv-panel-model-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  margin-bottom: 12px;
  border-radius: var(--radius-md);
  background: var(--warning-subtle);
  border: 1px solid color-mix(in srgb, var(--warning-fg) 30%, transparent);
  font-size: 0.6875rem;
  color: var(--warning-fg);
  line-height: 1.4;
}

.cv-panel-model-warn code {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.625rem;
  background: color-mix(in srgb, var(--warning-fg) 12%, transparent);
  padding: 0 4px;
  border-radius: var(--radius-sm);
}

.cv-panel-model-warn-icon {
  flex-shrink: 0;
}
</style>
