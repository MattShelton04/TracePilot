<script setup lang="ts">
export interface ModelLegendItem {
  id: string;
  label: string;
  color: string;
  /** Ring swatch: priced in USD rather than AI Credits. */
  hollow?: boolean;
}

defineProps<{ items: ModelLegendItem[]; interactive?: boolean }>();
const emit = defineEmits<{ highlight: [id: string | null] }>();
</script>

<template>
  <ul class="model-chart-legend">
    <li
      v-for="item in items"
      :key="item.id"
      :tabindex="interactive ? 0 : undefined"
      @pointerenter="interactive && emit('highlight', item.id)"
      @pointerleave="interactive && emit('highlight', null)"
      @focus="interactive && emit('highlight', item.id)"
      @blur="interactive && emit('highlight', null)"
    >
      <span class="model-chart-legend-swatch" :class="{ hollow: item.hollow }" :style="{ '--swatch': item.color }" />
      {{ item.label }}
    </li>
  </ul>
</template>

<style scoped>
.model-chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.model-chart-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 4px;
}

.model-chart-legend li:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.model-chart-legend-swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--swatch);
}

.model-chart-legend-swatch.hollow {
  background: transparent;
  box-shadow: inset 0 0 0 2px var(--swatch);
}
</style>
