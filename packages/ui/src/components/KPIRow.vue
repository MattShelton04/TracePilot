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
/*
 * Hairline framing via grid `gap` painted over `background-color`. The 1px
 * gap acts as the divider between tiles; tiles paint their own
 * `--canvas-default` background to cover everywhere except the seams. This
 * gives a clean, even hairline regardless of wrap row count (no orphaned
 * border-right on visual row endings, no doubled borders).
 */
.kpi-row {
  display: grid;
  gap: 1px;
  background: var(--border-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.kpi-row--wrap {
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.kpi-row:not(.kpi-row--wrap) {
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
}

.kpi-row :slotted(.kpi) {
  background: var(--canvas-default);
  min-width: 0;
}
</style>
