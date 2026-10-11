<script setup lang="ts">
/**
 * Day-by-day activity: cost, tokens or runs, stacked by source as bars or
 * lines, with errors pinned over the days they happened. The metric and the
 * style are remembered between visits.
 */
import { type AnalyticsData, formatNumber, formatNumberFull, sourceLabel } from "@tracepilot/types";
import { SegmentedControl } from "@tracepilot/ui";
import { computed } from "vue";
import AnalyticsDayChart from "@/components/analytics/AnalyticsDayChart.vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useAnalyticsDashboardViews } from "@/composables/useAnalyticsDashboardViews";
import { type ActivityMetric, activityRows, type DayRow } from "@/utils/analyticsDashboard";
import {
  type DashboardSummary,
  formatAxisCost,
  formatDashboardCost,
} from "@/utils/analyticsSummary";

const props = defineProps<{
  data: AnalyticsData;
  summary: DashboardSummary;
  days: string[];
  /** e.g. `the last 30 days`, for the empty state. */
  rangeText: string;
}>();

const views = useAnalyticsDashboardViews();

const METRICS = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
  { value: "runs", label: "Runs" },
];
const STYLES = [
  { value: "bars", label: "Bars" },
  { value: "lines", label: "Lines" },
];

const metric = computed({
  get: () => views.value.activityMetric,
  set: (value: string) => {
    views.value.activityMetric = value as ActivityMetric;
  },
});
const style = computed({
  get: () => views.value.activityStyle,
  set: (value: string) => {
    views.value.activityStyle = value as "bars" | "lines";
  },
});

const chart = computed(() =>
  activityRows({
    data: props.data,
    days: props.days,
    metric: metric.value,
    aiCreditsByDay: props.summary.aiCreditsByDay,
    label: sourceLabel,
  }),
);

const inCredits = computed(() => props.summary.inAiCredits);
/** Whole runs per day; an average keeps one decimal. */
const formatRuns = (v: number) => (Number.isInteger(v) ? formatNumberFull(v) : v.toFixed(1));
const format = computed(() => {
  if (metric.value === "cost") return (v: number) => formatDashboardCost(v, inCredits.value);
  if (metric.value === "tokens") return (v: number) => formatNumber(Math.round(v));
  return formatRuns;
});
const axisFormat = computed(() => {
  if (metric.value === "cost") return (v: number) => formatAxisCost(v, inCredits.value);
  if (metric.value === "tokens") return (v: number) => formatNumber(Math.round(v));
  return formatRuns;
});

function detail(row: DayRow): string[] {
  const lines: string[] = [];
  if (metric.value !== "runs")
    lines.push(`${formatNumberFull(row.runs)} run${row.runs === 1 ? "" : "s"}`);
  if (row.errors) lines.push(`${row.errors} error${row.errors === 1 ? "" : "s"}`);
  if (row.rateLimits) lines.push(`${row.rateLimits} rate limit${row.rateLimits === 1 ? "" : "s"}`);
  return lines;
}

const footer = computed(() => {
  const rows = chart.value.rows;
  const totals = rows.map((row) => row.values.reduce((a, b) => a + b, 0));
  const active = totals.filter((total) => total > 0);
  if (!active.length) return null;
  const peak = totals.indexOf(Math.max(...totals));
  const quiet = rows.length - active.length;
  const drawn = chart.value.series.filter((_, j) => rows.some((row) => row.values[j] > 0));
  return {
    peak:
      rows.length > 1
        ? {
            day: new Date(`${rows[peak].from}T00:00:00Z`).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }),
            value: format.value(totals[peak]),
          }
        : null,
    average:
      rows.length > 1 ? format.value(active.reduce((a, b) => a + b, 0) / active.length) : null,
    quiet,
    legend: drawn,
    errors: rows.some((row) => row.errors > 0),
    rateLimits: rows.some((row) => row.rateLimits > 0),
  };
});

const ariaLabel = computed(() => {
  const what = metric.value === "cost" ? "Cost" : metric.value === "tokens" ? "Tokens" : "Runs";
  return `${what} per day${chart.value.series.length > 1 ? " by source" : ""}`;
});
</script>

<template>
  <OverviewPanel title="Activity" class="analytics-activity" data-testid="analytics-activity">
    <template #aside>
      <div class="ad-switches">
        <SegmentedControl v-model="metric" class="ad-seg" :options="METRICS" aria-label="Activity metric" />
        <SegmentedControl v-model="style" class="ad-seg" :options="STYLES" aria-label="Chart style" />
      </div>
    </template>

    <template v-if="footer">
      <AnalyticsDayChart
        :series="chart.series"
        :rows="chart.rows"
        :mode="style"
        :format="format"
        :axis-format="axisFormat"
        :label="ariaLabel"
        :integer="metric === 'runs'"
        :detail="detail"
        pins
      />
      <div class="ad-foot">
        <span v-if="footer.peak">Busiest <b>{{ footer.peak.day }}</b> ({{ footer.peak.value }})</span>
        <span v-if="footer.average">Average <b>{{ footer.average }}</b> per active day</span>
        <span v-if="footer.quiet"><b>{{ footer.quiet }}</b> quiet day{{ footer.quiet === 1 ? "" : "s" }}</span>
        <span class="ad-legend">
          <span v-for="series in footer.legend" :key="series.key">
            <i class="ad-sw" :style="{ background: series.color }" />{{ series.label }}
          </span>
          <span v-if="footer.errors"><i class="ad-sw activity-pin activity-pin--error" />Error</span>
          <span v-if="footer.rateLimits"><i class="ad-sw activity-pin activity-pin--rate" />Rate limit</span>
        </span>
      </div>
    </template>
    <p v-else class="ad-empty">
      <b>No activity</b>
      No sessions ended in {{ rangeText }}.
    </p>
  </OverviewPanel>
</template>

<style scoped>
.activity-pin {
  border-radius: 50%;
}

.activity-pin--error {
  background: var(--danger-fg);
}

.activity-pin--rate {
  background: var(--warning-fg);
}
</style>
