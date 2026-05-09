<!--
  @slots
    default — one or more <KPI> children
  Hairline-framed horizontal row of KPI tiles. Single border around the
  group + vertical hairline dividers between tiles, replacing the
  per-card frames flagged in CC-4 frame-soup.
  See 02-primitives.md §KPI.
-->
<script setup lang="ts">
export interface KPIRowProps {
  /** When true, wraps onto multiple lines instead of single horizontal row. */
  wrap?: boolean;
  density?: "comfortable" | "compact";
}

withDefaults(defineProps<KPIRowProps>(), {
  wrap: true,
  density: "comfortable",
});
</script>

<template>
  <div
    data-tp-component="KPIRow"
    class="kpi-row"
    :class="[`kpi-row--${density}`, { 'kpi-row--wrap': wrap }]"
    role="group"
  >
    <slot />
  </div>
</template>

<style scoped>
.kpi-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
  overflow: hidden;
}

.kpi-row--wrap {
  flex-wrap: wrap;
}

.kpi-row :slotted(.kpi) {
  flex: 1 1 0;
  min-width: 160px;
  border-right: 1px solid var(--border-subtle);
}

.kpi-row :slotted(.kpi:last-child) {
  border-right: 0;
}

.kpi-row--wrap :slotted(.kpi) {
  border-bottom: 1px solid var(--border-subtle);
}

.kpi-row--wrap :slotted(.kpi:last-child) {
  border-bottom: 0;
}
</style>
