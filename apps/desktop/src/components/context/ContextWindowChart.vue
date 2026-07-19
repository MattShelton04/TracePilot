<script setup lang="ts">
import type {
  ContextCompaction,
  ContextTimeline,
  ContextTimelineEvent,
  ContextWindowPoint,
} from "@tracepilot/types";
import { computed, ref, watch } from "vue";
import { buildActiveTimeCoordinates } from "./contextChartScale";

const props = defineProps<{
  timeline: ContextTimeline;
  selectedPoint?: ContextWindowPoint | null;
  selectedEvent?: ContextTimelineEvent | null;
}>();

const emit = defineEmits<{
  selectPoint: [point: ContextWindowPoint];
  selectCompaction: [compaction: ContextCompaction];
  selectEvent: [event: ContextTimelineEvent];
  clearSelection: [];
}>();

type LayerKey = "systemTokens" | "toolDefinitionTokens" | "conversationTokens";
type AxisMode = "turn" | "time";
type LayerDefinition = {
  key: LayerKey;
  label: string;
  color: string;
  description: string;
};
const layers: LayerDefinition[] = [
  {
    key: "systemTokens",
    label: "System prompt",
    color: "var(--chart-secondary)",
    description: "Persistent Copilot instructions and environment context.",
  },
  {
    key: "toolDefinitionTokens",
    label: "Tool definitions",
    color: "var(--chart-primary)",
    description: "Schemas and instructions for tools available to the model.",
  },
  {
    key: "conversationTokens",
    label: "Conversation",
    color: "var(--chart-warning)",
    description: "Accumulated messages, reasoning, tool arguments, and returned tool results.",
  },
];
const enabled = ref<Record<LayerKey, boolean>>({
  systemTokens: true,
  toolDefinitionTokens: true,
  conversationTokens: true,
});
const axisMode = ref<AxisMode>("turn");
const hoverPoint = ref<ContextWindowPoint | null>(null);
const hoverPosition = ref<{ x: number; y: number } | null>(null);
const hoveredLayer = ref<LayerDefinition | null>(null);
const layerTooltipPosition = ref({ x: 0, y: 0 });
const zoom = ref(1);
const panStart = ref(0);
const isPanning = ref(false);
const dragStartX = ref(0);
const dragStartPan = ref(0);
const dragDistance = ref(0);

const width = 900;
const height = 390;
const margin = { top: 26, right: 26, bottom: 66, left: 66 };
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

const observedCompactionLevel = computed(() => {
  const values = props.timeline.compactions
    .map((item) => item.beforeTokens)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2);
});
const thresholdLines = computed(() => {
  const values: Array<{ value: number; label: string; kind: "observed" | "reported" }> = [];
  if (observedCompactionLevel.value) {
    values.push({
      value: observedCompactionLevel.value,
      label: "Observed compaction median",
      kind: "observed",
    });
  }
  if (props.timeline.reportedTokenLimit) {
    values.push({
      value: props.timeline.reportedTokenLimit,
      label: "Reported truncation limit",
      kind: "reported",
    });
  }
  return values;
});
const maxTokens = computed(() => {
  const max = Math.max(
    ...points.value.map(visibleTotal),
    ...thresholdLines.value.map((line) => line.value),
    1,
  );
  return Math.ceil(max / 10_000) * 10_000 || max;
});

const globalSessionBreakIndexes = computed(() => {
  const result = new Set<number>();
  const resumeTurns = new Set(
    props.timeline.events
      .filter((event) => event.kind === "sessionResume")
      .map((event) => event.turn),
  );
  props.timeline.points.forEach((point, globalIndex) => {
    if (globalIndex === 0) return;
    const previous = props.timeline.points[globalIndex - 1];
    if (
      previous?.phase === "shutdown" ||
      (resumeTurns.has(point.turn) && previous?.turn !== point.turn)
    ) {
      result.add(globalIndex);
    }
  });
  return result;
});
const globalActiveTimeCoordinates = computed(() =>
  buildActiveTimeCoordinates(
    props.timeline.points.map((point) => point.timestamp),
    {
      breakBeforeIndexes: globalSessionBreakIndexes.value,
    },
  ),
);
const sessionBreakIndexes = computed(() => {
  const result = new Set<number>();
  indexedPoints.value.forEach(({ globalIndex }, localIndex) => {
    if (localIndex > 0 && globalSessionBreakIndexes.value.has(globalIndex)) {
      result.add(localIndex);
    }
  });
  return result;
});
const activeTimeCoordinates = computed(() => {
  const origin = globalActiveTimeCoordinates.value[indexedPoints.value[0]?.globalIndex ?? 0] ?? 0;
  return indexedPoints.value.map(
    ({ globalIndex }) => (globalActiveTimeCoordinates.value[globalIndex] ?? origin) - origin,
  );
});
const timeBreakMarkers = computed(() =>
  [...sessionBreakIndexes.value].map((index) => ({ index, x: x(index) })),
);
function x(localIndex: number): number {
  if (axisMode.value === "time") {
    const value = activeTimeCoordinates.value[localIndex];
    const end = activeTimeCoordinates.value.at(-1) ?? 0;
    if (value != null && end > 0) {
      return margin.left + (value / end) * plotWidth;
    }
  }
  const startTurn = points.value[0]?.turn ?? 0;
  const endTurn = points.value.at(-1)?.turn ?? startTurn;
  const turn = points.value[localIndex]?.turn ?? startTurn;
  if (endTurn > startTurn) {
    return margin.left + ((turn - startTurn) / (endTurn - startTurn)) * plotWidth;
  }
  return margin.left;
}
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
  const candidates = points.value
    .map((_, index) => index)
    .filter((index) => {
      if (index === 0) return true;
      return axisMode.value === "turn"
        ? points.value[index]?.turn !== points.value[index - 1]?.turn
        : activeTimeCoordinates.value[index] !== activeTimeCoordinates.value[index - 1];
    });
  const count = Math.min(6, candidates.length);
  return Array.from({ length: count }, (_, index) => {
    const candidateIndex = Math.round((index * (candidates.length - 1)) / Math.max(count - 1, 1));
    const pointIndex = candidates[candidateIndex] ?? 0;
    const point = points.value[pointIndex];
    return {
      index: pointIndex,
      label:
        axisMode.value === "time" ? formatAxisTime(point?.timestamp) : String(point?.turn ?? 0),
      x: x(pointIndex),
    };
  });
});
const visibleEvents = computed(() =>
  props.timeline.events.flatMap((event, eventIndex) => {
    const localIndex = points.value.findIndex((point) => point.turn === event.turn);
    if (localIndex < 0) return [];
    return [{ event, eventIndex, x: x(localIndex) }];
  }),
);
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
    return [
      {
        compaction,
        startX: x(Math.max(0, startGlobal - panStart.value)),
        completeX: x(
          Math.min(points.value.length - 1, Math.max(0, completeGlobal - panStart.value)),
        ),
      },
    ];
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
const tooltipPoint = computed(() => props.selectedPoint ?? hoverPoint.value ?? null);
const tooltipIndex = computed(() => {
  const point = tooltipPoint.value;
  return point
    ? points.value.findIndex((item) => item.turn === point.turn && item.phase === point.phase)
    : -1;
});
const tooltipX = computed(() => {
  if (tooltipIndex.value < 0) return 0;
  const anchor =
    props.selectedPoint || !hoverPosition.value
      ? x(tooltipIndex.value) + 10
      : hoverPosition.value.x + 10;
  return Math.min(width - margin.right - 148, Math.max(margin.left, anchor));
});
const tooltipY = computed(() => {
  if (!tooltipPoint.value) return margin.top;
  const anchor =
    props.selectedPoint || !hoverPosition.value
      ? y(visibleTotal(tooltipPoint.value)) - 50
      : hoverPosition.value.y - 48;
  return Math.min(margin.top + plotHeight - 43, Math.max(margin.top + 4, anchor));
});

function pointAtEvent(event: MouseEvent): ContextWindowPoint | null {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  const localX = ((event.clientX - rect.left) / rect.width) * width;
  let nearest: ContextWindowPoint | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.value.length; index += 1) {
    const nextDistance = Math.abs(x(index) - localX);
    if (nextDistance < distance) {
      distance = nextDistance;
      nearest = points.value[index];
    }
  }
  return nearest;
}
function handleMove(event: MouseEvent) {
  if (isPanning.value) return;
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  hoverPosition.value = {
    x: ((event.clientX - rect.left) / rect.width) * width,
    y: ((event.clientY - rect.top) / rect.height) * height,
  };
  hoverPoint.value = pointAtEvent(event);
}
function clearHover() {
  hoverPoint.value = null;
  hoverPosition.value = null;
}
function showLayerTooltip(event: MouseEvent, layer: LayerDefinition) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  hoveredLayer.value = layer;
  layerTooltipPosition.value = {
    x: Math.min(window.innerWidth - 190, Math.max(190, rect.left + rect.width / 2)),
    y: rect.bottom + 7,
  };
}
function hideLayerTooltip() {
  hoveredLayer.value = null;
}
function toggleLayer(event: MouseEvent, layer: LayerDefinition) {
  enabled.value[layer.key] = !enabled.value[layer.key];
  hideLayerTooltip();
  (event.currentTarget as HTMLElement).blur();
}
function lockPoint(event: MouseEvent) {
  if (dragDistance.value > 4) {
    dragDistance.value = 0;
    return;
  }
  const point = pointAtEvent(event);
  if (!point) return;
  if (props.selectedPoint?.turn === point.turn && props.selectedPoint.phase === point.phase) {
    emit("clearSelection");
  } else {
    emit("selectPoint", point);
  }
}
function changeZoom(next: number, anchorRatio = 0.5) {
  const anchor = panStart.value + anchorRatio * Math.max(visibleCount.value - 1, 0);
  zoom.value = Math.min(16, Math.max(1, next));
  panStart.value = Math.min(
    maxPanStart.value,
    Math.max(0, Math.round(anchor - anchorRatio * Math.max(visibleCount.value - 1, 0))),
  );
}
function handleWheel(event: WheelEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  changeZoom(event.deltaY < 0 ? zoom.value * 1.35 : zoom.value / 1.35, ratio);
}
function startPan(event: PointerEvent) {
  if (event.button !== 0 && event.button !== 1) return;
  if (event.button === 1) event.preventDefault();
  isPanning.value = true;
  dragStartX.value = event.clientX;
  dragStartPan.value = panStart.value;
  dragDistance.value = 0;
  (event.currentTarget as SVGElement).setPointerCapture?.(event.pointerId);
}
function movePan(event: PointerEvent) {
  if (!isPanning.value || maxPanStart.value === 0) return;
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  const delta = event.clientX - dragStartX.value;
  dragDistance.value = Math.max(dragDistance.value, Math.abs(delta));
  panStart.value = Math.min(
    maxPanStart.value,
    Math.max(0, Math.round(dragStartPan.value - (delta / rect.width) * visibleCount.value)),
  );
}
function endPan() {
  isPanning.value = false;
}
function resetView() {
  zoom.value = 1;
  panStart.value = 0;
}
function selectExactPoint(point: ContextWindowPoint) {
  if (props.selectedPoint?.turn === point.turn && props.selectedPoint.phase === point.phase) {
    emit("clearSelection");
    return;
  }
  hoverPoint.value = point;
  emit("selectPoint", point);
}
function selectEventMarker(event: ContextTimelineEvent) {
  if (
    props.selectedEvent?.turn === event.turn &&
    props.selectedEvent.kind === event.kind &&
    props.selectedEvent.timestamp === event.timestamp
  ) {
    emit("clearSelection");
  } else {
    emit("selectEvent", event);
  }
}
function selectCompactionMarker(compaction: ContextCompaction) {
  if (
    props.selectedPoint?.turn === compaction.startTurn &&
    props.selectedPoint.phase === "preCompaction"
  ) {
    emit("clearSelection");
  } else {
    emit("selectCompaction", compaction);
  }
}
function selectAdjacentTurn(direction: -1 | 1) {
  const selectable = props.timeline.points.filter((point) => point.phase !== "postCompaction");
  if (!selectable.length) return;
  const currentTurn = props.selectedPoint?.turn ?? hoverPoint.value?.turn;
  const target =
    currentTurn == null
      ? direction > 0
        ? selectable[0]
        : selectable.at(-1)
      : direction > 0
        ? selectable.find((point) => point.turn > currentTurn)
        : [...selectable].reverse().find((point) => point.turn < currentTurn);
  if (!target) return;

  const targetIndex = props.timeline.points.findIndex(
    (point) => point.turn === target.turn && point.phase === target.phase,
  );
  if (targetIndex < panStart.value) {
    panStart.value = targetIndex;
  } else if (targetIndex >= panStart.value + visibleCount.value) {
    panStart.value = Math.min(maxPanStart.value, targetIndex - visibleCount.value + 1);
  }
  hoverPoint.value = target;
  emit("selectPoint", target);
}
function handleChartKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("clearSelection");
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  selectAdjacentTurn(event.key === "ArrowLeft" ? -1 : 1);
}
function formatTick(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}
function formatTime(timestamp?: string | null): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function formatAxisTime(timestamp?: string | null): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  const first = points.value.find((point) => point.timestamp)?.timestamp;
  const firstDate = first ? new Date(first) : date;
  const spansDays = date.toDateString() !== firstDate.toDateString();
  return spansDays
    ? date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : formatTime(timestamp);
}
function eventHoverLabel(event: ContextTimelineEvent): string {
  const preview = event.preview?.replace(/\s+/g, " ").trim();
  if (!preview) return `${event.label} · Turn ${event.turn}`;
  const shortened = preview.length > 120 ? `${preview.slice(0, 117)}…` : preview;
  return `${event.label} · Turn ${event.turn} · ${shortened}`;
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
          :aria-label="`${layer.label}: ${layer.description}`"
          :aria-pressed="enabled[layer.key]"
          @mouseenter="showLayerTooltip($event, layer)"
          @mouseleave="hideLayerTooltip"
          @click="toggleLayer($event, layer)"
        >
          <span class="context-chart__swatch" :style="{ background: layer.color }" />
          {{ layer.label }}
        </button>
        <span v-if="timeline.events.some((event) => event.kind === 'userMessage')" class="context-chart__legend-key">
          <span class="context-chart__legend-dot context-chart__legend-dot--message" />
          User message
        </span>
        <span v-if="timeline.events.some((event) => event.kind !== 'userMessage')" class="context-chart__legend-key">
          <span class="context-chart__legend-dot context-chart__legend-dot--event" />
          Session event
        </span>
        <span v-if="thresholdLines.length" class="context-chart__legend-key">
          <span class="context-chart__legend-line" />
          Pressure level
        </span>
      </div>
      <div class="context-chart__controls" aria-label="Chart navigation">
        <span class="context-chart__gesture-hint">Scroll to zoom · drag or middle-drag to pan</span>
        <div class="context-chart__segments" aria-label="Horizontal axis">
          <button type="button" :class="{ active: axisMode === 'turn' }" @click="axisMode = 'turn'">Turn</button>
          <button type="button" :class="{ active: axisMode === 'time' }" @click="axisMode = 'time'">Time</button>
        </div>
        <button type="button" class="context-chart__icon-button" aria-label="Zoom out" @click="changeZoom(zoom / 1.5)">−</button>
        <button type="button" class="context-chart__icon-button" aria-label="Zoom in" @click="changeZoom(zoom * 1.5)">+</button>
        <button type="button" class="context-chart__button" @click="resetView">Reset</button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="hoveredLayer"
        class="context-chart__layer-tooltip"
        role="tooltip"
        :style="{
          left: `${layerTooltipPosition.x}px`,
          top: `${layerTooltipPosition.y}px`,
        }"
      >
        <strong>{{ hoveredLayer.label }}</strong>
        <span>{{ hoveredLayer.description }}</span>
      </div>
    </Teleport>

    <div v-if="zoom > 1" class="context-chart__viewport-status">
      Viewing turns {{ points[0]?.turn }}–{{ points[points.length - 1]?.turn }} ·
      {{ zoom.toFixed(1) }}×
    </div>

    <div class="context-chart__frame" :class="{ 'context-chart__frame--panning': isPanning }">
      <svg
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        tabindex="0"
        aria-label="Stacked area chart of context window composition"
        @mousemove="handleMove"
        @mouseleave="clearHover"
        @click="lockPoint"
        @wheel.prevent="handleWheel"
        @pointerdown="startPan"
        @pointermove="movePan"
        @pointerup="endPan"
        @pointercancel="endPan"
        @keydown="handleChartKeydown"
      >
        <g class="context-chart__grid">
          <line v-for="tick in yTicks" :key="tick.value" :x1="margin.left" :x2="width - margin.right" :y1="tick.y" :y2="tick.y" />
        </g>
        <g class="context-chart__axes">
          <text v-for="tick in yTicks" :key="`y-${tick.value}`" :x="margin.left - 10" :y="tick.y + 4" text-anchor="end">{{ formatTick(tick.value) }}</text>
          <text v-for="tick in xTicks" :key="`x-${tick.index}`" :x="tick.x" :y="height - 34" text-anchor="middle">{{ tick.label }}</text>
          <text :x="margin.left + plotWidth / 2" :y="height - 10" text-anchor="middle">{{ axisMode === 'time' ? 'Time' : 'Turn' }}</text>
          <text :transform="`translate(15 ${margin.top + plotHeight / 2}) rotate(-90)`" text-anchor="middle">Context tokens</text>
        </g>

        <g v-if="axisMode === 'time'" class="context-chart__time-breaks" aria-hidden="true">
          <path
            v-for="marker in timeBreakMarkers"
            :key="marker.index"
            :d="`M ${marker.x - 5} ${margin.top + plotHeight + 8} l 4 -7 M ${marker.x + 1} ${margin.top + plotHeight + 8} l 4 -7`"
          />
        </g>

        <polygon v-for="layer in layerPolygons" :key="layer.key" :points="layer.points" :fill="layer.color" class="context-chart__area" />

        <g v-for="line in thresholdLines" :key="line.kind">
          <line :x1="margin.left" :x2="width - margin.right" :y1="y(line.value)" :y2="y(line.value)" :class="['context-chart__threshold', `context-chart__threshold--${line.kind}`]" />
          <text :x="width - margin.right - 4" :y="y(line.value) - 5" text-anchor="end" class="context-chart__threshold-label">{{ line.label }} · {{ formatTick(line.value) }}</text>
        </g>

        <g v-for="marker in compactionMarkers" :key="`${marker.compaction.startTurn}-${marker.compaction.completeTurn}`">
          <rect :x="Math.min(marker.startX, marker.completeX)" :y="margin.top" :width="Math.max(3, Math.abs(marker.completeX - marker.startX))" :height="plotHeight" class="context-chart__compaction-span" />
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
            @pointerdown.stop
            @click.stop="selectCompactionMarker(marker.compaction)"
            @keydown.enter.stop="selectCompactionMarker(marker.compaction)"
            @keydown.space.prevent.stop="selectCompactionMarker(marker.compaction)"
          />
          <circle :cx="marker.completeX" :cy="margin.top + 10" r="7" class="context-chart__compaction-dot" />
        </g>

        <g v-for="marker in visibleEvents" :key="`${marker.event.kind}-${marker.eventIndex}`">
          <line :x1="marker.x" :x2="marker.x" :y1="margin.top + plotHeight - 16" :y2="margin.top + plotHeight" class="context-chart__event-stem" />
          <circle
            :cx="marker.x"
            :cy="margin.top + plotHeight - 18"
            r="6"
            :class="['context-chart__event-dot', `context-chart__event-dot--${marker.event.kind}`, { selected: selectedEvent === marker.event }]"
          />
          <circle
            :cx="marker.x"
            :cy="margin.top + plotHeight - 18"
            r="11"
            fill="transparent"
            class="context-chart__point-hit"
            tabindex="0"
            role="button"
            :aria-label="`${marker.event.label} at turn ${marker.event.turn}`"
            @pointerdown.stop
            @click.stop="selectEventMarker(marker.event)"
            @keydown.enter.stop="selectEventMarker(marker.event)"
          >
            <title>{{ eventHoverLabel(marker.event) }}</title>
          </circle>
        </g>

        <g v-for="({ point }, index) in indexedPoints" :key="`point-${point.turn}-${point.phase}`">
          <circle
            v-if="point.phase !== 'turn' && point.phase !== 'postCompaction'"
            :cx="x(index)"
            :cy="y(visibleTotal(point))"
            r="5"
            :class="['context-chart__anchor', `context-chart__anchor--${point.phase}`]"
          />
          <circle
            v-if="point.phase !== 'turn' && point.phase !== 'postCompaction'"
            :cx="x(index)"
            :cy="y(visibleTotal(point))"
            r="12"
            fill="transparent"
            class="context-chart__point-hit"
            tabindex="0"
            role="button"
            :aria-label="`Select ${point.phase} at turn ${point.turn}`"
            @pointerdown.stop
            @mouseenter="hoverPoint = point"
            @click.stop="selectExactPoint(point)"
            @keydown.enter.stop="selectExactPoint(point)"
          />
          <circle
            v-else-if="point.source === 'observed'"
            :cx="x(index)"
            :cy="y(visibleTotal(point))"
            r="3.5"
            class="context-chart__anchor"
          />
        </g>

        <line v-if="selectedIndex >= 0" :x1="x(selectedIndex)" :x2="x(selectedIndex)" :y1="margin.top" :y2="margin.top + plotHeight" class="context-chart__selection" />

        <g v-if="tooltipPoint && tooltipIndex >= 0" class="context-chart__tooltip" :transform="`translate(${tooltipX} ${tooltipY})`" pointer-events="none">
          <rect width="142" height="39" rx="5" />
          <text x="8" y="15">Turn {{ tooltipPoint.turn }} · {{ tooltipPoint.phase }}</text>
          <text x="8" y="31">{{ formatTick(tooltipPoint.totalTokens) }} tokens · {{ tooltipPoint.source }}</text>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.context-chart__toolbar,
.context-chart__legend,
.context-chart__controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.context-chart__toolbar { justify-content: space-between; flex-wrap: wrap; margin-bottom: 8px; }
.context-chart__button,
.context-chart__icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
.context-chart__icon-button { width: 28px; padding: 0; }
.context-chart__button:hover,
.context-chart__icon-button:hover { border-color: var(--border-accent); color: var(--text-primary); }
.context-chart__button--muted { opacity: 0.45; }
.context-chart__swatch { width: 9px; height: 9px; border-radius: 2px; }
.context-chart__layer-tooltip {
  position: fixed;
  z-index: var(--z-tooltip);
  display: grid;
  width: max-content;
  max-width: 360px;
  gap: 2px;
  padding: 7px 9px;
  transform: translateX(-50%);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-overlay, var(--canvas-default));
  box-shadow: var(--shadow-md);
  color: var(--text-secondary);
  font-size: 0.6875rem;
  line-height: 1.4;
  pointer-events: none;
}
.context-chart__layer-tooltip strong { color: var(--text-primary); }
.context-chart__legend-key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  white-space: nowrap;
}
.context-chart__legend-dot {
  width: 7px;
  height: 7px;
  border: 1px solid var(--canvas-default);
  border-radius: 50%;
  background: var(--accent-fg);
}
.context-chart__legend-dot--event { background: var(--success-fg); }
.context-chart__legend-line {
  width: 16px;
  border-top: 2px dotted var(--warning-fg);
}
.context-chart__gesture-hint { color: var(--text-tertiary); font-size: 0.6875rem; }
.context-chart__segments { display: inline-flex; padding: 2px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); }
.context-chart__segments button { padding: 2px 7px; border: 0; border-radius: 3px; background: transparent; color: var(--text-tertiary); font: inherit; font-size: 0.6875rem; cursor: pointer; }
.context-chart__segments button.active { background: var(--neutral-subtle); color: var(--text-primary); }
.context-chart__viewport-status {
  margin: 0 2px 7px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  text-align: right;
}
.context-chart__frame {
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  cursor: grab;
}
.context-chart__frame--panning { cursor: grabbing; }
.context-chart__frame svg { display: block; min-width: 680px; width: 100%; height: auto; touch-action: none; user-select: none; }
.context-chart__grid line { stroke: var(--border-muted); stroke-width: 1; }
.context-chart__axes text { fill: var(--text-tertiary); font-size: 10px; }
.context-chart__time-breaks path {
  fill: none;
  stroke: var(--text-tertiary);
  stroke-width: 1.5;
}
.context-chart__area { opacity: 0.72; }
.context-chart__threshold { stroke-width: 1.25; stroke-dasharray: 2 5; pointer-events: none; }
.context-chart__threshold--observed { stroke: var(--warning-fg); }
.context-chart__threshold--reported { stroke: var(--danger-fg); }
.context-chart__threshold-label { fill: var(--text-secondary); font-size: 9px; pointer-events: none; }
.context-chart__compaction-span { fill: var(--danger-fg); opacity: 0.07; pointer-events: none; }
.context-chart__compaction-line { stroke: var(--danger-fg); stroke-width: 1.5; stroke-dasharray: 5 4; pointer-events: none; }
.context-chart__compaction-dot { fill: var(--canvas-default); stroke: var(--danger-fg); stroke-width: 2; pointer-events: none; }
.context-chart__marker-hit,
.context-chart__point-hit { cursor: pointer; }
.context-chart__event-stem { stroke: var(--text-tertiary); stroke-width: 1; pointer-events: none; }
.context-chart__event-dot { fill: var(--accent-fg); stroke: var(--canvas-default); stroke-width: 2; pointer-events: none; }
.context-chart__event-dot--modelChange { fill: var(--chart-secondary); }
.context-chart__event-dot--sessionResume { fill: var(--success-fg); }
.context-chart__event-dot--truncation { fill: var(--danger-fg); }
.context-chart__event-dot.selected { stroke: var(--text-primary); stroke-width: 3; }
.context-chart__anchor { fill: var(--canvas-default); stroke: var(--text-primary); stroke-width: 1.5; pointer-events: none; }
.context-chart__anchor--preCompaction { stroke: var(--danger-fg); }
.context-chart__anchor--shutdown { stroke: var(--warning-fg); }
.context-chart__selection { stroke: var(--text-primary); stroke-width: 1; pointer-events: none; }
.context-chart__tooltip rect { fill: var(--canvas-overlay, var(--canvas-default)); stroke: var(--border-default); }
.context-chart__tooltip text { fill: var(--text-primary); font-size: 10px; }
</style>
