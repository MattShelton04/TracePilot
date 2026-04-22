<script setup lang="ts">
import type { AnalyticsData } from "@tracepilot/types";
import type { ChartLayout, ChartTooltipState } from "@tracepilot/ui";
import {
  ChartFrame,
  computeBarWidth,
  formatDateMedium,
  formatDateShort,
  formatNumber,
  formatNumberFull,
  generateXLabels,
  generateYLabels,
  SectionPanel,
  useChartTooltip,
} from "@tracepilot/ui";
import { computed } from "vue";
import LineAreaChart from "@/components/charts/LineAreaChart.vue";
import { useLineAreaChartData } from "@/composables/useLineAreaChartData";
import { CHART_COLORS } from "@/utils/chartColors";

const props = defineProps<{
  data: AnalyticsData;
  chartLayout: ChartLayout;
  gridLines: number[];
  timeRangeLabel: string;
  tooltip: ChartTooltipState;
  onChartMouseMove: ReturnType<typeof useChartTooltip>["onChartMouseMove"];
  onChartClick: ReturnType<typeof useChartTooltip>["onChartClick"];
  dismissTooltip: ReturnType<typeof useChartTooltip>["dismissTooltip"];
}>();

const { chartData: tokenChart } = useLineAreaChartData({
  data: computed(() => props.data.tokenUsageByDay ?? null),
  layout: props.chartLayout,
  accessor: (p) => p.tokens,
  yFormatter: formatNumber,
});

const activityChart = computed(() => {
  const pts = props.data.activityPerDay;
  if (pts.length === 0) return null;
  const {
    left: CHART_LEFT,
    bottom: CHART_BOTTOM,
    width: CHART_W,
    height: CHART_H,
  } = props.chartLayout;
  const max = Math.max(...pts.map((p) => p.count), 1);
  const spacing = CHART_W / pts.length;
  const barW = computeBarWidth(CHART_W, pts.length);

  const bars = pts.map((p, i) => {
    const x = CHART_LEFT + i * spacing + (spacing - barW) / 2;
    const h = (p.count / max) * CHART_H;
    return { x, y: CHART_BOTTOM - h, width: barW, height: h, date: p.date, count: p.count };
  });
  const yLabels = generateYLabels(max, props.chartLayout, 5, (v) => String(Math.round(v)));
  const xLabels = generateXLabels(
    pts,
    (_, i) => CHART_LEFT + i * spacing + spacing / 2,
    (p) => formatDateShort(p.date),
  );
  return { bars, yLabels, xLabels };
});
</script>

<template>
  <div class="grid-2 mb-4">
    <!-- Token Usage Over Time -->
    <SectionPanel title="Token Usage Over Time">
      <LineAreaChart
        v-if="tokenChart"
        :chart-data="tokenChart"
        :chart-layout="chartLayout"
        :grid-lines="gridLines"
        :tooltip="tooltip"
        chart-id="tokens"
        :ariaLabel="`Line chart showing token usage over ${timeRangeLabel}`"
        :color="CHART_COLORS.primary"
        :color-light="CHART_COLORS.primaryLight"
        @mousemove="onChartMouseMove($event, tokenChart.coords, (i) => `${formatDateMedium(tokenChart!.coords[i].date)} — ${formatNumberFull(tokenChart!.coords[i].tokens)} tokens`, 'tokens', '.chart-frame')"
        @click="onChartClick($event, tokenChart.coords, (i) => `${formatDateMedium(tokenChart!.coords[i].date)} — ${formatNumberFull(tokenChart!.coords[i].tokens)} tokens`, 'tokens', '.chart-frame')"
        @dismiss-tooltip="dismissTooltip"
      />
    </SectionPanel>

    <!-- Session Activity Per Day -->
    <SectionPanel title="Session Activity Per Day">
      <ChartFrame
        v-if="activityChart"
        :chart-layout="chartLayout"
        :grid-lines="gridLines"
        :y-labels="activityChart.yLabels"
        :x-labels="activityChart.xLabels"
        :ariaLabel="`Bar chart showing session activity per day over ${timeRangeLabel}`"
        chart-id="activity"
        :tooltip="tooltip"
        @mousemove="onChartMouseMove($event, activityChart.bars.map(b => ({ x: b.x + b.width / 2, date: b.date })), (i) => `${formatDateMedium(activityChart!.bars[i].date)} — ${activityChart!.bars[i].count} activit${activityChart!.bars[i].count !== 1 ? 'ies' : 'y'}`, 'activity', '.chart-frame')"
        @click="onChartClick($event, activityChart.bars.map(b => ({ x: b.x + b.width / 2, date: b.date })), (i) => `${formatDateMedium(activityChart!.bars[i].date)} — ${activityChart!.bars[i].count} activit${activityChart!.bars[i].count !== 1 ? 'ies' : 'y'}`, 'activity', '.chart-frame')"
        @dismiss-tooltip="dismissTooltip"
      >
        <template #defs>
          <linearGradient id="sessionBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" :stop-color="CHART_COLORS.primaryLight" />
            <stop offset="100%" :stop-color="CHART_COLORS.primary" />
          </linearGradient>
        </template>
        <rect
          v-for="(bar, bi) in activityChart.bars"
          :key="`sb-${bi}`"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          rx="3"
          fill="url(#sessionBarGrad)"
          class="chart-bar"
          :class="{ 'chart-bar--active': tooltip.chartId === 'activity' && tooltip.highlightIndex === bi }"
        />
      </ChartFrame>
    </SectionPanel>
  </div>
</template>
