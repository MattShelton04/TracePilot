<script setup lang="ts">
defineProps<{
  currentIndex: number;
  totalCount: number;
  hasPrev: boolean;
  hasNext: boolean;
}>();

const emit = defineEmits<{
  prev: [];
  next: [];
}>();
</script>

<template>
  <div class="cv-panel-nav">
    <button
      class="cv-panel-nav-btn"
      :disabled="!hasPrev"
      aria-label="Previous subagent"
      @click="emit('prev')"
    >
      ◀ Prev
    </button>
    <span class="cv-panel-nav-pos">{{ currentIndex + 1 }} / {{ totalCount }}</span>
    <button
      class="cv-panel-nav-btn"
      :disabled="!hasNext"
      aria-label="Next subagent"
      @click="emit('next')"
    >
      Next ▶
    </button>
  </div>
</template>

<style scoped>
.cv-panel-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid var(--border-default);
  background: var(--canvas-inset);
  flex-shrink: 0;
}

.cv-panel-nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast),
    border-color var(--transition-fast);
}

.cv-panel-nav-btn:hover:not(:disabled) {
  background: var(--neutral-subtle);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.cv-panel-nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.cv-panel-nav-pos {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
