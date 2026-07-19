<script setup lang="ts">
import type { ToolUsageEntry } from "@tracepilot/types";
import { formatNumberFull, formatRate } from "@tracepilot/types";
import { ChartTooltip, useChartTooltip } from "@tracepilot/ui";
import { computed } from "vue";
import { CHART_COLORS } from "@/utils/chartColors";

const props = defineProps<{
  tools: readonly ToolUsageEntry[];
  maxInvocations: number;
}>();

const { tooltip, positionTooltip, dismissTooltip, findNearestIndex } = useChartTooltip();

const CHART_RIGHT = 496;
const MIN_LABEL_WIDTH = 100;
const MAX_LABEL_WIDTH = 120;
const MAX_LABEL_CHARACTERS = 16;
const BAR_HEIGHT = 22;
const ROW_SPACING = 28;

function displayToolName(name: string): string {
  return name.length > MAX_LABEL_CHARACTERS ? `${name.slice(0, MAX_LABEL_CHARACTERS - 1)}…` : name;
}

const chart = computed(() => {
  if (!props.tools.length) return null;
  const maxCalls = props.maxInvocations || 1;
  const longestLabel = Math.max(...props.tools.map((tool) => displayToolName(tool.name).length));
  const chartLeft = Math.min(Math.max(longestLabel * 7 + 20, MIN_LABEL_WIDTH), MAX_LABEL_WIDTH);
  const chartWidth = CHART_RIGHT - chartLeft;
  const rows = props.tools.map((tool, i) => {
    const successCount = Math.round(tool.callCount * tool.successRate);
    const failureCount = tool.callCount - successCount;
    const successWidth = (successCount / maxCalls) * chartWidth;
    const failureWidth = (failureCount / maxCalls) * chartWidth;
    const y = 18 + i * ROW_SPACING;
    return {
      tool,
      label: displayToolName(tool.name),
      successCount,
      failureCount,
      successWidth,
      failureWidth,
      y,
    };
  });
  const svgHeight = 18 + rows.length * ROW_SPACING + 10;
  return { rows, svgHeight, chartLeft };
});

function onMouseMove(event: MouseEvent) {
  if (tooltip.pinned) return;
  const c = chart.value;
  if (!c) return;
  const svg = (event.target as SVGElement)?.closest("svg");
  const container = (event.target as SVGElement)?.closest(".tooltip-area") as HTMLElement | null;
  if (!svg || !container) return;
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const svgPt = pt.matrixTransform(ctm.inverse());
  const bestIdx = findNearestIndex(
    c.rows.map((r) => r.y + BAR_HEIGHT / 2),
    svgPt.y,
  );
  if (bestIdx < 0) return;
  const row = c.rows[bestIdx];
  const total = row.successCount + row.failureCount;
  const rate = formatRate(total > 0 ? row.successCount / total : 0);
  tooltip.visible = true;
  tooltip.content = `${row.tool.name} — ${formatNumberFull(row.successCount)} success / ${formatNumberFull(row.failureCount)} failure (${rate})`;
  tooltip.chartId = "success-failure";
  tooltip.highlightIndex = bestIdx;
  positionTooltip(event, container);
}

function onClick(event: MouseEvent) {
  if (tooltip.pinned && tooltip.chartId === "success-failure") {
    tooltip.pinned = false;
    return;
  }
  tooltip.pinned = false;
  onMouseMove(event);
  if (tooltip.visible) {
    tooltip.pinned = true;
  }
}
</script>

<template>
  <div class="section-panel tool-success-failure">
    <div class="section-panel-header">Success / Failure Breakdown</div>
    <div
      class="section-panel-body scrollable-section tooltip-area"
      @mouseleave="dismissTooltip"
    >
      <div class="tool-success-failure__legend">
        <span>
          <span class="tool-success-failure__dot" :style="{ background: CHART_COLORS.success }" />
          &nbsp;Success
        </span>
        <span>
          <span class="tool-success-failure__dot" :style="{ background: CHART_COLORS.danger }" />
          &nbsp;Failure
        </span>
      </div>
      <svg
        v-if="chart"
        class="chart-svg"
        :viewBox="`0 0 600 ${chart.svgHeight}`"
        role="img"
        aria-label="Stacked horizontal bar chart showing success and failure counts per tool"
        @mousemove="onMouseMove($event)"
        @click="onClick($event)"
      >
        <template v-for="(row, ri) in chart.rows" :key="`sf-${ri}`">
          <text
            :x="chart.chartLeft - 12"
            :y="row.y + BAR_HEIGHT / 2 + 4"
            font-family="Inter, sans-serif"
            font-size="12"
            fill="var(--text-placeholder)"
            text-anchor="end"
          >
            <title>{{ row.tool.name }}</title>
            {{ row.label }}
          </text>
          <rect
            :x="chart.chartLeft"
            :y="row.y"
            :width="Math.max(row.successWidth, 0)"
            :height="BAR_HEIGHT"
            rx="3"
            :fill="CHART_COLORS.success"
            class="chart-bar"
            :class="{ 'chart-bar--active': tooltip.chartId === 'success-failure' && tooltip.highlightIndex === ri }"
          />
          <rect
            v-if="row.failureWidth > 0"
            :x="chart.chartLeft + row.successWidth"
            :y="row.y"
            :width="row.failureWidth"
            :height="BAR_HEIGHT"
            rx="3"
            :fill="CHART_COLORS.danger"
            class="chart-bar"
            :class="{ 'chart-bar--active': tooltip.chartId === 'success-failure' && tooltip.highlightIndex === ri }"
          />
          <text
            :x="chart.chartLeft + row.successWidth + row.failureWidth + 8"
            :y="row.y + BAR_HEIGHT / 2 + 4"
            font-family="Inter, sans-serif"
            font-size="10"
            fill="var(--text-placeholder)"
          >{{ row.successCount }} / {{ row.failureCount }}</text>
        </template>
        <rect
          :x="0"
          :y="0"
          width="600"
          :height="chart.svgHeight"
          fill="transparent"
          class="chart-overlay"
        />
      </svg>
      <ChartTooltip :tooltip="tooltip" chart-id="success-failure" />
    </div>
  </div>
</template>

<style scoped>
.tool-success-failure__legend {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 0.75rem;
  color: var(--text-placeholder);
}

.tool-success-failure__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 5px;
}

.scrollable-section {
  max-height: 400px;
  overflow-x: hidden;
  overflow-y: auto;
}
</style>
