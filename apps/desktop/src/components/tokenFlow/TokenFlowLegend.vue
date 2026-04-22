<script setup lang="ts">
defineProps<{
  items: Array<{ label: string; color: string }>;
}>();
</script>

<template>
  <div class="legend-row">
    <div v-for="item in items" :key="item.label" class="legend-item">
      <span class="legend-swatch" :style="{ background: item.color }" />
      <span class="legend-label">{{ item.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.legend-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px 0;
  margin-bottom: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.legend-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
</style>
