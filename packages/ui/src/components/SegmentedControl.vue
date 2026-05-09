<script setup lang="ts">
export interface SegmentOption {
  value: string;
  label: string;
  count?: number;
}

defineProps<{
  modelValue: string;
  options: SegmentOption[];
  /**
   * Corner rounding. `pill` renders fully-rounded ("pill") options — used for
   * category filters. Default `square` preserves the current 6px radius.
   */
  rounded?: "square" | "pill";
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();
</script>

<template>
  <div
    class="segmented-control"
    :class="{ 'segmented-control--pill': rounded === 'pill' }"
    role="radiogroup"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      class="segment-btn"
      :class="{ active: modelValue === opt.value, 'segment-btn--pill': rounded === 'pill' }"
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
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
  white-space: nowrap;
}
.segment-btn:hover:not(.active) {
  color: var(--text-primary);
  background: var(--surface-tertiary);
}
.segment-btn.active {
  background: var(--accent-emphasis);
  color: var(--text-on-emphasis);
}
.segment-btn:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
.segment-count {
  font-size: 0.6875rem;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--accent-muted);
}
.segment-btn:not(.active) .segment-count {
  background: var(--neutral-muted);
}
.segmented-control--pill {
  border-radius: 999px;
  padding: 3px;
}
.segment-btn--pill {
  border-radius: 999px;
  padding: 4px 14px;
}
</style>
