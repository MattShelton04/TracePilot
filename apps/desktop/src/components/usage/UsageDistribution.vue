<script setup lang="ts">
/**
 * Percentiles for one metric. The denominator is always shown, because
 * older CLI versions report metrics on only a fraction of runs and a median
 * over 27% of runs must not read like a median over all of them.
 */
import type { MetricDistribution } from "@tracepilot/types";
import { formatDuration, formatNumber, Tooltip } from "@tracepilot/ui";
import { computed } from "vue";

const props = defineProps<{
  title: string;
  distribution: MetricDistribution;
  /** Total runs in range, for the "n of m runs reported" denominator. */
  runs: number;
  format: "duration" | "number";
  /** Extra caption, e.g. the "includes descendants" token warning. */
  note?: string | null;
}>();

const cells = computed(() => {
  const d = props.distribution;
  return [
    { key: "p25", label: "p25", value: d.p25 },
    { key: "p50", label: "Median", value: d.p50 },
    { key: "p90", label: "p90", value: d.p90 },
    { key: "max", label: "Max", value: d.max },
  ];
});

const coverage = computed(() => {
  const { count } = props.distribution;
  if (count === 0) return "no runs reported this metric";
  if (count === props.runs) return `all ${formatNumber(props.runs)} runs reported it`;
  return `${formatNumber(count)} of ${formatNumber(props.runs)} runs reported it`;
});

function display(value: number | null): string {
  if (value == null) return "—";
  return props.format === "duration" ? formatDuration(value) : formatNumber(value);
}
</script>

<template>
  <div class="distribution">
    <div class="distribution__head">
      <h4 class="distribution__title">{{ title }}</h4>
      <Tooltip v-if="note" :text="note" position="bottom">
        <span class="distribution__note" tabindex="0">includes descendants</span>
      </Tooltip>
    </div>
    <dl class="distribution__grid">
      <div v-for="cell in cells" :key="cell.key" class="distribution__cell">
        <dt>{{ cell.label }}</dt>
        <dd>{{ display(cell.value) }}</dd>
      </div>
    </dl>
    <p class="distribution__coverage">{{ coverage }}</p>
  </div>
</template>

<style scoped>
.distribution__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.distribution__title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.distribution__note {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  border-bottom: 1px dotted var(--border-default);
  cursor: help;
}

.distribution__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.distribution__cell dt {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.distribution__cell dd {
  margin: 2px 0 0;
  font-size: 0.8125rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.distribution__coverage {
  margin: 8px 0 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
</style>
