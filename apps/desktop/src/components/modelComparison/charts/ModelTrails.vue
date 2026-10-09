<script setup lang="ts">
import { computed, ref } from "vue";
import {
  formatTokenTick,
  logScale,
  logTicks,
  type ModelProfile,
  niceLogDomain,
  profileTooltip,
  spreadLabels,
} from "@/composables/modelComparison/charts";
import { useModelChartTooltip } from "@/composables/modelComparison/useModelChartTooltip";
import { useElementWidth } from "@/composables/useElementWidth";
import { MODEL_TAIL_COLOR } from "@/utils/chartColors";
import ModelChartLegend from "./ModelChartLegend.vue";
import ModelChartTooltip from "./ModelChartTooltip.vue";

const props = defineProps<{ profiles: ModelProfile[] }>();

const root = ref<HTMLElement | null>(null);
const width = useElementWidth(root, 1000);
const { tooltip, show, hide } = useModelChartTooltip();

const HEIGHT = 340;
const TOP = 34;
const BOTTOM = 40;
/** Gap below each axis where models without a value sit. */
const NA_OFFSET = 22;

interface TrailAxis {
  label: string;
  value: (p: ModelProfile) => number | null;
  domain: [number, number];
  ticks: number[];
  format: (v: number) => string;
}

const percent = (v: number) => `${+(v * 100).toFixed(v < 0.01 ? 1 : 0)}%`;

const axes = computed<TrailAxis[]>(() => {
  const ps = props.profiles;
  const logAxis = (
    label: string,
    value: (p: ModelProfile) => number | null,
    format: (v: number) => string,
  ): TrailAxis => {
    const domain = niceLogDomain(ps.map(value).filter((v): v is number => v != null && v > 0));
    return { label, value, domain, ticks: logTicks(domain, 5), format };
  };
  // Cache hit runs on a log scale of the miss rate, so 90%, 97% and 99%
  // spread apart instead of piling up at the top of a 0–100% axis.
  const miss = (p: ModelProfile) =>
    p.cacheHit == null || p.cacheHit <= 0 ? null : Math.max(1 - p.cacheHit, 0.001);
  const missLow = niceLogDomain(ps.map(miss).filter((v): v is number => v != null))[0];
  const missDomain: [number, number] = [1, Math.min(missLow, 0.1)];
  return [
    logAxis("Tokens", (p) => p.row.tokens || null, formatTokenTick),
    logAxis("Requests", (p) => p.row.requestCount || null, formatTokenTick),
    logAxis("Context / request", (p) => p.contextPerRequest, formatTokenTick),
    {
      label: "Cache hit",
      value: miss,
      domain: missDomain,
      ticks: logTicks(missDomain, 5),
      format: (v) => `${+((1 - v) * 100).toFixed(1)}%`,
    },
    logAxis("Output share", (p) => p.outputShare, percent),
    logAxis(
      "$ per 1M tokens",
      (p) => p.rate,
      (v) => `$${v}`,
    ),
  ];
});

const chart = computed(() => {
  const w = Math.max(width.value, 480);
  const labelled = w >= 760;
  const left = 40;
  const right = labelled ? 150 : 16;
  const bottom = HEIGHT - BOTTOM;
  const list = axes.value;
  const xs = list.map((_, i) => left + (i * (w - left - right)) / (list.length - 1));
  // A domain written high-to-low (cache miss) puts its first value at the bottom.
  const scales = list.map((a) => logScale(a.domain, [bottom, TOP]));
  const yOf = (p: ModelProfile, i: number) => {
    const v = list[i].value(p);
    return v == null || v <= 0 ? bottom + NA_OFFSET : scales[i](v);
  };
  const lines = props.profiles.map((p) => {
    let d = "";
    xs.forEach((x, i) => {
      const y = yOf(p, i);
      if (i === 0) d = `M${x},${y}`;
      else {
        const px = xs[i - 1];
        const py = yOf(p, i - 1);
        const mx = (px + x) / 2;
        d += ` C${mx},${py} ${mx},${y} ${x},${y}`;
      }
    });
    return {
      p,
      d,
      named: p.row.color !== MODEL_TAIL_COLOR,
      points: xs.map((x, i) => ({ x, y: yOf(p, i) })),
    };
  });
  const last = xs.length - 1;
  const named = lines.filter((l) => l.named);
  const endY = spreadLabels(
    named.map((l) => l.points[last].y),
    14,
    TOP - 4,
  );
  const endLabels = named.map((l, i) => ({ l, y: endY[i] }));
  return { w, xs, scales, bottom, lines, labelled, endLabels, last };
});

const highlight = ref<string | null>(null);
const isDim = (id: string, named: boolean) => {
  const h = highlight.value;
  if (h == null) return false;
  if (h === "__others") return named;
  return h !== id;
};

const legendItems = computed(() => {
  const named = props.profiles.filter((p) => p.row.color !== MODEL_TAIL_COLOR);
  const items = named.map((p) => ({
    id: p.row.id,
    label: p.row.label,
    color: p.row.color,
    hollow: !p.row.billedInAiCredits,
  }));
  const rest = props.profiles.length - named.length;
  if (rest > 0)
    items.push({ id: "__others", label: `${rest} others`, color: MODEL_TAIL_COLOR, hollow: false });
  return items;
});

function onLine(event: PointerEvent, p: ModelProfile) {
  highlight.value = p.row.id;
  show(event, profileTooltip(p));
}
function onLeave() {
  highlight.value = null;
  hide();
}
const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
</script>

<template>
  <div ref="root" class="model-trails">
    <ModelChartLegend :items="legendItems" interactive @highlight="highlight = $event" />
    <svg
      :width="chart.w"
      :height="HEIGHT"
      :viewBox="`0 0 ${chart.w} ${HEIGHT}`"
      role="img"
      aria-label="Each model as a line across tokens, requests, context per request, cache hit, output share and cost per token"
    >
      <g v-for="(axis, i) in axes" :key="axis.label">
        <line :x1="chart.xs[i]" :x2="chart.xs[i]" :y1="TOP" :y2="chart.bottom" class="model-chart-axis-line" />
        <text :x="chart.xs[i]" :y="TOP - 16" text-anchor="middle" class="model-chart-heading-text">{{ axis.label }}</text>
        <line
          v-for="t in axis.ticks"
          :key="t"
          :x1="chart.xs[i] - 3"
          :x2="chart.xs[i]"
          :y1="chart.scales[i](t)"
          :y2="chart.scales[i](t)"
          class="model-chart-axis-line"
        />
      </g>
      <g data-reveal="wipe">
        <g
          v-for="line in [...chart.lines].reverse()"
          :key="line.p.row.id"
          class="trail"
          :class="{ dimmed: isDim(line.p.row.id, line.named), named: line.named }"
        >
          <path
            :d="line.d"
            fill="none"
            :stroke="line.p.row.color"
            :stroke-width="line.named ? 2.25 : 1.25"
            :stroke-opacity="line.named ? 1 : 0.5"
          />
          <template v-if="line.named">
            <circle
              v-for="(pt, i) in line.points"
              :key="i"
              :cx="pt.x"
              :cy="pt.y"
              r="3.5"
              :fill="line.p.row.billedInAiCredits ? line.p.row.color : 'var(--canvas-subtle)'"
              :stroke="line.p.row.billedInAiCredits ? 'var(--canvas-subtle)' : line.p.row.color"
              :stroke-width="line.p.row.billedInAiCredits ? 1.5 : 2"
            />
          </template>
          <path
            :d="line.d"
            fill="none"
            stroke="transparent"
            stroke-width="10"
            class="trail-hit"
            @pointermove="onLine($event, line.p)"
            @pointerleave="onLeave"
          />
        </g>
      </g>
      <!-- Tick text sits above the lines, haloed so it stays readable. -->
      <g class="model-chart-axis-text haloed">
        <template v-for="(axis, i) in axes" :key="`ticks-${axis.label}`">
          <text
            v-for="t in axis.ticks"
            :key="t"
            :x="chart.xs[i] - 6"
            :y="chart.scales[i](t) + 3.5"
            text-anchor="end"
          >{{ axis.format(t) }}</text>
          <text :x="chart.xs[i] - 6" :y="chart.bottom + NA_OFFSET + 3.5" text-anchor="end">n/a</text>
        </template>
      </g>
      <template v-if="chart.labelled">
        <g
          v-for="label in chart.endLabels"
          :key="`end-${label.l.p.row.id}`"
          :class="{ dimmed: isDim(label.l.p.row.id, true) }"
          class="trail-end"
        >
          <path
            :d="`M${chart.xs[chart.last] + 6},${label.l.points[chart.last].y} L${chart.xs[chart.last] + 16},${label.y}`"
            class="model-chart-axis-line"
            fill="none"
          />
          <text :x="chart.xs[chart.last] + 20" :y="label.y + 3.5" class="model-chart-label">
            {{ truncate(label.l.p.row.label, 22) }}
          </text>
        </g>
      </template>
    </svg>
    <ModelChartTooltip :tooltip="tooltip" />
  </div>
</template>
