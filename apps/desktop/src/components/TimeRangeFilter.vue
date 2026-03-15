<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAnalyticsStore } from '@/stores/analytics';

type RangePreset = 'all' | '7d' | '30d' | '90d' | 'custom';

const store = useAnalyticsStore();

const presets: { value: RangePreset; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: 'custom', label: 'Custom' },
];

const localFrom = ref(store.customFromDate ?? '');
const localTo = ref(store.customToDate ?? '');

const isCustom = computed(() => store.selectedTimeRange === 'custom');

function selectPreset(preset: RangePreset) {
  if (preset === 'custom') {
    store.setTimeRange('custom', localFrom.value || undefined, localTo.value || undefined);
  } else {
    store.setTimeRange(preset);
  }
}

watch([localFrom, localTo], () => {
  if (isCustom.value) {
    store.setTimeRange('custom', localFrom.value || undefined, localTo.value || undefined);
  }
});
</script>

<template>
  <div class="time-range-filter">
    <div class="time-range-presets" role="group" aria-label="Time range">
      <button
        v-for="preset in presets"
        :key="preset.value"
        class="time-range-btn"
        :class="{ active: store.selectedTimeRange === preset.value }"
        :aria-pressed="store.selectedTimeRange === preset.value"
        @click="selectPreset(preset.value)"
      >
        {{ preset.label }}
      </button>
    </div>
    <div v-if="isCustom" class="time-range-custom">
      <input
        v-model="localFrom"
        type="date"
        class="filter-select time-range-date"
        aria-label="From date"
      />
      <span class="time-range-separator">–</span>
      <input
        v-model="localTo"
        type="date"
        class="filter-select time-range-date"
        aria-label="To date"
      />
    </div>
  </div>
</template>

<style scoped>
.time-range-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.time-range-presets {
  display: flex;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  overflow: hidden;
}

.time-range-btn {
  padding: 4px 10px;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.4;
  border: none;
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  white-space: nowrap;
}

.time-range-btn:not(:last-child) {
  border-right: 1px solid var(--border-default);
}

.time-range-btn:hover:not(.active) {
  background: var(--neutral-muted);
}

.time-range-btn.active {
  background: var(--accent-emphasis);
  color: var(--text-on-emphasis, #fff);
}

.time-range-custom {
  display: flex;
  align-items: center;
  gap: 4px;
}

.time-range-date {
  width: 130px;
  font-size: 0.75rem;
  padding: 4px 6px;
}

.time-range-separator {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}
</style>
