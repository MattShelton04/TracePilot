<script setup lang="ts">
import type { ChartLayout, ChartTooltipState } from "@tracepilot/ui";
import { ChartFrame } from "@tracepilot/ui";
import type { LineAreaChartResult } from "@/composables/useLineAreaChartData";

defineProps<{
  /** Pre-computed chart data from useLineAreaChartData. */
  chartData: LineAreaChartResult<{ date: string }>;
  /** Shared layout dimensions. */
  chartLayout: ChartLayout;
  /** Y-axis grid line positions. */
  gridLines: number[];
  /** Tooltip state from useChartTooltip. */
  tooltip: ChartTooltipState;
  /** Unique chart identifier (also used to generate the SVG gradient ID). */
  chartId: string;
  /** Accessibility label for screen readers. */
  ariaLabel: string;
  /** Primary line and area colour. */
  color: string;
  /** Lighter colour variant for the last dot (defaults to color). */
  colorLight?: string;
  /** Area gradient top-stop opacity (default: 0.25). */
  gradientOpacity?: number;
}>();

defineEmits<{
  mousemove: [event: MouseEvent];
  click: [event: MouseEvent];
  "dismiss-tooltip": [];
}>();
</script>

<template>
  <ChartFrame
    :chart-layout="chartLayout"
    :grid-lines="gridLines"
    :y-labels="chartData.yLabels"
    :x-labels="chartData.xLabels"
    :ariaLabel="ariaLabel"
    :chart-id="chartId"
    :tooltip="tooltip"
    @mousemove="$emit('mousemove', $event)"
    @click="$emit('click', $event)"
    @dismiss-tooltip="$emit('dismiss-tooltip')"
  >
    <template #defs>
      <linearGradient :id="`${chartId}-area-grad`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" :stop-opacity="gradientOpacity ?? 0.25" />
        <stop offset="100%" :stop-color="color" stop-opacity="0.02" />
      </linearGradient>
    </template>

    <!-- Area fill -->
    <polygon :points="chartData.areaPoints" :fill="`url(#${chartId}-area-grad)`" />

    <!-- Line -->
    <polyline
      :points="chartData.linePoints"
      fill="none"
      :stroke="color"
      stroke-width="2"
      stroke-linejoin="round"
      stroke-linecap="round"
    />

    <!-- Data dots -->
    <circle
      v-for="(c, ci) in chartData.coords"
      :key="`${chartId}-d-${ci}`"
      :cx="c.x"
      :cy="c.y"
      :r="ci === chartData.coords.length - 1 ? 3.5 : 3"
      :fill="ci === chartData.coords.length - 1 ? (colorLight ?? color) : color"
      class="chart-dot"
    />

    <!-- Highlight ring on active point -->
    <circle
      v-if="tooltip.chartId === chartId && tooltip.highlightIndex >= 0 && tooltip.highlightIndex < chartData.coords.length"
      :cx="chartData.coords[tooltip.highlightIndex].x"
      :cy="chartData.coords[tooltip.highlightIndex].y"
      r="6"
      fill="none"
      :stroke="color"
      stroke-width="2"
      class="chart-highlight-ring"
    />
  </ChartFrame>
</template>
