<script setup lang="ts">
/**
 * Tool calls per day: calls (failed stacked on top), failures alone, or
 * tool time, as bars or lines. The metric and style are remembered.
 */
import { formatNumber, formatNumberFull, type ToolAnalysisData } from "@tracepilot/types";
import { SegmentedControl } from "@tracepilot/ui";
import { computed, ref } from "vue";
import AnalyticsDayChart from "@/components/analytics/AnalyticsDayChart.vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useAnalyticsDashboardViews } from "@/composables/useAnalyticsDashboardViews";
import { busiestColumn, type DayRow, perColumnTitle } from "@/utils/analyticsDashboard";
import { formatToolTime, type ToolDayMetric, toolDayRows } from "@/utils/toolAnalysis";

const props = defineProps<{
  data: ToolAnalysisData;
  days: string[];
  /** e.g. `the past 30 days`, for the empty state. */
  rangeText: string;
}>();

const views = useAnalyticsDashboardViews();

const METRICS = [
  { value: "calls", label: "Calls" },
  { value: "failures", label: "Failures" },
  { value: "time", label: "Tool time" },
];
const STYLES = [
  { value: "bars", label: "Bars" },
  { value: "lines", label: "Lines" },
];

const metric = computed({
  get: () => views.value.toolsMetric,
  set: (value: string) => {
    views.value.toolsMetric = value as ToolDayMetric;
  },
});
const style = computed({
  get: () => views.value.toolsStyle,
  set: (value: string) => {
    views.value.toolsStyle = value as "bars" | "lines";
  },
});

const chart = computed(() => toolDayRows(props.data, props.days, metric.value));
/** The columns the chart draws: days, or bins of days on a long range. */
const drawn = ref<DayRow[]>([]);
const calls = (n: number) => `${formatNumberFull(n)} call${n === 1 ? "" : "s"}`;

/** Whole calls per day; an average keeps one decimal. */
const formatCount = (v: number) => (Number.isInteger(v) ? formatNumberFull(v) : v.toFixed(1));
const format = computed(() => (metric.value === "time" ? formatToolTime : formatCount));
const axisFormat = computed(() =>
  metric.value === "time" ? formatToolTime : (v: number) => formatNumber(Math.round(v)),
);

function detail(row: DayRow): string[] {
  if (metric.value === "calls") return [];
  const lines = [calls(row.runs)];
  if (metric.value === "time" && row.errors) lines.push(`${formatNumberFull(row.errors)} failed`);
  return lines;
}

/** Anything to draw at all: calls exist even when a metric is zero. */
const hasCalls = computed(() => chart.value.rows.some((row) => row.runs > 0));

const footer = computed(() => {
  const rows = chart.value.rows;
  const totals = rows.map((row) => row.values.reduce((a, b) => a + b, 0));
  const active = totals.filter((total) => total > 0);
  const peak = busiestColumn(drawn.value.length ? drawn.value : rows);
  const failed = rows.reduce((sum, row) => sum + row.errors, 0);
  return {
    peak: rows.length > 1 && peak ? { day: peak.label, value: format.value(peak.total) } : null,
    average:
      rows.length > 1 && active.length
        ? format.value(active.reduce((a, b) => a + b, 0) / active.length)
        : null,
    quiet: rows.filter((row) => row.runs === 0).length,
    noFailures: metric.value === "failures" && failed === 0,
    legend: chart.value.series.filter((_, j) => rows.some((row) => row.values[j] > 0)),
  };
});

const ariaLabel = computed(() => {
  if (metric.value === "failures") return "Failed tool calls per day";
  if (metric.value === "time") return "Tool time per day";
  return "Tool calls per day, failed calls stacked on top";
});
</script>

<template>
  <OverviewPanel :title="perColumnTitle('Calls', drawn)" data-testid="tool-calls-per-day">
    <template #aside>
      <div class="ad-switches">
        <SegmentedControl v-model="metric" class="ad-seg" :options="METRICS" aria-label="Tool chart metric" />
        <SegmentedControl v-model="style" class="ad-seg" :options="STYLES" aria-label="Chart style" />
      </div>
    </template>

    <template v-if="hasCalls">
      <AnalyticsDayChart
        :series="chart.series"
        :rows="chart.rows"
        :mode="style"
        :format="format"
        :axis-format="axisFormat"
        :label="ariaLabel"
        :integer="metric !== 'time'"
        :detail="detail"
        @columns="drawn = $event"
      />
      <div class="ad-foot">
        <span v-if="footer.noFailures">No failed calls in {{ rangeText }}</span>
        <template v-else>
          <span v-if="footer.peak">Busiest <b>{{ footer.peak.day }}</b> ({{ footer.peak.value }})</span>
          <span v-if="footer.average">Average <b>{{ footer.average }}</b> per active day</span>
        </template>
        <span v-if="footer.quiet"><b>{{ footer.quiet }}</b> quiet day{{ footer.quiet === 1 ? "" : "s" }}</span>
        <span class="ad-legend">
          <span v-for="series in footer.legend" :key="series.key">
            <i class="ad-sw" :style="{ background: series.color }" />{{ series.label }}
          </span>
        </span>
      </div>
    </template>
    <p v-else class="ad-empty">
      <b>No tool calls</b>
      No sessions with tool calls ended in {{ rangeText }}.
    </p>
  </OverviewPanel>
</template>
