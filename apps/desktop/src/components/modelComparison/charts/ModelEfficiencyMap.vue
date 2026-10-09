<script setup lang="ts">
import { computed, ref } from "vue";
import {
  decadeDomain,
  formatRate,
  formatTokenTick,
  linearScale,
  logScale,
  modelProfile,
  niceLinearTicks,
  PROFILE_MIN_SHARE,
  placeLabels,
  profileTooltip,
} from "@/composables/modelComparison/charts";
import { useModelChartTooltip } from "@/composables/modelComparison/useModelChartTooltip";
import { useElementWidth } from "@/composables/useElementWidth";
import { useModelComparisonContext } from "@/composables/useModelComparison";
import { MODEL_TAIL_COLOR } from "@/utils/chartColors";
import ModelChartLegend from "./ModelChartLegend.vue";
import ModelChartTooltip from "./ModelChartTooltip.vue";

const ctx = useModelComparisonContext();
const root = ref<HTMLElement | null>(null);
const width = useElementWidth(root, 520);
const { tooltip, show, hide } = useModelChartTooltip();

const HEIGHT = 300;
const PAD = { left: 46, right: 14, top: 12, bottom: 34 };

const isPriced = (row: (typeof ctx.modelRows)[number]) =>
  (row.usdEquivalent ?? 0) > 0 && row.tokens > 0;
// Models with a sliver of use (a handful of requests) would stretch the
// volume axis across empty decades and crowd out the models that matter.
const priced = computed(() =>
  ctx.modelRows
    .filter((row) => isPriced(row) && row.percentage >= PROFILE_MIN_SHARE)
    .map(modelProfile)
    .sort((a, b) => b.row.tokens - a.row.tokens),
);
const minor = computed(
  () => ctx.modelRows.filter((row) => isPriced(row) && row.percentage < PROFILE_MIN_SHARE).length,
);
const unpriced = computed(() => ctx.modelRows.filter((row) => !isPriced(row)));

const chart = computed(() => {
  const w = Math.max(width.value, 280);
  const plot = {
    x: PAD.left,
    y: PAD.top,
    w: w - PAD.left - PAD.right,
    h: HEIGHT - PAD.top - PAD.bottom,
  };
  const profiles = priced.value;
  const [t0, t1] = decadeDomain(profiles.map((p) => p.row.tokens));
  const x = logScale([t0, t1], [plot.x, plot.x + plot.w]);
  const { max: rateMax, ticks: rateTicks } = niceLinearTicks(
    Math.max(...profiles.map((p) => p.rate ?? 0)) * 1.08,
    5,
  );
  const y = linearScale([0, rateMax], [plot.y + plot.h, plot.y]);
  const xTicks: number[] = [];
  for (let v = t0; v <= t1 * 1.0001; v *= 10) xTicks.push(v);
  // Show every other decade when the axis is crowded.
  const xStride = xTicks.length > 6 && plot.w < 520 ? 2 : 1;

  const totalTokens = profiles.reduce((s, p) => s + p.row.tokens, 0);
  const totalSpend = profiles.reduce((s, p) => s + (p.row.usdEquivalent ?? 0), 0);
  const average = totalTokens > 0 ? (totalSpend / totalTokens) * 1e6 : 0;

  // Bubble area tracks spend; the largest bubble scales with the panel.
  const maxSpend = Math.max(...profiles.map((p) => p.row.usdEquivalent ?? 0), 1e-9);
  const rMax = Math.min(22, Math.max(12, plot.w / 28));
  const marks = profiles.map((p) => ({
    profile: p,
    x: x(p.row.tokens),
    y: y(p.rate ?? 0),
    r: 3.5 + (rMax - 3.5) * Math.sqrt((p.row.usdEquivalent ?? 0) / maxSpend),
    named: p.row.color !== MODEL_TAIL_COLOR,
  }));
  // Smaller bubbles draw last so they stay reachable on top of large ones.
  const drawOrder = [...marks].sort((a, b) => b.r - a.r);
  // Coloured models claim label space first; grey ones take what is left.
  const labelOrder = marks
    .map((m, i) => ({ m, i }))
    .sort(
      (a, b) =>
        Number(b.m.named) - Number(a.m.named) || b.m.profile.row.tokens - a.m.profile.row.tokens,
    )
    .map(({ i }) => i);
  const labels = placeLabels(
    marks.map((m) => ({ x: m.x, y: m.y, r: m.r, text: m.profile.row.label })),
    // Keep labels off the top note and the average line's caption.
    { ...plot, y: plot.y + 16, h: plot.h - 16 },
    {
      order: labelOrder,
      charWidth: 5.9,
      obstacles: [{ x: plot.x, y: y(average) - 17, w: 130, h: 15 }],
    },
  ).map((l) => ({ ...l, text: marks[l.index].profile.row.label, named: marks[l.index].named }));

  return { w, plot, x, y, xTicks, xStride, rateTicks, average, marks, drawOrder, labels };
});

const legendItems = computed(() => {
  const named = priced.value.filter((p) => p.row.color !== MODEL_TAIL_COLOR);
  const items = named.map((p) => ({
    id: p.row.id,
    label: p.row.label,
    color: p.row.color,
    hollow: !p.row.billedInAiCredits,
  }));
  if (priced.value.length > named.length) {
    items.push({ id: "__others", label: "Others", color: MODEL_TAIL_COLOR, hollow: false });
  }
  return items;
});
const footnote = computed(() => {
  const parts = ["Bubble size is total spend."];
  if (priced.value.some((p) => !p.row.billedInAiCredits)) {
    parts.push("Hollow bubbles are Claude Code USD estimates; AI Credits count at $0.01.");
  }
  if (minor.value) {
    parts.push(
      `${minor.value} ${minor.value === 1 ? "model" : "models"} under ${PROFILE_MIN_SHARE}% of tokens not shown.`,
    );
  }
  if (unpriced.value.length) {
    parts.push(`No cost recorded: ${unpriced.value.map((r) => r.label).join(", ")}.`);
  }
  return parts.join(" ");
});

const active = ref<number | null>(null);

function onMove(event: PointerEvent) {
  const svg = event.currentTarget as SVGElement;
  const box = svg.getBoundingClientRect();
  const px = event.clientX - box.left;
  const py = event.clientY - box.top;
  let best: number | null = null;
  let bestDistance = 30 ** 2;
  chart.value.marks.forEach((m, i) => {
    const d = (m.x - px) ** 2 + (m.y - py) ** 2 - m.r ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  active.value = best;
  if (best == null) hide();
  else show(event, profileTooltip(chart.value.marks[best].profile));
}

function onLeave() {
  active.value = null;
  hide();
}

const fill = (color: string, hollow: boolean) =>
  hollow ? `color-mix(in srgb, ${color} 18%, transparent)` : color;
</script>

<template>
  <div class="section-panel">
    <div class="section-panel-header">Cost Efficiency</div>
    <div ref="root" class="section-panel-body model-chart-body">
      <div v-if="priced.length < 2" class="chart-placeholder">
        Needs at least 2 models with a cost to compare.
      </div>
      <template v-else>
        <ModelChartLegend :items="legendItems" />
        <div class="model-chart-canvas">
          <svg
            :width="chart.w"
            :height="HEIGHT"
            :viewBox="`0 0 ${chart.w} ${HEIGHT}`"
            role="img"
            aria-label="Cost per million tokens against tokens used, one bubble per model sized by spend"
            @pointermove="onMove"
            @pointerleave="onLeave"
          >
            <!-- Shade the band above the average rate: models that cost more per token. -->
            <rect
              :x="chart.plot.x"
              :y="chart.plot.y"
              :width="chart.plot.w"
              :height="Math.max(0, chart.y(chart.average) - chart.plot.y)"
              class="efficiency-above"
            />
            <g class="model-chart-grid">
              <line
                v-for="t in chart.rateTicks"
                :key="`y${t}`"
                :x1="chart.plot.x"
                :x2="chart.plot.x + chart.plot.w"
                :y1="chart.y(t)"
                :y2="chart.y(t)"
              />
              <line
                v-for="t in chart.xTicks"
                :key="`x${t}`"
                :x1="chart.x(t)"
                :x2="chart.x(t)"
                :y1="chart.plot.y"
                :y2="chart.plot.y + chart.plot.h"
              />
            </g>
            <g class="model-chart-axis-text">
              <text
                v-for="t in chart.rateTicks"
                :key="`yl${t}`"
                :x="chart.plot.x - 8"
                :y="chart.y(t) + 3.5"
                text-anchor="end"
              >{{ formatRate(t).replace(/0+$/, '').replace(/\.$/, '') }}</text>
              <template v-for="(t, i) in chart.xTicks" :key="`xl${t}`">
                <text
                  v-if="i % chart.xStride === 0"
                  :x="chart.x(t)"
                  :y="chart.plot.y + chart.plot.h + 16"
                  :text-anchor="i === chart.xTicks.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'"
                >{{ formatTokenTick(t) }}</text>
              </template>
            </g>
            <text :x="chart.plot.x + 6" :y="chart.plot.y + 13" class="model-chart-note-text">
              ↑ Costs more per token than your average
            </text>
            <text
              :x="chart.plot.x + chart.plot.w"
              :y="HEIGHT - 2"
              text-anchor="end"
              class="model-chart-note-text"
            >Tokens used (log scale) →</text>
            <text
              :x="12"
              :y="chart.plot.y + chart.plot.h"
              :transform="`rotate(-90 12 ${chart.plot.y + chart.plot.h})`"
              class="model-chart-note-text"
            >$ per 1M tokens →</text>

            <line
              :x1="chart.plot.x"
              :x2="chart.plot.x + chart.plot.w"
              :y1="chart.y(chart.average)"
              :y2="chart.y(chart.average)"
              class="efficiency-average"
            />
            <text
              :x="chart.plot.x + 6"
              :y="chart.y(chart.average) - 5"
              class="efficiency-average-label"
            >Average {{ formatRate(chart.average) }} / 1M</text>

            <circle
              v-for="m in chart.drawOrder"
              :key="m.profile.row.id"
              :cx="m.x"
              :cy="m.y"
              :r="m.r"
              :fill="fill(m.profile.row.color, !m.profile.row.billedInAiCredits)"
              :fill-opacity="m.profile.row.billedInAiCredits ? 0.85 : 1"
              :stroke="m.profile.row.billedInAiCredits ? 'var(--canvas-subtle)' : m.profile.row.color"
              stroke-width="2"
              data-reveal="pop"
            />
            <circle
              v-if="active != null"
              :cx="chart.marks[active].x"
              :cy="chart.marks[active].y"
              :r="chart.marks[active].r + 3"
              class="model-chart-focus-ring"
            />
            <text
              v-for="l in chart.labels"
              :key="`l${l.index}`"
              :x="l.x"
              :y="l.y"
              :text-anchor="l.anchor"
              class="model-chart-label"
              :class="{ muted: !l.named }"
            >{{ l.text }}</text>
          </svg>
        </div>
        <p class="model-chart-footnote">{{ footnote }}</p>
      </template>
    </div>
    <ModelChartTooltip :tooltip="tooltip" />
  </div>
</template>
