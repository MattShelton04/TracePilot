<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  refreshing: boolean;
  autoRefreshEnabled: boolean;
  intervalSeconds: number;
}>();

const emit = defineEmits<{
  refresh: [];
  "update:autoRefreshEnabled": [value: boolean];
  "update:intervalSeconds": [value: number];
}>();

const INTERVAL_STOPS = [3, 5, 10, 30];

const sliderValue = computed({
  get: () => {
    const idx = INTERVAL_STOPS.indexOf(props.intervalSeconds);
    return idx >= 0 ? idx : 1; // default to index 1 (5s)
  },
  set: (idx: number) => {
    emit("update:intervalSeconds", INTERVAL_STOPS[idx] ?? 5);
  },
});

const intervalLabel = computed(() => {
  const s = props.intervalSeconds;
  return s >= 60 ? `${s / 60}m` : `${s}s`;
});
</script>

<template>
  <div class="refresh-toolbar">
    <button
      class="refresh-btn"
      :class="{ 'refresh-btn--spinning': refreshing }"
      :disabled="refreshing"
      title="Refresh data"
      @click="emit('refresh')"
    >
      <svg class="refresh-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 8A6 6 0 1 1 8 2" stroke-linecap="round" />
        <path d="M14 2v4h-4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span v-if="refreshing" class="refresh-label">Refreshing…</span>
    </button>

    <div class="refresh-divider" />

    <label class="auto-toggle">
      <input
        type="checkbox"
        :checked="autoRefreshEnabled"
        @change="emit('update:autoRefreshEnabled', ($event.target as HTMLInputElement).checked)"
      />
      <span class="auto-toggle-label">Auto</span>
    </label>

    <div v-if="autoRefreshEnabled" class="interval-control">
      <input
        type="range"
        :min="0"
        :max="INTERVAL_STOPS.length - 1"
        :value="sliderValue"
        class="interval-slider"
        @input="sliderValue = Number(($event.target as HTMLInputElement).value)"
      />
      <span class="interval-label">{{ intervalLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.refresh-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast), background var(--transition-fast);
}

.refresh-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--canvas-overlay);
}

.refresh-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.refresh-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.3s ease;
}

.refresh-btn--spinning .refresh-icon {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.refresh-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.refresh-divider {
  width: 1px;
  height: 16px;
  background: var(--border-default);
}

.auto-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}

.auto-toggle input[type="checkbox"] {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent-fg);
  cursor: pointer;
}

.auto-toggle-label {
  font-size: 0.6875rem;
  color: var(--text-secondary);
}

.interval-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.interval-slider {
  width: 60px;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--border-default);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.interval-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent-fg);
  cursor: pointer;
}

.interval-label {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--accent-fg);
  min-width: 24px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
