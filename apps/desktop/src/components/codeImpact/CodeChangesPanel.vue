<script setup lang="ts">
/**
 * Lines added and removed per day, stacked, as bars or lines (remembered).
 * A session's lines count on its last day, like every analytics series.
 */
import { formatNumber, formatNumberFull } from "@tracepilot/types";
import { SegmentedControl } from "@tracepilot/ui";
import { computed, ref } from "vue";
import AnalyticsDayChart from "@/components/analytics/AnalyticsDayChart.vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useAnalyticsDashboardViews } from "@/composables/useAnalyticsDashboardViews";
import { useAnalyticsStore } from "@/stores/analytics";
import {
  analyticsEmptyScope,
  busiestColumn,
  type DayRow,
  perColumnTitle,
} from "@/utils/analyticsDashboard";
import { CODE_SERIES } from "@/utils/codeImpact";

const props = defineProps<{
  rows: DayRow[];
}>();

const filters = useAnalyticsStore();
/** Names the filters that emptied the panel. */
const scope = computed(() => analyticsEmptyScope(filters));

const views = useAnalyticsDashboardViews();
const STYLES = [
  { value: "bars", label: "Bars" },
  { value: "lines", label: "Lines" },
];
const style = computed({
  get: () => views.value.codeStyle,
  set: (value: string) => {
    views.value.codeStyle = value as "bars" | "lines";
  },
});

/** The columns the chart draws: days, or bins of days on a long range. */
const drawn = ref<DayRow[]>([]);

/** Whole lines per day; an average keeps one decimal. */
const format = (v: number) => (Number.isInteger(v) ? formatNumberFull(v) : v.toFixed(1));
const axisFormat = (v: number) => formatNumber(Math.round(v));

function detail(row: DayRow): string[] {
  const [added, removed] = row.values;
  const net = added - removed;
  if (!added && !removed) return [];
  return [`Net ${net > 0 ? "+" : net < 0 ? "−" : ""}${formatNumberFull(Math.abs(net))}`];
}

const footer = computed(() => {
  const rows = props.rows;
  const totals = rows.map((row) => row.values[0] + row.values[1]);
  const active = totals.filter((total) => total > 0);
  if (!active.length) return null;
  const peak = busiestColumn(drawn.value.length ? drawn.value : rows);
  return {
    peak:
      rows.length > 1 && peak
        ? {
            day: peak.label,
            added: formatNumber(peak.row.values[0]),
            removed: formatNumber(peak.row.values[1]),
          }
        : null,
    average:
      rows.length > 1
        ? formatNumber(Math.round(active.reduce((a, b) => a + b, 0) / active.length))
        : null,
    quiet: rows.length - active.length,
    legend: CODE_SERIES.filter((_, j) => rows.some((row) => row.values[j] > 0)),
  };
});
</script>

<template>
  <OverviewPanel :title="perColumnTitle('Changes', drawn)" data-testid="code-changes-per-day">
    <template #aside>
      <SegmentedControl v-model="style" class="ad-seg" :options="STYLES" aria-label="Chart style" />
    </template>

    <template v-if="footer">
      <AnalyticsDayChart
        :series="CODE_SERIES"
        :rows="rows"
        :mode="style"
        :format="format"
        :axis-format="axisFormat"
        label="Lines added and removed per day"
        integer
        :detail="detail"
        @columns="drawn = $event"
      />
      <div class="ad-foot">
        <span v-if="footer.peak">
          Busiest <b>{{ footer.peak.day }}</b> (+{{ footer.peak.added }} / −{{ footer.peak.removed }})
        </span>
        <span v-if="footer.average">Average <b>{{ footer.average }}</b> lines per active day</span>
        <span v-if="footer.quiet"><b>{{ footer.quiet }}</b> quiet day{{ footer.quiet === 1 ? "" : "s" }}</span>
        <span class="ad-legend">
          <span v-for="series in footer.legend" :key="series.key">
            <i class="ad-sw" :style="{ background: series.color }" />{{ series.label }}
          </span>
        </span>
      </div>
    </template>
    <p v-else class="ad-empty">
      <b>No line changes</b>
      No {{ scope.source }}session{{ scope.suffix }} reported lines added or removed.
    </p>
  </OverviewPanel>
</template>
