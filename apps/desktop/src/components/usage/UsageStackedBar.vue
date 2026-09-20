<script setup lang="ts">
/**
 * Shares of one total as a single bar plus a legend — outcomes, statuses,
 * anything where the parts add up. A list of separate bars repeats the same
 * denominator on every row; this shows the split in one glance.
 */
import { formatNumberFull } from "@tracepilot/types";
import { computed } from "vue";

export interface StackedSegment {
  key: string;
  label: string;
  value: number;
  tone?: "accent" | "success" | "warning" | "danger" | "neutral";
}

const props = withDefaults(
  defineProps<{
    segments: StackedSegment[];
    /** Denominator; defaults to the sum of the segments. */
    total?: number | null;
    emptyText?: string;
  }>(),
  { total: null, emptyText: "Nothing recorded" },
);

const total = computed(
  () => props.total ?? props.segments.reduce((sum, segment) => sum + segment.value, 0),
);

const visible = computed(() => props.segments.filter((segment) => segment.value > 0));

function share(value: number): number {
  return total.value > 0 ? (value / total.value) * 100 : 0;
}

/** Exact shares; the legend keeps even very small categories readable. */
function width(value: number): string {
  const pct = share(value);
  return `${Math.min(100, Math.max(0, pct))}%`;
}

function label(value: number): string {
  const pct = share(value);
  return pct >= 10 || pct === 0 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}
</script>

<template>
  <div v-if="visible.length" class="stacked">
    <div class="stacked__track" aria-hidden="true">
      <span
        v-for="segment in visible"
        :key="segment.key"
        class="stacked__segment"
        :class="`stacked__segment--${segment.tone ?? 'accent'}`"
        :style="{ width: width(segment.value) }"
        :title="`${segment.label}: ${formatNumberFull(segment.value)} (${label(segment.value)})`"
      />
    </div>
    <ul class="stacked__legend">
      <li v-for="segment in visible" :key="segment.key" class="stacked__item">
        <span class="stacked__dot" :class="`stacked__dot--${segment.tone ?? 'accent'}`" />
        <span class="stacked__label">{{ segment.label }}</span>
        <span class="stacked__value">{{ formatNumberFull(segment.value) }}</span>
        <span class="stacked__share">{{ label(segment.value) }}</span>
      </li>
    </ul>
  </div>
  <p v-else class="stacked__empty">{{ emptyText }}</p>
</template>

<style scoped>
.stacked {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stacked__track {
  display: flex;
  height: 8px;
  border-radius: var(--radius-sm);
  background: var(--canvas-inset, var(--canvas-subtle));
  overflow: hidden;
}

.stacked__segment {
  flex-shrink: 0;
}

.stacked__segment,
.stacked__dot {
  height: 100%;
  background: var(--accent-emphasis);
}

.stacked__segment--success,
.stacked__dot--success {
  background: var(--success-emphasis);
}

.stacked__segment--warning,
.stacked__dot--warning {
  background: var(--warning-emphasis);
}

.stacked__segment--danger,
.stacked__dot--danger {
  background: var(--danger-emphasis);
}

.stacked__segment--neutral,
.stacked__dot--neutral {
  background: var(--neutral-emphasis);
}

.stacked__legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.stacked__item {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 0.6875rem;
  min-width: 0;
}

.stacked__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full, 999px);
  flex-shrink: 0;
}

.stacked__label {
  color: var(--text-secondary);
}

.stacked__value {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.stacked__share {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.stacked__empty {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
</style>
