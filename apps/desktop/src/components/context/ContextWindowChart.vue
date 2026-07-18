<script setup lang="ts">
import type { ContextCompaction, ContextTimeline, ContextWindowPoint } from "@tracepilot/types";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  timeline: ContextTimeline;
  selectedPoint?: ContextWindowPoint | null;
}>();

const emit = defineEmits<{
  selectPoint: [point: ContextWindowPoint];
  selectCompaction: [compaction: ContextCompaction];
}>();

type LayerKey = "systemTokens" | "toolDefinitionTokens" | "conversationTokens";
const layers: Array<{ key: LayerKey; label: string; color: string }> = [
  { key: "systemTokens", label: "System prompt", color: "var(--chart-secondary)" },
  { key: "toolDefinitionTokens", label: "Tool definitions", color: "var(--chart-primary)" },
  { key: "conversationTokens", label: "Conversation", color: "var(--chart-warning)" },
];
const enabled = ref<Record<LayerKey, boolean>>({
  systemTokens: true,
  toolDefinitionTokens: true,
  conversationTokens: true,
});
const hoverPoint = ref<ContextWindowPoint | null>(null);
const zoom = ref(1);
const panStart = ref(0);

const width = 900;
const height = 360;
const margin = { top: 20, right: 20, bottom: 42, left: 66 };
const plotWidth = width - margin.left - margin.right;
const plotHeight = height - margin.top - margin.bottom;

const visibleCount = computed(() =>
  Math.max(
    2,
    Math.min(props.timeline.points.length, Math.ceil(props.timeline.points.length / zoom.value)),
  ),
);
const maxPanStart = computed(() => Math.max(0, props.timeline.points.length - visibleCount.value));
const indexedPoints = computed(() =>
  props.timeline.points
    .map((point, globalIndex) => ({ point, globalIndex }))
    .slice(panStart.value, panStart.value + visibleCount.value),
);
const points = computed(() => indexedPoints.value.map(({ point }) => point));

watch([zoom, () => props.timeline.points.length], () => {
  panStart.value = Math.min(panStart.value, maxPanStart.value);
});

const visibleTotal = (point: ContextWindowPoint) =>
  layers.reduce((sum, layer) => sum + (enabled.value[layer.key] ? point[layer.key] : 0), 0);
const maxTokens = computed(() => {
  const max = Math.max(...points.value.map(visibleTotal), 1);
  return Math.ceil(max / 10_000) * 10_000 || max;
});
const x = (localIndex: number) =>
  margin.left + (localIndex / Math.max(points.value.length - 1, 1)) * plotWidth;
const y = (tokens: number) => margin.top + plotHeight - (tokens / maxTokens.value) * plotHeight;

const layerPolygons = computed(() => {
  let baseline = points.value.map(() => 0);
  return layers.map((layer) => {
    const top = points.value.map(
      (point, index) => baseline[index] + (enabled.value[layer.key] ? point[layer.key] : 0),
    );
    const upper = top.map((value, index) => `${x(index)},${y(value)}`);
    const lower = baseline.map((value, index) => `${x(index)},${y(value)}`).reverse();
    baseline = top;
    return { ...layer, points: [...upper, ...lower].join(" ") };
  });
});
const yTicks = computed(() =>
  Array.from({ length: 5 }, (_, index) => {
    const value = Math.round((maxTokens.value * index) / 4);
    return { value, y: y(value) };
  }),
);
const xTicks = computed(() => {
  const count = Math.min(6, points.value.length);
  return Array.from({ length: count }, (_, index) => {
    const pointIndex = Math.round((index * (points.value.length - 1)) / Math.max(count - 1, 1));
    return { index: pointIndex, turn: points.value[pointIndex]?.turn ?? 0, x: x(pointIndex) };
  });
});
const compactionMarkers = computed(() =>
  props.timeline.compactions.flatMap((compaction) => {
    const startGlobal = props.timeline.points.findIndex(
      (point) => point.turn === compaction.startTurn && point.phase === "preCompaction",
    );
    let completeGlobal = props.timeline.points.findIndex(
      (point) => point.turn === compaction.completeTurn && point.phase === "postCompaction",
    );
    if (completeGlobal < 0) {
      completeGlobal = props.timeline.points.findIndex(
        (point) => point.turn === compaction.completeTurn,
      );
    }
    if (
      startGlobal < 0 ||
      completeGlobal < panStart.value ||
      startGlobal > panStart.value + visibleCount.value - 1
    ) {
      return [];
    }
    const startX = x(Math.max(0, startGlobal - panStart.value));
    const completeX = x(
      Math.min(points.value.length - 1, Math.max(0, completeGlobal - panStart.value)),
    );
    return [{ compaction, startX, completeX }];
  }),
);
const selectedIndex = computed(() =>
  props.selectedPoint
    ? points.value.findIndex(
        (point) =>
          point.turn === props.selectedPoint?.turn && point.phase === props.selectedPoint?.phase,
      )
    : -1,
);
const tooltipPoint = computed(() => hoverPoint.value ?? props.selectedPoint ?? null);
const tooltipIndex = computed(() => {
  const point = tooltipPoint.value;
  return point
    ? points.value.findIndex((item) => item.turn === point.turn && item.phase === point.phase)
    : -1;
});
const tooltipX = computed(() =>
  tooltipIndex.value < 0
    ? 0
    : Math.min(width - margin.right - 148, Math.max(margin.left, x(tooltipIndex.value) + 10)),
);
const tooltipY = computed(() =>
  tooltipPoint.value
    ? Math.max(margin.top + 4, y(visibleTotal(tooltipPoint.value)) - 62)
    : margin.top,
);

function pointAtEvent(event: MouseEvent): ContextWindowPoint | null {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  const localX = ((event.clientX - rect.left) / rect.width) * width;
  const ratio = Math.min(1, Math.max(0, (localX - margin.left) / plotWidth));
  return points.value[Math.round(ratio * Math.max(points.value.length - 1, 0))] ?? null;
}
function handleMove(event: MouseEvent) {
  hoverPoint.value = pointAtEvent(event);
}
function lockPoint(event: MouseEvent) {
  const point = pointAtEvent(event);
  if (point) emit("selectPoint", point);
}
function changeZoom(next: number) {
  const center = panStart.value + visibleCount.value / 2;
  zoom.value = Math.min(12, Math.max(1, next));
  panStart.value = Math.min(
    maxPanStart.value,
    Math.max(0, Math.round(center - visibleCount.value / 2)),
  );
}
function resetView() {
  zoom.value = 1;
  panStart.value = 0;
}
function formatTick(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}
</script>

<template>
  <div class="context-chart">
    <div class="context-chart__toolbar">
      <div class="context-chart__legend" aria-label="Context layers">
        <button
          v-for="layer in layers"
          :key="layer.key"
          type="button"
          class="context-chart__button"
          :class="{ 'context-chart__button--muted': !enabled[layer.key] }"
          :aria-pressed="enabled[layer.key]"
          @click="enabled[layer.key] = !enabled[layer.key]"
        >
          <span class="context-chart__swatch" :style="{ background: layer.color }" />
          {{ layer.label }}
        </button>
      </div>
      <div class="context-chart__controls" aria-label="Chart navigation">
        <button type="button" class="context-chart__button" aria-label="Zoom out" @click="changeZoom(zoom / 1.6)">−</button>
        <span>{{ zoom.toFixed(1) }}×</span>
        <button type="button" class="context-chart__button" aria-label="Zoom in" @click="changeZoom(zoom * 1.6)">+</button>
        <button type="button" class="context-chart__button" @click="resetView">Reset</button>
      </div>
    </div>

    <label v-if="maxPanStart > 0" class="context-chart__pan">
      <span>Pan</span>
      <input v-model.number="panStart" type="range" min="0" :max="maxPanStart" step="1" />
      <span>Turns {{ points[0]?.turn }}–{{ points[points.length - 1]?.turn }}</span>
    </label>

    <div class="context-chart__frame">
      <svg
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        aria-label="Stacked area chart of context window composition by turn"
        @mousemove="handleMove"
        @mouseleave="hoverPoint = null"
        @click="lockPoint"
      >
        <g class="context-chart__grid">
          <line v-for="tick in yTicks" :key="tick.value" :x1="margin.left" :x2="width - margin.right" :y1="tick.y" :y2="tick.y" />
        </g>
        <g class="context-chart__axes">
          <text v-for="tick in yTicks" :key="`y-${tick.value}`" :x="margin.left - 10" :y="tick.y + 4" text-anchor="end">{{ formatTick(tick.value) }}</text>
          <text v-for="tick in xTicks" :key="`x-${tick.index}`" :x="tick.x" :y="height - 14" text-anchor="middle">{{ tick.turn }}</text>
          <text :x="margin.left + plotWidth / 2" :y="height - 1" text-anchor="middle">Turn</text>
          <text :transform="`translate(15 ${margin.top + plotHeight / 2}) rotate(-90)`" text-anchor="middle">Context tokens</text>
        </g>

        <polygon v-for="layer in layerPolygons" :key="layer.key" :points="layer.points" :fill="layer.color" class="context-chart__area" />

        <g v-for="marker in compactionMarkers" :key="`${marker.compaction.startTurn}-${marker.compaction.completeTurn}`">
          <rect
            :x="Math.min(marker.startX, marker.completeX)"
            :y="margin.top"
            :width="Math.max(3, Math.abs(marker.completeX - marker.startX))"
            :height="plotHeight"
            class="context-chart__compaction-span"
          />
          <line :x1="marker.completeX" :x2="marker.completeX" :y1="margin.top" :y2="margin.top + plotHeight" class="context-chart__compaction-line" />
          <rect
            :x="marker.completeX - 9"
            :y="margin.top"
            width="18"
            :height="plotHeight"
            fill="transparent"
            class="context-chart__marker-hit"
            role="button"
            tabindex="0"
            :aria-label="`Inspect compaction started at turn ${marker.compaction.startTurn}, completed at turn ${marker.compaction.completeTurn}`"
            @click.stop="emit('selectCompaction', marker.compaction)"
            @keydown.enter.stop="emit('selectCompaction', marker.compaction)"
            @keydown.space.prevent.stop="emit('selectCompaction', marker.compaction)"
          />
          <circle :cx="marker.completeX" :cy="margin.top + 10" r="7" class="context-chart__compaction-dot" />
        </g>

        <circle
          v-for="({ point }, index) in indexedPoints"
          v-show="point.source === 'observed'"
          :key="`anchor-${point.turn}-${point.phase}`"
          :cx="x(index)"
          :cy="y(visibleTotal(point))"
          r="3.5"
          class="context-chart__anchor"
        />
        <line v-if="selectedIndex >= 0" :x1="x(selectedIndex)" :x2="x(selectedIndex)" :y1="margin.top" :y2="margin.top + plotHeight" class="context-chart__selection" />

        <g v-if="tooltipPoint && tooltipIndex >= 0" class="context-chart__tooltip" :transform="`translate(${tooltipX} ${tooltipY})`" pointer-events="none">
          <rect width="142" height="52" rx="5" />
          <text x="8" y="15">Turn {{ tooltipPoint.turn }} · {{ tooltipPoint.phase }}</text>
          <text x="8" y="31">{{ formatTick(tooltipPoint.totalTokens) }} tokens</text>
          <text x="8" y="45">{{ hoverPoint ? 'Click to lock' : 'Locked' }} · {{ tooltipPoint.source }}</text>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.context-chart__toolbar,
.context-chart__legend,
.context-chart__controls,
.context-chart__pan {
  display: flex;
  align-items: center;
  gap: 8px;
}
.context-chart__toolbar {
  justify-content: space-between;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.context-chart__button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 4px 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}
.context-chart__button:hover { border-color: var(--border-accent); color: var(--text-primary); }
.context-chart__button--muted { opacity: 0.45; }
.context-chart__swatch { width: 9px; height: 9px; border-radius: 2px; }
.context-chart__controls > span,
.context-chart__pan { color: var(--text-tertiary); font-size: 0.6875rem; }
.context-chart__pan { margin: 0 0 8px; }
.context-chart__pan input { flex: 1; min-width: 100px; }
.context-chart__frame {
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}
.context-chart__frame svg { display: block; min-width: 680px; width: 100%; height: auto; }
.context-chart__grid line { stroke: var(--border-muted); stroke-width: 1; }
.context-chart__axes text { fill: var(--text-tertiary); font-size: 10px; }
.context-chart__area { opacity: 0.72; transition: opacity var(--transition-fast); }
.context-chart__compaction-span { fill: var(--danger-fg); opacity: 0.07; pointer-events: none; }
.context-chart__compaction-line { stroke: var(--danger-fg); stroke-width: 1.5; stroke-dasharray: 5 4; pointer-events: none; }
.context-chart__compaction-dot { fill: var(--canvas-default); stroke: var(--danger-fg); stroke-width: 2; pointer-events: none; }
.context-chart__marker-hit { cursor: pointer; }
.context-chart__marker-hit:hover + .context-chart__compaction-dot { fill: var(--danger-subtle); }
.context-chart__anchor { fill: var(--canvas-default); stroke: var(--text-primary); stroke-width: 1.5; pointer-events: none; }
.context-chart__selection { stroke: var(--text-primary); stroke-width: 1; pointer-events: none; }
.context-chart__tooltip rect { fill: var(--canvas-overlay, var(--canvas-default)); stroke: var(--border-default); }
.context-chart__tooltip text { fill: var(--text-primary); font-size: 10px; }
</style>
