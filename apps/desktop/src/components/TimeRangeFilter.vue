<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { type AnalyticsTimeRange, useAnalyticsStore } from "@/stores/analytics";

const store = useAnalyticsStore();

const presets: { value: AnalyticsTimeRange; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "month-to-date", label: "This Month" },
  { value: "custom", label: "Custom" },
];

const fromInput = ref<HTMLInputElement | null>(null);
const toInput = ref<HTMLInputElement | null>(null);
const draftFrom = ref(store.customFromDate ?? "");
const draftTo = ref(store.customToDate ?? "");
const incomplete = ref({ from: false, to: false });
const errorId = useId();
const isCustom = computed(() => store.selectedTimeRange === "custom");

function isValidDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= "2000-01-01" &&
    value <= "2099-12-31" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

const validation = computed(() => {
  const from = incomplete.value.from || (!!draftFrom.value && !isValidDate(draftFrom.value));
  const to = incomplete.value.to || (!!draftTo.value && !isValidDate(draftTo.value));
  if (from || to) {
    return {
      from,
      to,
      message: `Enter a complete date between 2000 and 2099 for ${from && to ? "both dates" : from ? "From date" : "To date"}, or clear the field.`,
    };
  }
  if (draftFrom.value && draftTo.value && draftFrom.value > draftTo.value) {
    return {
      from: true,
      to: true,
      message: "From date must be on or before To date. Change either date or clear one bound.",
    };
  }
  return null;
});

// Native date inputs stay uncontrolled while editing, including incomplete
// segments. Only a store change or preset selection replaces their DOM values.
function syncInputs() {
  if (fromInput.value) fromInput.value.value = draftFrom.value;
  if (toInput.value) toInput.value.value = draftTo.value;
}

function syncDrafts() {
  draftFrom.value = store.customFromDate ?? "";
  draftTo.value = store.customToDate ?? "";
  incomplete.value = { from: false, to: false };
  syncInputs();
}

watch([fromInput, toInput], syncInputs, { flush: "post" });
watch(
  [() => store.selectedTimeRange, () => store.customFromDate, () => store.customToDate],
  syncDrafts,
);

function selectPreset(preset: AnalyticsTimeRange) {
  syncDrafts();
  if (preset === "custom") {
    store.setTimeRange("custom", store.customFromDate, store.customToDate);
  } else {
    store.setTimeRange(preset);
  }
}

function onDateBlur(bound: "from" | "to", event: Event) {
  const input = event.target as HTMLInputElement;
  incomplete.value[bound] = input.validity.badInput;
  if (!input.validity.badInput) {
    if (bound === "from") draftFrom.value = input.value;
    else draftTo.value = input.value;
  }
  if (!isCustom.value || validation.value) return;
  const from = draftFrom.value || undefined;
  const to = draftTo.value || undefined;
  if (from !== store.customFromDate || to !== store.customToDate) {
    store.setTimeRange("custom", from, to);
  }
}
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
        ref="fromInput"
        type="date"
        class="filter-select time-range-date"
        aria-label="From date"
        :aria-invalid="validation?.from || undefined"
        :aria-describedby="validation?.from ? errorId : undefined"
        min="2000-01-01"
        max="2099-12-31"
        @blur="onDateBlur('from', $event)"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      />
      <span class="time-range-separator">–</span>
      <input
        ref="toInput"
        type="date"
        class="filter-select time-range-date"
        aria-label="To date"
        :aria-invalid="validation?.to || undefined"
        :aria-describedby="validation?.to ? errorId : undefined"
        min="2000-01-01"
        max="2099-12-31"
        @blur="onDateBlur('to', $event)"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      />
    </div>
    <p v-if="isCustom && validation" :id="errorId" class="time-range-error" role="alert">
      {{ validation.message }} Charts still show the last valid range.
    </p>
  </div>
</template>

<style scoped>
.time-range-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}

.time-range-presets {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  max-width: 100%;
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
  color: var(--text-on-emphasis);
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

.time-range-date[aria-invalid="true"] {
  border-color: var(--danger-fg);
}

.time-range-error {
  flex-basis: 100%;
  min-width: 0;
  margin: 0;
  color: var(--danger-fg);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.time-range-separator {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}
</style>
