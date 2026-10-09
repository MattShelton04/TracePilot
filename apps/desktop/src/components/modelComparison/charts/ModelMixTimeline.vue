<script setup lang="ts">
import { computed, ref } from "vue";
import {
  buildMixSeries,
  formatTokens,
  formatTokenTick,
  formatUsd,
  linearScale,
  type MixMeasure,
  niceLinearTicks,
  OTHERS_KEY,
} from "@/composables/modelComparison/charts";
import {
  type ModelTooltipContent,
  useModelChartTooltip,
} from "@/composables/modelComparison/useModelChartTooltip";
import { useElementWidth } from "@/composables/useElementWidth";
import { useModelComparisonContext } from "@/composables/useModelComparison";
import { MODEL_TAIL_COLOR } from "@/utils/chartColors";
import ChartModeToggle from "./ChartModeToggle.vue";
import ModelChartLegend from "./ModelChartLegend.vue";
import ModelChartTooltip from "./ModelChartTooltip.vue";

const ctx = useModelComparisonContext();
const root = ref<HTMLElement | null>(null);
const width = useElementWidth(root, 1000);
const { tooltip, show, hide } = useModelChartTooltip();

const measure = ref<MixMeasure>("tokens");
const MEASURES: Array<{ value: MixMeasure; label: string }> = [
  { value: "tokens", label: "Tokens" },
  { value: "share", label: "Share" },
  { value: "spend", label: "Spend" },
];

const HEIGHT = 280;
const PAD = { left: 52, right: 8, top: 10, bottom: 26 };

const rowsById = computed(() => new Map(ctx.modelRows.map((row) => [row.id, row])));
const named = computed(() =>
  [...ctx.modelRows]
    .filter((row) => row.color !== MODEL_TAIL_COLOR)
    .sort((a, b) => b.tokens - a.tokens)
    .map((row) => row.id),
);
const series = computed(() =>
  buildMixSeries(ctx.data?.modelUsageByDay ?? [], ctx.modelRows, {
    measure: measure.value === "spend" ? "spend" : "tokens",
    named: named.value,
  }),
);

const colorOf = (key: string) =>
  key === OTHERS_KEY ? MODEL_TAIL_COLOR : (rowsById.value.get(key)?.color ?? MODEL_TAIL_COLOR);
const labelOf = (key: string) =>
  key === OTHERS_KEY ? "Others" : (rowsById.value.get(key)?.label ?? key);

const legendItems = computed(() =>
  series.value.keys
    .filter((key) => series.value.buckets.some((b) => b.values[key] > 0))
    .map((key) => ({ id: key, label: labelOf(key), color: colorOf(key) })),
);

const formatValue = (v: number) => (measure.value === "spend" ? formatUsd(v) : formatTokens(v));

const chart = computed(() => {
  const w = Math.max(width.value, 320);
  const plot = {
    x: PAD.left,
    y: PAD.top,
    w: w - PAD.left - PAD.right,
    h: HEIGHT - PAD.top - PAD.bottom,
  };
  const buckets = series.value.buckets;
  const share = measure.value === "share";
  const max = share ? 1 : Math.max(...buckets.map((b) => b.total), 0);
  const { max: top, ticks } = share
    ? { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] }
    : niceLinearTicks(max, 4);
  const y = linearScale([0, top], [plot.y + plot.h, plot.y]);
  const slot = plot.w / Math.max(buckets.length, 1);
  const barW = Math.max(1, Math.min(slot - (slot > 6 ? 3 : 1), 48));
  const columns = buckets.map((b, i) => {
    const x = plot.x + i * slot + (slot - barW) / 2;
    let acc = 0;
    const segments = series.value.keys
      .map((key) => {
        const raw = b.values[key];
        const v = share ? (b.total > 0 ? raw / b.total : 0) : raw;
        if (v <= 0) return null;
        const y0 = y(acc + v);
        const y1 = y(acc);
        const gap = acc > 0 ? 1 : 0;
        acc += v;
        return { key, y: y0, h: Math.max(0.5, y1 - y0 - gap) };
      })
      .filter((s): s is { key: string; y: number; h: number } => s != null && s.h >= 0.5);
    return { b, i, x, segments, slotX: plot.x + i * slot };
  });
  // Label the first bucket of each month; daily views label every few days.
  const daily = series.value.granularity === "day";
  const stride = daily ? Math.max(1, Math.ceil(buckets.length / Math.max(1, plot.w / 56))) : 1;
  const xLabels: Array<{ x: number; text: string }> = [];
  let lastMonth = "";
  buckets.forEach((b, i) => {
    const date = new Date(`${b.start}T00:00:00Z`);
    const cx = plot.x + i * slot + slot / 2;
    if (daily) {
      if (i % stride === 0) {
        xLabels.push({
          x: cx,
          text: date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }),
        });
      }
      return;
    }
    const month = b.start.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      xLabels.push({
        x: cx,
        text: date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      });
    }
  });
  return { w, plot, y, ticks, columns, slot, barW, xLabels, share };
});

const active = ref<number | null>(null);

function onColumn(event: PointerEvent, index: number) {
  active.value = index;
  const bucket = series.value.buckets[index];
  const daily = series.value.granularity === "day";
  const rows: ModelTooltipContent["rows"] = series.value.keys
    .filter((key) => bucket.values[key] > 0)
    .sort((a, b) => bucket.values[b] - bucket.values[a])
    .map((key) => ({
      label: labelOf(key),
      color: colorOf(key),
      value: `${formatValue(bucket.values[key])} · ${((bucket.values[key] / bucket.total) * 100).toFixed(0)}%`,
    }));
  rows.push({ label: "Total", value: formatValue(bucket.total) });
  show(event, {
    title: daily ? bucket.start : `Week of ${bucket.start}`,
    rows: bucket.total > 0 ? rows : [{ label: "No activity", value: "" }],
  });
}

function onLeave() {
  active.value = null;
  hide();
}

const tickText = (t: number) =>
  chart.value.share
    ? `${Math.round(t * 100)}%`
    : measure.value === "spend"
      ? t >= 1
        ? `${Math.round(t).toLocaleString("en-US")}`
        : formatUsd(t)
      : formatTokenTick(t);
</script>

<template>
  <div class="section-panel mb-4">
    <div class="section-panel-header panel-header-flex">
      <span>Model Mix Over Time</span>
      <ChartModeToggle v-model="measure" :options="MEASURES" label="Measure" />
    </div>
    <div ref="root" class="section-panel-body model-chart-body">
      <div v-if="series.buckets.length < 2" class="chart-placeholder">
        Needs activity on at least 2 {{ series.granularity === "day" ? "days" : "weeks" }} to show a trend.
      </div>
      <template v-else>
        <ModelChartLegend :items="legendItems" />
        <svg
          :width="chart.w"
          :height="HEIGHT"
          :viewBox="`0 0 ${chart.w} ${HEIGHT}`"
          role="img"
          :aria-label="`${measure === 'spend' ? 'Estimated spend' : 'Tokens'} per model per ${series.granularity}`"
          @pointerleave="onLeave"
        >
          <g class="model-chart-grid">
            <line
              v-for="t in chart.ticks"
              :key="t"
              :x1="chart.plot.x"
              :x2="chart.plot.x + chart.plot.w"
              :y1="chart.y(t)"
              :y2="chart.y(t)"
            />
          </g>
          <g class="model-chart-axis-text">
            <text
              v-for="t in chart.ticks"
              :key="`l${t}`"
              :x="chart.plot.x - 8"
              :y="chart.y(t) + 3.5"
              text-anchor="end"
            >{{ tickText(t) }}</text>
            <text
              v-for="l in chart.xLabels"
              :key="`x${l.x}`"
              :x="l.x"
              :y="chart.plot.y + chart.plot.h + 17"
              text-anchor="middle"
            >{{ l.text }}</text>
          </g>
          <g
            v-for="col in chart.columns"
            :key="col.b.start"
            data-reveal="grow-y"
            :style="{ animationDelay: `${col.i * 12}ms` }"
            :class="{ 'mix-column-dim': active != null && active !== col.i }"
            class="mix-column"
          >
            <rect
              v-for="seg in col.segments"
              :key="seg.key"
              :x="col.x"
              :y="seg.y"
              :width="chart.barW"
              :height="seg.h"
              :rx="seg.h > 6 && chart.barW > 6 ? 2 : 0"
              :fill="colorOf(seg.key)"
            />
          </g>
          <rect
            v-for="col in chart.columns"
            :key="`hit-${col.b.start}`"
            :x="col.slotX"
            :y="chart.plot.y"
            :width="chart.slot"
            :height="chart.plot.h"
            fill="transparent"
            @pointermove="onColumn($event, col.i)"
          />
        </svg>
        <p class="model-chart-footnote">
          {{ series.granularity === "day" ? "Daily" : "Weekly (Monday start)" }} totals for the selected range.
          <template v-if="measure === 'spend'"> Spend spreads each model's cost over its days by tokens, counting AI Credits at $0.01 and Claude Code's USD estimate.</template>
        </p>
      </template>
    </div>
    <ModelChartTooltip :tooltip="tooltip" />
  </div>
</template>
