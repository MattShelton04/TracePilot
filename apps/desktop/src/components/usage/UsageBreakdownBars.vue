<script setup lang="ts">
/**
 * Ranked labelled bars for a categorical breakdown (models, parents,
 * failure reasons…). Bars are scaled against the largest row, while the
 * percentage is of the total so small rows stay readable.
 */
import { formatNumberFull } from "@tracepilot/types";
import { computed } from "vue";

export interface BreakdownRow {
  key: string;
  label: string;
  value: number;
  /** Rendered under the label, e.g. an example error message. */
  detail?: string | null;
  tone?: "accent" | "success" | "warning" | "danger" | "neutral";
}

const props = withDefaults(
  defineProps<{
    rows: BreakdownRow[];
    /** Denominator for percentages; defaults to the sum of the rows. */
    total?: number | null;
    limit?: number;
    emptyText?: string;
  }>(),
  { total: null, limit: 8, emptyText: "Not recorded" },
);

const visible = computed(() => props.rows.slice(0, props.limit));
const total = computed(
  () => props.total ?? props.rows.reduce((sum, row) => sum + row.value, 0) ?? 0,
);
const max = computed(() => Math.max(1, ...props.rows.map((row) => row.value)));

function share(value: number): string {
  if (!total.value) return "";
  const pct = (value / total.value) * 100;
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`;
}
</script>

<template>
  <ul v-if="visible.length" class="breakdown">
    <li v-for="row in visible" :key="row.key" class="breakdown__row">
      <div class="breakdown__head">
        <span class="breakdown__label" :title="row.label">{{ row.label }}</span>
        <span class="breakdown__value">
          {{ formatNumberFull(row.value) }}
          <span v-if="total" class="breakdown__share">{{ share(row.value) }}</span>
        </span>
      </div>
      <div class="breakdown__track">
        <div
          class="breakdown__fill"
          :class="`breakdown__fill--${row.tone ?? 'accent'}`"
          :style="{ width: `${Math.max(2, (row.value / max) * 100)}%` }"
        />
      </div>
      <p v-if="row.detail" class="breakdown__detail" :title="row.detail">{{ row.detail }}</p>
    </li>
    <li v-if="rows.length > visible.length" class="breakdown__more">
      +{{ rows.length - visible.length }} more
    </li>
  </ul>
  <p v-else class="breakdown__empty">{{ emptyText }}</p>
</template>

<style scoped>
.breakdown {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.breakdown__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.breakdown__label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.breakdown__value {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  white-space: nowrap;
}

.breakdown__share {
  color: var(--text-tertiary);
  margin-left: 4px;
}

.breakdown__track {
  height: 4px;
  border-radius: var(--radius-sm);
  background: var(--canvas-inset, var(--canvas-subtle));
  overflow: hidden;
}

.breakdown__fill {
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--accent-emphasis);
}

.breakdown__fill--success {
  background: var(--success-emphasis);
}

.breakdown__fill--warning {
  background: var(--warning-emphasis);
}

.breakdown__fill--danger {
  background: var(--danger-emphasis);
}

.breakdown__fill--neutral {
  background: var(--neutral-emphasis);
}

.breakdown__detail {
  margin: 4px 0 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.breakdown__more,
.breakdown__empty {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin: 0;
}
</style>
