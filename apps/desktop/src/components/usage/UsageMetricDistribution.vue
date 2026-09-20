<script setup lang="ts">
import type { MetricDistribution } from "@tracepilot/types";
import { formatNumberFull } from "@tracepilot/types";
import { computed } from "vue";

const props = defineProps<{
  title: string;
  description: string;
  data: MetricDistribution;
  runs: number;
  format: (value: number) => string;
}>();

function display(value: number | null): string {
  return value == null ? "—" : props.format(value);
}

const figures = computed(() => [
  { label: "Typical (median)", value: display(props.data.p50) },
  {
    label: "Middle 50% of runs",
    value:
      props.data.p25 == null || props.data.p75 == null
        ? "—"
        : `${display(props.data.p25)} – ${display(props.data.p75)}`,
  },
  { label: "90% of runs at or below", value: display(props.data.p90) },
  { label: "Highest recorded", value: display(props.data.max) },
]);
</script>

<template>
  <section class="metric-distribution">
    <h4 class="usage-detail__title">{{ title }}</h4>
    <p class="usage-detail__help">{{ description }}</p>
    <dl v-if="data.count" class="metric-distribution__figures">
      <div v-for="figure in figures" :key="figure.label">
        <dt>{{ figure.label }}</dt>
        <dd>{{ figure.value }}</dd>
      </div>
    </dl>
    <p class="usage-detail__help">
      <template v-if="data.count">
        Based on {{ formatNumberFull(data.count) }} of {{ formatNumberFull(runs) }} runs.
        Missing values are excluded.
      </template>
      <template v-else>No runs reported this metric.</template>
    </p>
  </section>
</template>

<style scoped>
.metric-distribution {
  padding: 12px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.metric-distribution__figures {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  margin: 4px 0;
}

.metric-distribution__figures dt {
  color: var(--text-secondary);
  font-size: 0.6875rem;
}

.metric-distribution__figures dd {
  margin: 4px 0 0;
  font-size: 0.875rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
</style>
