<script setup lang="ts">
/**
 * Reusable SVG chart frame that renders the common scaffolding shared by
 * all standard analytics charts: grid lines, axes, axis labels, a
 * transparent mouse-capture overlay, and an optional tooltip.
 *
 * Chart-specific content (bars, lines, areas, dots) is injected via the
 * default slot.  SVG `<defs>` (gradients, patterns) go in the `defs` slot,
 * and below-chart extras (legends, toggles) go in the `footer` slot.
 *
 * @example
 * ```vue
 * <ChartFrame
 *   :chart-layout="layout" :grid-lines="gridLines"
 *   :y-labels="yLabels"   :x-labels="xLabels"
 *   aria-label="Token usage" chart-id="tokens" :tooltip="tooltip"
 *   @mousemove="onMove" @click="onClick" @dismiss-tooltip="dismiss"
 * >
 *   <template #defs>
 *     <linearGradient id="grad" …/>
 *   </template>
 *   <polyline :points="pts" />
 * </ChartFrame>
 * ```
 */

import type { ChartTooltipState } from '../composables/useChartTooltip';
import type { ChartLayout, XAxisLabel, YAxisLabel } from '../utils/chartGeometry';

withDefaults(
  defineProps<{
    /** Layout dimensions (left, right, top, bottom, width, height). */
    chartLayout: ChartLayout;
    /** Horizontal grid-line Y positions. */
    gridLines: number[];
    /** Y-axis tick labels with display value and Y coordinate. */
    yLabels: YAxisLabel[];
    /** X-axis tick labels with display text and X coordinate. */
    xLabels: XAxisLabel[];
    /** Accessible description for the chart SVG element. */
    ariaLabel: string;
    /** Unique id used to gate tooltip visibility when multiple charts share one tooltip. */
    chartId: string;
    /** Reactive tooltip state from `useChartTooltip`. */
    tooltip: ChartTooltipState;
    /** SVG viewBox attribute. */
    viewBox?: string;
  }>(),
  { viewBox: '0 0 500 200' },
);

const emit = defineEmits<{
  mousemove: [event: MouseEvent];
  click: [event: MouseEvent];
  'dismiss-tooltip': [];
}>();
</script>

<template>
  <div class="chart-frame" @mouseleave="emit('dismiss-tooltip')">
    <svg
      :viewBox="viewBox"
      width="100%"
      role="img"
      :aria-label="ariaLabel"
      @mousemove="emit('mousemove', $event)"
      @click="emit('click', $event)"
    >
      <defs>
        <slot name="defs" />
      </defs>

      <!-- Horizontal grid lines -->
      <line
        v-for="(gy, gi) in gridLines"
        :key="`g-${gi}`"
        :x1="chartLayout.left"
        :y1="gy"
        :x2="chartLayout.right"
        :y2="gy"
        class="chart-grid-line"
        stroke-dasharray="4,3"
      />

      <!-- Y and X axes -->
      <line
        :x1="chartLayout.left"
        :y1="chartLayout.top"
        :x2="chartLayout.left"
        :y2="chartLayout.bottom"
        class="chart-axis"
      />
      <line
        :x1="chartLayout.left"
        :y1="chartLayout.bottom"
        :x2="chartLayout.right"
        :y2="chartLayout.bottom"
        class="chart-axis"
      />

      <!-- Y-axis labels -->
      <text
        v-for="(yl, yi) in yLabels"
        :key="`y-${yi}`"
        :x="chartLayout.left - 7"
        :y="yl.y + 3"
        text-anchor="end"
        font-size="9"
        class="chart-label"
      >{{ yl.value }}</text>

      <!-- Chart-specific content -->
      <slot />

      <!-- Invisible overlay to capture mouse events across the entire chart area -->
      <rect
        :x="chartLayout.left"
        :y="chartLayout.top"
        :width="chartLayout.width"
        :height="chartLayout.height"
        fill="transparent"
        class="chart-overlay"
      />

      <!-- X-axis labels -->
      <text
        v-for="(xl, xi) in xLabels"
        :key="`x-${xi}`"
        :x="xl.x"
        :y="chartLayout.bottom + 17"
        text-anchor="middle"
        font-size="8"
        class="chart-label"
      >{{ xl.label }}</text>
    </svg>

    <!-- Tooltip (only shown when this chart is the active tooltip target) -->
    <div
      v-if="tooltip.visible && tooltip.chartId === chartId"
      class="chart-tooltip"
      :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
      :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
    >{{ tooltip.content }}</div>

    <slot name="footer" />
  </div>
</template>

<style scoped>
.chart-frame {
  position: relative;
}
</style>
