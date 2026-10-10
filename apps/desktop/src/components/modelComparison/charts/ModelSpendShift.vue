<script setup lang="ts">
import { computed, ref } from "vue";
import {
  buildShareShift,
  formatShare,
  formatTokens,
  formatUsd,
  type ShareShiftGroup,
  spreadLabels,
} from "@/composables/modelComparison/charts";
import { useModelChartTooltip } from "@/composables/modelComparison/useModelChartTooltip";
import { useElementWidth } from "@/composables/useElementWidth";
import { useModelComparisonContext } from "@/composables/useModelComparison";
import { MODEL_TAIL_COLOR } from "@/utils/chartColors";
import ModelChartTooltip from "./ModelChartTooltip.vue";

const ctx = useModelComparisonContext();
const root = ref<HTMLElement | null>(null);
const width = useElementWidth(root, 520);
const { tooltip, show, hide } = useModelChartTooltip();

/** Models named on their own; the rest share one "others" band. */
const NAMED = 6;
const HEIGHT = 300;
const TOP = 26;
const BAR = 16;
const GAP = 2;
const LABEL_GAP = 13;

const groups = computed(() => buildShareShift(ctx.modelRows, NAMED, MODEL_TAIL_COLOR));

const chart = computed(() => {
  const w = Math.max(width.value, 300);
  const narrow = w < 460;
  const side = narrow ? 64 : Math.min(170, w * 0.32);
  const xL = side;
  const xR = w - side - BAR;
  const mid = (xL + BAR + xR) / 2;
  const list = groups.value;
  const usable = HEIGHT - TOP - 4 - GAP * Math.max(0, list.length - 1);
  let yl = TOP;
  let yr = TOP;
  const bands = list.map((g) => {
    const hl = g.tokenShare * usable;
    const hr = g.spendShare * usable;
    const band = { g, l0: yl, l1: yl + hl, r0: yr, r1: yr + hr };
    yl += hl + GAP;
    yr += hr + GAP;
    return band;
  });
  const leftY = spreadLabels(
    bands.map((b) => (b.l0 + b.l1) / 2),
    LABEL_GAP,
    TOP + 4,
  );
  const rightY = spreadLabels(
    bands.map((b) => (b.r0 + b.r1) / 2),
    LABEL_GAP,
    TOP + 4,
  );
  const ribbon = (b: (typeof bands)[number]) =>
    `M${xL + BAR},${b.l0} C${mid},${b.l0} ${mid},${b.r0} ${xR},${b.r0}` +
    ` L${xR},${b.r1} C${mid},${b.r1} ${mid},${b.l1} ${xL + BAR},${b.l1} Z`;
  return { w, narrow, xL, xR, bands, leftY, rightY, ribbon };
});

const active = ref<string | null>(null);

function onEnter(event: PointerEvent, g: ShareShiftGroup) {
  active.value = g.id;
  const ratio = g.tokenShare > 0 ? g.spendShare / g.tokenShare : 0;
  const rows = [
    { label: "Share of tokens", value: `${formatShare(g.tokenShare)} · ${formatTokens(g.tokens)}` },
    { label: "Share of spend", value: `${formatShare(g.spendShare)} · ${formatUsd(g.spend)}` },
    { label: "Spend per token", value: `${ratio.toFixed(2)}× the average` },
  ];
  if (g.members) {
    const names = g.members.map((m) => m.label);
    rows.push({
      label: "Includes",
      value: names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4}` : ""),
    });
  }
  show(event, { title: g.label, color: g.color, hollow: g.usdEstimate, rows });
}

function onLeave() {
  active.value = null;
  hide();
}

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
const delta = (g: ShareShiftGroup) => Math.round((g.spendShare - g.tokenShare) * 100);
</script>

<template>
  <div class="section-panel">
    <div class="section-panel-header">Token Share vs Spend Share</div>
    <div ref="root" class="section-panel-body model-chart-body">
      <div v-if="groups.length < 2" class="chart-placeholder">
        Needs at least 2 models with a cost to compare.
      </div>
      <template v-else>
        <p class="model-chart-caption">
          A band that widens costs more than its share of use; one that narrows costs less.
        </p>
        <svg
          :width="chart.w"
          :height="HEIGHT"
          :viewBox="`0 0 ${chart.w} ${HEIGHT}`"
          role="img"
          aria-label="Each model's share of tokens beside its share of spend"
        >
          <text :x="chart.xL + BAR / 2" y="12" text-anchor="middle" class="model-chart-heading-text">Tokens</text>
          <text :x="chart.xR + BAR / 2" y="12" text-anchor="middle" class="model-chart-heading-text">Spend</text>
          <g
            v-for="(b, i) in chart.bands"
            :key="b.g.id"
            class="share-shift-band"
            :class="{ dimmed: active != null && active !== b.g.id }"
            @pointermove="onEnter($event, b.g)"
            @pointerleave="onLeave"
          >
            <path :d="chart.ribbon(b)" :fill="b.g.color" class="share-shift-ribbon" />
            <rect
              :x="chart.xL"
              :y="b.l0"
              :width="BAR"
              :height="Math.max(1, b.l1 - b.l0)"
              rx="3"
              :fill="b.g.color"
              data-reveal="grow-y"
            />
            <rect
              :x="chart.xR"
              :y="b.r0"
              :width="BAR"
              :height="Math.max(1, b.r1 - b.r0)"
              rx="3"
              :fill="b.g.usdEstimate ? `color-mix(in srgb, ${b.g.color} 22%, transparent)` : b.g.color"
              :stroke="b.g.usdEstimate ? b.g.color : 'none'"
              :stroke-width="b.g.usdEstimate ? 2 : 0"
              data-reveal="grow-y"
            />
            <text
              :x="chart.xL - 8"
              :y="chart.leftY[i] + 4"
              text-anchor="end"
              class="model-chart-label"
            >
              <tspan v-if="!chart.narrow">{{ truncate(b.g.label, 22) }}&nbsp;&nbsp;</tspan>
              <tspan class="share-shift-value">{{ formatShare(b.g.tokenShare, 0) }}</tspan>
            </text>
            <text :x="chart.xR + BAR + 8" :y="chart.rightY[i] + 4" class="model-chart-label">
              <tspan class="share-shift-value">{{ formatShare(b.g.spendShare, 0) }}</tspan>
              <tspan v-if="delta(b.g) !== 0" dx="6" class="share-shift-delta">
                {{ delta(b.g) > 0 ? "+" : "−" }}{{ Math.abs(delta(b.g)) }} pts
              </tspan>
            </text>
          </g>
        </svg>
        <p class="model-chart-footnote">
          Spend counts AI Credits at $0.01 and Claude Code's USD estimate (hollow). Unpriced models are left out of both bars.
        </p>
      </template>
    </div>
    <ModelChartTooltip :tooltip="tooltip" />
  </div>
</template>
