<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";

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

// Minimum spinner display time to avoid flash on fast refreshes
const MIN_SPIN_MS = 500;
const showSpinner = ref(false);
let spinStart = 0;
let spinTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.refreshing,
  (isRefreshing) => {
    if (isRefreshing) {
      showSpinner.value = true;
      spinStart = Date.now();
      if (spinTimer) clearTimeout(spinTimer);
      spinTimer = null;
    } else if (showSpinner.value) {
      const elapsed = Date.now() - spinStart;
      const remaining = MIN_SPIN_MS - elapsed;
      if (remaining > 0) {
        spinTimer = setTimeout(() => {
          showSpinner.value = false;
        }, remaining);
      } else {
        showSpinner.value = false;
      }
    }
  },
);

const intervalLabel = computed(() => {
  const s = props.intervalSeconds;
  return s >= 60 ? `${s / 60}m` : `${s}s`;
});

function cycleInterval() {
  const idx = INTERVAL_STOPS.indexOf(props.intervalSeconds);
  const nextIdx = (idx + 1) % INTERVAL_STOPS.length;
  emit("update:intervalSeconds", INTERVAL_STOPS[nextIdx]);
}

onUnmounted(() => {
  if (spinTimer) clearTimeout(spinTimer);
});
</script>

<template>
  <div class="refresh-toolbar">
    <button
      class="refresh-btn"
      :class="{ 'refresh-btn--spinning': showSpinner }"
      :disabled="refreshing"
      title="Refresh data"
      aria-label="Refresh data"
      @click="emit('refresh')"
    >
      <svg class="refresh-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 8a6 6 0 1 1-6-6c1.7 0 3.3.7 4.5 1.8L14 5.5" />
        <path d="M14 1.5v4h-4" />
      </svg>
    </button>

    <label class="auto-toggle">
      <input
        type="checkbox"
        :checked="autoRefreshEnabled"
        aria-label="Enable auto-refresh"
        @change="emit('update:autoRefreshEnabled', ($event.target as HTMLInputElement).checked)"
      />
      <span class="auto-toggle-label">Auto</span>
    </label>

    <button
      v-if="autoRefreshEnabled"
      class="interval-cycle-btn"
      :title="`Auto-refresh every ${intervalLabel} (click to change)`"
      aria-label="Change auto-refresh interval"
      @click="cycleInterval"
    >
      {{ intervalLabel }}
    </button>
  </div>
</template>

<style scoped>
.refresh-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
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

.auto-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  cursor: pointer;
  user-select: none;
}

/* Drawn from tokens like the Search filter boxes; the native box ignores the dark theme. */
.auto-toggle input[type="checkbox"] {
  appearance: none;
  display: inline-grid;
  place-content: center;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin: 0;
  border: 1px solid var(--text-tertiary);
  border-radius: 3px;
  background: var(--canvas-overlay);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.auto-toggle input[type="checkbox"]::before {
  content: "";
  width: 7px;
  height: 4px;
  border-left: 1.5px solid var(--text-on-emphasis);
  border-bottom: 1.5px solid var(--text-on-emphasis);
  transform: translateY(-1px) rotate(-45deg);
  opacity: 0;
}

.auto-toggle:hover input[type="checkbox"]:not(:checked) {
  border-color: var(--text-secondary);
}

.auto-toggle input[type="checkbox"]:checked {
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
}

.auto-toggle input[type="checkbox"]:checked::before {
  opacity: 1;
}

.auto-toggle-label {
  font-size: 0.6875rem;
  line-height: 14px;
  color: var(--text-secondary);
}

.interval-cycle-btn {
  border: none;
  background: var(--canvas-overlay, rgba(255,255,255,0.06));
  color: var(--accent-fg);
  font-size: 0.625rem;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-variant-numeric: tabular-nums;
  min-width: 24px;
  text-align: center;
  transition: background var(--transition-fast);
}
.interval-cycle-btn:hover {
  background: var(--neutral-subtle);
}
</style>
