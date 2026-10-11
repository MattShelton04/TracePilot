<script setup lang="ts">
/**
 * A day-by-day chart for the Analytics dashboard: stacked bars or stacked
 * lines over zero-filled days. Columns, lines, pins, guides and axis ticks
 * share one coordinate space (percent of the plot), so a pin sits over the
 * column it belongs to. Column count, tick density and pin merging follow
 * the measured width; past one column per few pixels, days merge into bins.
 *
 * New results morph from the old ones: bars scale from their previous
 * height (days not shown before grow from the baseline) and lines move to
 * their new shape, matched by series. A resize redraws without motion.
 */
import { Tooltip } from "@tracepilot/ui";
import { OctagonX, TriangleAlert } from "lucide-vue-next";
import { computed, onBeforeUnmount, onBeforeUpdate, onUpdated, ref, watch } from "vue";
import { motionAllowed } from "@/composables/useFirstReveal";
import {
  binRows,
  type DayRow,
  type DaySeries,
  errorPins,
  tickIndices,
} from "@/utils/analyticsDashboard";
import { columnCentre, easeOutCubic, resample, sampleAt } from "@/utils/chartMorph";
import { niceTicks } from "@/utils/niceTicks";

const props = withDefaults(
  defineProps<{
    series: DaySeries[];
    rows: DayRow[];
    mode?: "bars" | "lines";
    format: (value: number) => string;
    /** Axis labels, when they want a shorter form than the readout. */
    axisFormat?: (value: number) => string;
    /** Names the chart for screen readers. */
    label: string;
    /** Pin errors and rate limits over their columns. */
    pins?: boolean;
    /** Whole-number axis, for counts. */
    integer?: boolean;
    height?: number;
    /** Values are running totals: a merged column keeps its last value. */
    cumulative?: boolean;
    /** Extra lines for a column's readout, e.g. its runs. */
    detail?: (row: DayRow) => string[];
  }>(),
  {
    mode: "bars",
    pins: false,
    integer: false,
    height: 180,
    detail: undefined,
    axisFormat: undefined,
    cumulative: false,
  },
);

const MIN_BAR_PX = { bars: 6, lines: 3 } as const;
const PIN_GAP_PX = 26;

const plotEl = ref<HTMLElement | null>(null);
const width = ref(0);
let observer: ResizeObserver | null = null;
watch(plotEl, (el) => {
  observer?.disconnect();
  if (!el) return;
  width.value = el.clientWidth;
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(() => {
    width.value = el.clientWidth;
  });
  observer.observe(el);
});
onBeforeUnmount(() => observer?.disconnect());

const columns = computed(() =>
  binRows(props.rows, width.value ? width.value / MIN_BAR_PX[props.mode] : 120, props.cumulative),
);
const binned = computed(() => columns.value.some((row) => row.from !== row.to));
const totals = computed(() => columns.value.map((row) => row.values.reduce((a, b) => a + b, 0)));
const axis = computed(() =>
  niceTicks(Math.max(0, ...totals.value), {
    integer: props.integer,
    targetSegments: 2,
    maxSegments: 4,
  }),
);
const empty = computed(() => totals.value.every((total) => total === 0));
// One point cannot draw a line; it reads as a bar.
const shownMode = computed(() => (columns.value.length < 2 ? "bars" : props.mode));
const narrow = computed(() => columns.value.length < 12);

const pct = (value: number) => (axis.value.max > 0 ? (value / axis.value.max) * 100 : 0);
const centre = (i: number) => ((i + 0.5) / columns.value.length) * 100;

/** Each series' top edge per column, stacked, in percent of the plot height. */
const levels = computed(() => {
  if (shownMode.value !== "lines") return new Map<string, number[]>();
  const running = columns.value.map(() => 0);
  return new Map(
    props.series.map((series, j) => {
      columns.value.forEach((row, i) => {
        running[i] += row.values[j];
      });
      return [series.key, running.map(pct)] as const;
    }),
  );
});

// Lines are drawn from `shown`, which follows `levels`. New results tween
// from what was on screen, read at each new column's position, so a change
// of range morphs too; a resize re-bins the same rows and redraws at once.
const MORPH_MS = 450;
const shown = ref(new Map<string, number[]>());
let lineFrame = 0;
let drawnRows = props.rows;
let drawnSeries = props.series;
watch(
  levels,
  (next) => {
    cancelAnimationFrame(lineFrame);
    const changed = props.rows !== drawnRows || props.series !== drawnSeries;
    drawnRows = props.rows;
    drawnSeries = props.series;
    const from = shown.value;
    if (!changed || from.size === 0 || next.size === 0 || !motionAllowed()) {
      shown.value = next;
      return;
    }
    // A series still on the chart starts where it was. One new to it (a
    // new metric or source) starts as its share of the old total.
    const count = columns.value.length;
    const zero = new Array<number>(count).fill(0);
    const oldTotal = resample([...from.values()].at(-1) ?? [], count);
    const newTotal = [...next.values()].at(-1) ?? zero;
    const start = new Map<string, number[]>();
    for (const [key, tops] of next) {
      const old = from.get(key);
      start.set(
        key,
        old
          ? resample(old, count)
          : tops.map((v, i) => (newTotal[i] > 0 ? (oldTotal[i] * v) / newTotal[i] : 0)),
      );
    }
    const frameAt = (t: number) =>
      new Map(
        [...next].map(([key, tops]) => {
          const a = start.get(key) ?? zero;
          return [key, tops.map((v, i) => a[i] + (v - a[i]) * easeOutCubic(t))];
        }),
      );
    shown.value = frameAt(0);
    const began = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - began) / MORPH_MS));
      shown.value = t < 1 ? frameAt(t) : next;
      if (t < 1) lineFrame = requestAnimationFrame(tick);
    };
    lineFrame = requestAnimationFrame(tick);
  },
  { immediate: true },
);
onBeforeUnmount(() => cancelAnimationFrame(lineFrame));

/** Each stacked series as SVG points in a 100×100 box. */
const lineBands = computed(() => {
  let lower = columns.value.map(() => 0);
  return props.series.flatMap((series) => {
    const tops = shown.value.get(series.key);
    if (!tops || tops.length !== columns.value.length) return [];
    const upper = tops.map((value, i) => `${centre(i)},${100 - value}`);
    const base = lower.map((value, i) => `${centre(i)},${100 - value}`);
    lower = tops;
    return [
      {
        ...series,
        line: upper.join(" "),
        area: `${upper.join(" ")} ${[...base].reverse().join(" ")}`,
        tops: levels.value.get(series.key) ?? tops,
      },
    ];
  });
});

// Bars: before the DOM changes for new results, note the height drawn at
// each column's position; after it, scale each bar from the height that was
// at its own position (FLIP, transform only). Switching between bars and
// lines grows the new chart from the baseline.
let drawnBars: [number, number][] = [];
let morphing = false;
let modeBefore = shownMode.value;
watch(
  () => [props.rows, props.series, props.mode],
  () => {
    morphing = true;
  },
  { flush: "pre" },
);
onBeforeUpdate(() => {
  const plot = plotEl.value;
  if (!morphing || !plot) return;
  const box = plot.getBoundingClientRect();
  drawnBars = [...plot.querySelectorAll<HTMLElement>(".day-chart__col")].map((col) => {
    const rect = col.getBoundingClientRect();
    const bar = col.querySelector(".day-chart__stack")?.getBoundingClientRect();
    return [((rect.left + rect.width / 2 - box.left) / box.width) * 100, bar?.height ?? 0];
  });
});
onUpdated(() => {
  const plot = plotEl.value;
  if (!morphing || !plot) return;
  morphing = false;
  const regrow = modeBefore !== shownMode.value;
  modeBefore = shownMode.value;
  const before = regrow ? [] : drawnBars;
  drawnBars = [];
  if (!motionAllowed()) return;
  const moves: [HTMLElement | SVGElement, number][] = [];
  if (shownMode.value === "bars") {
    const count = columns.value.length;
    plot.querySelectorAll<HTMLElement>(".day-chart__col").forEach((col, i) => {
      const bar = col.querySelector<HTMLElement>(".day-chart__stack");
      const height = bar?.offsetHeight ?? 0;
      const from = sampleAt(before, columnCentre(i, count));
      if (bar && height > 0 && Math.abs(from - height) > 0.5) moves.push([bar, from / height]);
    });
  } else if (regrow) {
    const svg = plot.querySelector<SVGElement>(".day-chart__lines");
    if (svg) moves.push([svg, 0]);
  }
  for (const [el, scale] of moves) {
    el.style.transition = "none";
    el.style.transform = `scaleY(${scale})`;
  }
  void plot.offsetHeight;
  for (const [el] of moves) {
    el.style.transition = `transform ${MORPH_MS}ms var(--ease-out)`;
    el.style.transform = "";
    el.addEventListener("transitionend", () => el.style.removeProperty("transition"), {
      once: true,
    });
  }
});

const yearSpan = computed(() => {
  const first = props.rows[0]?.from;
  const last = props.rows.at(-1)?.to;
  return first && last ? Date.parse(last) - Date.parse(first) > 300 * 86_400_000 : false;
});
function dayLabel(iso: string, withYear = false): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: withYear ? undefined : "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}
function spanLabel(row: DayRow): string {
  const weekday = new Date(`${row.from}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  return row.from === row.to
    ? `${weekday} ${dayLabel(row.from)}`
    : `${dayLabel(row.from)} – ${dayLabel(row.to)}`;
}

const ticks = computed(() => {
  const count = columns.value.length;
  return tickIndices(count, width.value || 600, yearSpan.value ? 96 : 84).map((i) => {
    const left = count === 1 ? 50 : centre(i);
    return {
      i,
      left,
      align: count === 1 ? "middle" : left < 5 ? "start" : left > 95 ? "end" : "middle",
      label:
        count === 1 ? spanLabel(columns.value[0]) : dayLabel(columns.value[i].from, yearSpan.value),
    };
  });
});

const pins = computed(() =>
  props.pins && width.value ? errorPins(columns.value, (PIN_GAP_PX / width.value) * 100) : [],
);
function pinText(pin: { errors: number; rateLimits: number; columns: number[] }): string {
  const days = pin.columns.slice(0, 5).map((i) => {
    const row = columns.value[i];
    const parts = [
      row.errors ? `${row.errors} error${row.errors === 1 ? "" : "s"}` : "",
      row.rateLimits ? `${row.rateLimits} rate limit${row.rateLimits === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    return `${spanLabel(row)}: ${parts.join(", ")}`;
  });
  const more = pin.columns.length - days.length;
  return more > 0 ? `${days.join("; ")}; +${more} more` : days.join("; ");
}

// Hover and keyboard share one active column.
const active = ref<number | null>(null);
function onMove(event: MouseEvent) {
  const el = plotEl.value;
  if (!el || columns.value.length === 0) return;
  const box = el.getBoundingClientRect();
  const i = Math.floor(((event.clientX - box.left) / box.width) * columns.value.length);
  active.value = Math.min(columns.value.length - 1, Math.max(0, i));
}
function onKey(event: KeyboardEvent) {
  const last = columns.value.length - 1;
  if (last < 0) return;
  const current = active.value ?? -1;
  const next =
    event.key === "ArrowRight"
      ? Math.min(last, current + 1)
      : event.key === "ArrowLeft"
        ? Math.max(0, current < 0 ? last : current - 1)
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? last
            : null;
  if (next == null) return;
  event.preventDefault();
  active.value = next;
}
watch(columns, () => {
  active.value = null;
});

const readout = computed(() => {
  const i = active.value;
  if (i == null || !columns.value[i]) return null;
  const row = columns.value[i];
  const total = totals.value[i];
  const parts = props.series
    .map((series, j) => ({ ...series, value: row.values[j] }))
    .filter((part) => part.value > 0);
  const left = centre(i);
  return {
    title: spanLabel(row),
    parts,
    total: props.series.length > 1 && parts.length > 1 ? props.format(total) : null,
    empty: total === 0,
    detail: props.detail?.(row) ?? [],
    // Keep the box inside the plot: anchor right of the cursor, then flip.
    style: left > 60 ? { right: `${100 - left}%` } : { left: `${left}%` },
    guide: left,
    dots:
      shownMode.value === "lines"
        ? lineBands.value
            .filter((_, j) => row.values[j] > 0)
            .map((band) => ({ key: band.key, color: band.color, top: 100 - pct(band.tops[i]) }))
        : [],
  };
});
</script>

<template>
  <div class="day-chart" :class="{ 'day-chart--pins': pins.length || props.pins }">
    <div v-if="props.pins" class="day-chart__pins">
      <span
        v-for="pin in pins"
        :key="`${pin.columns[0]}-${pin.columns.length}`"
        class="day-chart__pin-wrap"
        :style="{ left: `${pin.pct}%` }"
      >
        <Tooltip :text="pinText(pin)">
          <span
            class="day-chart__pin"
            :class="pin.errors ? 'day-chart__pin--error' : 'day-chart__pin--rate'"
            tabindex="0"
            :aria-label="pinText(pin)"
            data-reveal="pop"
          >
            <OctagonX v-if="pin.errors" :size="10" :stroke-width="2.5" aria-hidden="true" />
            <TriangleAlert v-else :size="10" :stroke-width="2.5" aria-hidden="true" />
            <span v-if="pin.errors + pin.rateLimits > 1" class="day-chart__pin-count">
              {{ pin.errors + pin.rateLimits }}
            </span>
          </span>
        </Tooltip>
      </span>
    </div>

    <div
      ref="plotEl"
      class="day-chart__plot"
      :style="{ height: `${height}px` }"
      role="img"
      :aria-label="label"
      tabindex="0"
      @mousemove="onMove"
      @mouseleave="active = null"
      @keydown="onKey"
      @blur="active = null"
    >
      <template v-if="!empty">
        <div
          v-for="tick in axis.ticks.slice(1)"
          :key="tick"
          class="day-chart__grid"
          :style="{ bottom: `${pct(tick)}%` }"
        >
          <span class="day-chart__ylabel">{{ (axisFormat ?? format)(tick) }}</span>
        </div>
        <span
          v-for="pin in pins"
          :key="`guide-${pin.columns[0]}`"
          class="day-chart__guide day-chart__guide--pin"
          :style="{ left: `${pin.pct}%` }"
          aria-hidden="true"
        />

        <template v-if="shownMode === 'bars'">
          <div
            v-for="(row, i) in columns"
            :key="row.from"
            class="day-chart__col"
            :class="{ 'day-chart__col--active': active === i }"
            :style="{ left: `${(i / columns.length) * 100}%`, width: `${100 / columns.length}%` }"
          >
            <div
              v-if="totals[i] > 0"
              class="day-chart__stack"
              :class="{ 'day-chart__stack--narrow': narrow }"
              :style="{ height: `max(2px, ${pct(totals[i])}%)` }"
              data-reveal="grow-y"
            >
              <i
                v-for="(series, j) in props.series"
                v-show="row.values[j] > 0"
                :key="series.key"
                :style="{ flexGrow: row.values[j], background: series.color }"
              />
            </div>
            <div v-else class="day-chart__zero" :class="{ 'day-chart__stack--narrow': narrow }" />
          </div>
        </template>

        <svg
          v-else
          class="day-chart__lines"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          data-reveal="grow-y"
        >
          <polygon
            v-for="band in lineBands"
            :key="`area-${band.key}`"
            :points="band.area"
            :fill="band.color"
            class="day-chart__area"
          />
          <!-- Bottom series last: where an upper one adds nothing, the lines coincide. -->
          <polyline
            v-for="band in [...lineBands].reverse()"
            :key="`line-${band.key}`"
            :points="band.line"
            :stroke="band.color"
            class="day-chart__line"
          />
        </svg>

        <template v-if="readout">
          <span v-if="shownMode === 'lines'" class="day-chart__guide" :style="{ left: `${readout.guide}%` }" />
          <span
            v-for="dot in readout.dots"
            :key="dot.key"
            class="day-chart__dot"
            :style="{ left: `${readout.guide}%`, top: `${dot.top}%`, background: dot.color }"
          />
          <div class="day-chart__readout" :style="readout.style" role="status">
            <b>{{ readout.title }}</b>
            <span v-if="readout.empty" class="day-chart__readout-muted">No activity</span>
            <span v-for="part in readout.parts" :key="part.key" class="day-chart__readout-row">
              <i :style="{ background: part.color }" />{{ part.label }}<em>{{ format(part.value) }}</em>
            </span>
            <span v-if="readout.total" class="day-chart__readout-row day-chart__readout-total">
              Total<em>{{ readout.total }}</em>
            </span>
            <span v-for="line in readout.detail" :key="line" class="day-chart__readout-muted">{{ line }}</span>
          </div>
        </template>
      </template>
      <slot v-else name="empty">
        <p class="day-chart__empty">Nothing to chart in this range.</p>
      </slot>
    </div>

    <div class="day-chart__axis" aria-hidden="true">
      <span
        v-for="tick in empty ? [] : ticks"
        :key="tick.i"
        class="day-chart__tick"
        :class="`day-chart__tick--${tick.align}`"
        :style="{ left: tick.align === 'start' ? '0' : tick.align === 'end' ? '100%' : `${tick.left}%` }"
      >{{ tick.label }}</span>
    </div>
    <p v-if="binned && !empty" class="sr-only">Each column covers several days.</p>
  </div>
</template>

<style scoped>
.day-chart {
  position: relative;
  padding-left: 48px;
  min-width: 0;
}

.day-chart__pins {
  position: relative;
  height: 22px;
}

.day-chart__pin-wrap {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
}

.day-chart__pin {
  position: relative;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 2px solid var(--canvas-subtle);
  border-radius: 50%;
  color: var(--text-inverse);
}

.day-chart__pin--error {
  background: var(--danger-fg);
}

.day-chart__pin--rate {
  background: var(--warning-fg);
}

.day-chart__pin-count {
  position: absolute;
  top: -6px;
  right: -10px;
  min-width: 14px;
  padding: 0 3px;
  border-radius: var(--radius-full);
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  font: 600 9px/12px var(--font-mono);
  text-align: center;
}

.day-chart__plot {
  position: relative;
  border-bottom: 1px solid var(--border-default);
  outline-offset: 4px;
}

.day-chart__grid {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed var(--border-muted);
  pointer-events: none;
}

.day-chart__ylabel {
  position: absolute;
  right: 100%;
  top: 0;
  margin-right: 8px;
  transform: translateY(-50%);
  font: 10px/12px var(--font-mono);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.day-chart__col {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.day-chart__col--active {
  background: var(--state-hover-overlay);
}

.day-chart__stack {
  transform-origin: 50% 100%;
  display: flex;
  flex-direction: column-reverse;
  gap: 1px;
  margin: 0 1px;
  border-radius: 2px 2px 0 0;
  overflow: hidden;
}

.day-chart__stack i {
  display: block;
  flex-basis: 0;
  min-height: 1px;
  opacity: 0.88;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.day-chart__col--active .day-chart__stack i {
  opacity: 1;
}

.day-chart__stack--narrow {
  align-self: center;
  width: calc(100% - 2px);
  max-width: 48px;
}

.day-chart__zero {
  height: 2px;
  margin: 0 1px;
  background: var(--surface-tertiary);
}

.day-chart__lines {
  transform-origin: 50% 100%;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.day-chart__area {
  opacity: 0.22;
}

.day-chart__line {
  fill: none;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
}

.day-chart__guide {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--border-emphasis);
  pointer-events: none;
}

.day-chart__guide--pin {
  top: -4px;
  border-left-style: dashed;
}

.day-chart__dot {
  position: absolute;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  border: 2px solid var(--canvas-subtle);
  box-sizing: content-box;
  pointer-events: none;
}

.day-chart__readout {
  position: absolute;
  top: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 140px;
  margin: 0 8px;
  padding: 6px 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--chart-tooltip-bg);
  box-shadow: var(--shadow-md);
  color: var(--chart-tooltip-fg);
  font-size: 12px;
  line-height: 16px;
  pointer-events: none;
  white-space: nowrap;
}

.day-chart__readout-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.day-chart__readout-row i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.day-chart__readout-row em {
  margin-left: auto;
  padding-left: 16px;
  font-style: normal;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.day-chart__readout-total {
  font-weight: 600;
}

.day-chart__readout-muted {
  opacity: 0.7;
}

.day-chart__empty {
  margin: 0;
  padding-top: 40%;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
}

.day-chart__axis {
  position: relative;
  height: 18px;
  margin-top: 4px;
  font: 11px/16px var(--font-mono);
  color: var(--text-tertiary);
}

.day-chart__tick {
  position: absolute;
  white-space: nowrap;
  transform: translateX(-50%);
}

.day-chart__tick--start {
  transform: none;
}

.day-chart__tick--end {
  transform: translateX(-100%);
}
</style>
