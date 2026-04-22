<script setup lang="ts">
import type { AnalyticsData } from "@tracepilot/types";
import type { ChartLayout, ChartTooltipState } from "@tracepilot/ui";
import { ChartFrame, SectionPanel, useChartTooltip } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { useIncidentChartData } from "@/composables/useIncidentChartData";

const props = defineProps<{
  data: AnalyticsData;
  chartLayout: ChartLayout;
  tooltip: ChartTooltipState;
  onChartMouseMove: ReturnType<typeof useChartTooltip>["onChartMouseMove"];
  onChartClick: ReturnType<typeof useChartTooltip>["onChartClick"];
  dismissTooltip: ReturnType<typeof useChartTooltip>["dismissTooltip"];
}>();

const incidentNormalize = ref(false);

const {
  chartData: incidentChart,
  gridLines: incidentGridLines,
  formatTooltip: formatIncidentTooltip,
} = useIncidentChartData({
  incidents: computed(() => props.data.incidentsByDay ?? null),
  activity: computed(() => props.data.activityPerDay ?? null),
  normalize: incidentNormalize,
  layout: props.chartLayout,
});
</script>

<template>
  <SectionPanel v-if="incidentChart" title="Incidents Over Time" class="mb-4">
    <template #actions>
      <label class="incident-normalize-toggle" title="Show incidents per session per day for a normalized view">
        <input type="checkbox" v-model="incidentNormalize" />
        <span>Per Session</span>
      </label>
    </template>
    <ChartFrame
      :chart-layout="chartLayout"
      :grid-lines="incidentGridLines"
      :y-labels="incidentChart.yLabels"
      :x-labels="incidentChart.xLabels"
      :ariaLabel="`Stacked bar chart showing incidents over time${incidentNormalize ? ' (normalized per session)' : ''}`"
      chart-id="incidents"
      :tooltip="tooltip"
      @mousemove="onChartMouseMove($event, incidentChart.bars, (i) => formatIncidentTooltip(incidentChart!.bars[i]), 'incidents', '.chart-frame')"
      @click="onChartClick($event, incidentChart.bars, (i) => formatIncidentTooltip(incidentChart!.bars[i]), 'incidents', '.chart-frame')"
      @dismiss-tooltip="dismissTooltip"
    >
      <g v-for="(bar, i) in incidentChart.bars" :key="`ib-${i}`">
        <rect
          v-if="bar.truncRect.h > 0.5"
          :x="bar.x - incidentChart.barW / 2"
          :y="bar.truncRect.y"
          :width="incidentChart.barW"
          :height="bar.truncRect.h"
          fill="var(--text-tertiary, #71717a)"
          rx="1"
          class="chart-bar"
          :class="{ 'chart-bar--active': tooltip.chartId === 'incidents' && tooltip.highlightIndex === i }"
        />
        <rect
          v-if="bar.compRect.h > 0.5"
          :x="bar.x - incidentChart.barW / 2"
          :y="bar.compRect.y"
          :width="incidentChart.barW"
          :height="bar.compRect.h"
          fill="var(--chart-secondary)"
          rx="1"
          class="chart-bar"
          :class="{ 'chart-bar--active': tooltip.chartId === 'incidents' && tooltip.highlightIndex === i }"
        />
        <rect
          v-if="bar.otherRect.h > 0.5"
          :x="bar.x - incidentChart.barW / 2"
          :y="bar.otherRect.y"
          :width="incidentChart.barW"
          :height="bar.otherRect.h"
          fill="var(--danger-fg)"
          rx="1"
          class="chart-bar"
          :class="{ 'chart-bar--active': tooltip.chartId === 'incidents' && tooltip.highlightIndex === i }"
        />
        <rect
          v-if="bar.rlRect.h > 0.5"
          :x="bar.x - incidentChart.barW / 2"
          :y="bar.rlRect.y"
          :width="incidentChart.barW"
          :height="bar.rlRect.h"
          fill="var(--warning-fg)"
          rx="1"
          class="chart-bar"
          :class="{ 'chart-bar--active': tooltip.chartId === 'incidents' && tooltip.highlightIndex === i }"
        />
      </g>

      <template #footer>
        <div class="incident-chart-legend">
          <span class="legend-item"><span class="legend-dot" style="background: var(--warning-fg);"></span> Rate Limits</span>
          <span class="legend-item"><span class="legend-dot" style="background: var(--danger-fg);"></span> Other Errors</span>
          <span class="legend-item"><span class="legend-dot" style="background: var(--chart-secondary);"></span> Compactions</span>
          <span class="legend-item"><span class="legend-dot" style="background: var(--text-tertiary);"></span> Truncations</span>
        </div>
      </template>
    </ChartFrame>
  </SectionPanel>
</template>

<style scoped>
.incident-chart-legend {
  display: flex;
  gap: 20px;
  justify-content: center;
  padding: 10px 0 6px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.incident-normalize-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.incident-normalize-toggle input {
  accent-color: var(--accent-primary);
  cursor: pointer;
}
</style>
