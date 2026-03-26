<script setup lang="ts">
defineProps<{
  title?: string;
  padding?: 'sm' | 'md';
}>();
</script>

<template>
  <div class="section-panel">
    <div v-if="title" class="section-panel-header">
      <span class="section-panel-title">{{ title }}</span>
      <div class="section-panel-actions">
        <slot name="actions" />
      </div>
    </div>
    <div class="section-panel-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.section-panel {
  margin-bottom: 1.5rem;
}

.section-panel-header {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-tertiary);
  letter-spacing: 0.05em;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-panel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  text-transform: none;
  letter-spacing: normal;
}

.section-panel-body {
  /* Any body specific styles */
}
</style>
