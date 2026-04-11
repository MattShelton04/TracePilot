<script setup lang="ts">
export interface SegmentOption {
  value: string;
  label: string;
  count?: number;
}

defineProps<{
  modelValue: string;
  options: SegmentOption[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();
</script>

<template>
  <div class="segmented-control" role="radiogroup">
    <button
      v-for="opt in options"
      :key="opt.value"
      class="segment-btn"
      :class="{ active: modelValue === opt.value }"
      role="radio"
      :aria-checked="modelValue === opt.value"
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
      <span v-if="opt.count !== undefined" class="segment-count">{{ opt.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.segmented-control {
  display: inline-flex;
  background: var(--surface-secondary);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}
.segment-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all var(--transition-fast, 100ms);
  white-space: nowrap;
}
.segment-btn:hover:not(.active) {
  color: var(--text-primary);
  background: var(--surface-tertiary, rgba(255,255,255,0.05));
}
.segment-btn.active {
  background: var(--accent-emphasis);
  color: var(--text-on-emphasis, #fff);
}
.segment-count {
  font-size: 0.6875rem;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.15);
}
.segment-btn:not(.active) .segment-count {
  background: var(--neutral-muted);
}
</style>
