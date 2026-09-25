<script setup lang="ts">
/**
 * Communication graph: agents and the exchanges between them up to the
 * playhead. Repeated exchanges on a route merge into one thicker edge with a
 * count. Messages still waiting for a busy recipient travel along their edge
 * until delivered, and each agent shows whether it was working, waiting or
 * finished at that moment.
 *
 * Small teams are laid out as their launch tree; teams too wide for the frame
 * switch to rings around the main agent. Playback runs on the compressed time
 * scale, so idle gaps of hours pass in a moment.
 */
import type {
  CommsTimeline,
  CommsTimelineAgent,
  CommsTimelineEvent,
  CommsTimeScale,
  TimelinePlayback,
} from "@tracepilot/ui";
import { formatTimelineOffset, getAgentColor } from "@tracepilot/ui";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-vue-next";
import { computed, ref, useId } from "vue";
import { useElementWidth } from "@/composables/useElementWidth";
import CommsMarkers from "./CommsMarkers.vue";
import { clipText, edgeDash, eventSummary } from "./commsVisuals";

const props = defineProps<{
  timeline: CommsTimeline;
  events: CommsTimelineEvent[];
  scale: CommsTimeScale;
  selectedId: string | null;
  playback: TimelinePlayback;
}>();

const emit = defineEmits<{ select: [id: string | null] }>();

const LEVEL_H = 128;
const TOP = 48;
const MIN_SLOT = 128;
const RING_START = 150;
const RING_GAP = 72;
const RING_SLOT = 40;
const SPEEDS = [0.5, 1, 2, 4];

const markerId = useId();
const frame = ref<HTMLElement | null>(null);
const frameWidth = useElementWidth(frame, 900);

const { positionMs, playing, speed } = props.playback;

// ── Everything the playhead touches, on the visual (compressed) scale ──
interface VisualAgent {
  agent: CommsTimelineAgent;
  startV: number;
  endV: number;
  activityV: number[];
}

const visualAgents = computed<VisualAgent[]>(() =>
  props.timeline.agents.map((agent) => ({
    agent,
    startV: props.scale.toVisual(agent.startMs),
    endV: props.scale.toVisual(agent.endMs),
    activityV: agent.activityMs.map((ms) => props.scale.toVisual(ms)),
  })),
);

const visualEvents = computed(() =>
  props.events.map((ev) => ({
    ev,
    atV: props.scale.toVisual(ev.atMs),
    deliveries: ev.deliveries.map((d) => ({ ...d, atV: props.scale.toVisual(d.atMs) })),
  })),
);

const vNow = computed(() => positionMs.value);
const vDuration = computed(() => props.scale.durationMs);

/** True when some value in the sorted list falls in (from, to]. */
function anyIn(sorted: number[], from: number, to: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) <= from) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && (sorted[lo] as number) <= to;
}

// ── Layout ──
const children = computed(() => {
  const map = new Map<string, CommsTimelineAgent[]>();
  for (const a of props.timeline.agents) {
    if (!a.parentKey) continue;
    map.set(a.parentKey, [...(map.get(a.parentKey) ?? []), a]);
  }
  return map;
});

const leafCount = computed(() =>
  Math.max(1, props.timeline.agents.filter((a) => !children.value.has(a.key)).length),
);

/** Rings around the main agent when the tree would not fit across the frame. */
const radial = computed(() => leafCount.value * MIN_SLOT > frameWidth.value - 32);

const rings = computed(() => {
  const workers = props.timeline.agents.filter((a) => !a.isMain);
  const list: CommsTimelineAgent[][] = [];
  let i = 0;
  for (let ring = 0; i < workers.length; ring++) {
    const capacity = Math.max(
      6,
      Math.floor((2 * Math.PI * (RING_START + ring * RING_GAP)) / RING_SLOT),
    );
    list.push(workers.slice(i, i + capacity));
    i += capacity;
  }
  return list;
});

const nodeR = computed(() => (radial.value ? 12 : 22));
/** Labels fit under nodes in the tree and on a single sparse ring. */
const showLabels = computed(
  () => !radial.value || (rings.value.length === 1 && (rings.value[0]?.length ?? 0) <= 16),
);

const outerRadius = computed(() => RING_START + Math.max(0, rings.value.length - 1) * RING_GAP);
const width = computed(() =>
  radial.value
    ? Math.max(Math.floor(frameWidth.value), 2 * outerRadius.value + 160)
    : Math.max(Math.floor(frameWidth.value), leafCount.value * MIN_SLOT + 32),
);
const maxDepth = computed(() => Math.max(0, ...props.timeline.agents.map((a) => a.depth)));
const height = computed(() =>
  radial.value ? 2 * outerRadius.value + 120 : TOP + maxDepth.value * LEVEL_H + 80,
);

const positions = computed(() => {
  const pos = new Map<string, { x: number; y: number }>();
  if (radial.value) {
    const cx = width.value / 2;
    const cy = height.value / 2;
    for (const a of props.timeline.agents) if (a.isMain) pos.set(a.key, { x: cx, y: cy });
    rings.value.forEach((ring, r) => {
      const radius = RING_START + r * RING_GAP;
      ring.forEach((a, i) => {
        // Agents keep launch order clockwise from twelve o'clock.
        const angle = -Math.PI / 2 + (i / ring.length) * 2 * Math.PI;
        pos.set(a.key, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
      });
    });
    return pos;
  }
  // Tree: leaves take consecutive slots, parents centre over their children.
  const slot = (width.value - 32) / leafCount.value;
  let next = 0;
  const place = (a: CommsTimelineAgent): number => {
    const kids = children.value.get(a.key) ?? [];
    const x = kids.length
      ? kids.map(place).reduce((sum, v) => sum + v, 0) / kids.length
      : 16 + slot * (next++ + 0.5);
    pos.set(a.key, { x, y: TOP + a.depth * LEVEL_H });
    return x;
  };
  // Agents arrive in tree order, so this places each root with its subtree.
  for (const a of props.timeline.agents) if (!pos.has(a.key)) place(a);
  return pos;
});

function trimmed(from: { x: number; y: number }, to: { x: number; y: number }, r: number) {
  const l = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / l) * r, y: from.y + ((to.y - from.y) / l) * r };
}

const startedKeys = computed(
  () => new Set(visualAgents.value.filter((v) => vNow.value >= v.startV).map((v) => v.agent.key)),
);

const treeLinks = computed(() =>
  props.timeline.agents.flatMap((a) => {
    const p = a.parentKey ? positions.value.get(a.parentKey) : undefined;
    const q = positions.value.get(a.key);
    if (!p || !q) return [];
    const s = trimmed(p, q, nodeR.value);
    const e = trimmed(q, p, nodeR.value);
    return [
      { key: a.key, x1: s.x, y1: s.y, x2: e.x, y2: e.y, started: startedKeys.value.has(a.key) },
    ];
  }),
);

// ── Node state at the playhead ──
const activityWindow = computed(() => Math.max(3_000, vDuration.value * 0.03));

type Phase = "pending" | "working" | "waiting" | "done";

function nodeState(v: VisualAgent): { label: string; phase: Phase } {
  const t = vNow.value;
  if (t < v.startV) return { label: "not started", phase: "pending" };
  // Workers finish at their end; the main agent only at the end of the session.
  if (t >= v.endV && (!v.agent.isMain || t >= vDuration.value)) {
    return { label: v.agent.status, phase: "done" };
  }
  return anyIn(v.activityV, t - activityWindow.value, t)
    ? { label: "working", phase: "working" }
    : { label: "waiting", phase: "waiting" };
}

const nodes = computed(() =>
  visualAgents.value.map((v) => {
    const p = positions.value.get(v.agent.key) ?? { x: 0, y: 0 };
    return {
      agent: v.agent,
      ...p,
      color: getAgentColor(v.agent.type),
      state: nodeState(v),
      label: clipText(v.agent.name, 18),
    };
  }),
);

// ── Edges up to the playhead, merged per route ──
interface Shape {
  p0: [number, number];
  c: [number, number];
  p1: [number, number];
}

interface Route extends Shape {
  key: string;
  ev: CommsTimelineEvent;
  count: number;
  ids: string[];
  d: string;
  mid: { x: number; y: number };
  live: boolean;
}

const pulseWindow = computed(() => Math.max(1_500, vDuration.value * 0.02));

function curve(fromKey: string, toKey: string, edge: CommsTimelineEvent["edge"]): Shape | null {
  const p = positions.value.get(fromKey);
  const q = positions.value.get(toKey);
  if (!p || !q || fromKey === toKey) return null;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const reach = Math.min(1, len / 240);
  const bend = (edge === "peer" ? -54 : edge === "read" || edge === "up" ? 26 : -16) * reach;
  const c: [number, number] = [
    (p.x + q.x) / 2 + (-dy / len) * bend,
    (p.y + q.y) / 2 + (dx / len) * bend,
  ];
  const cp = { x: c[0], y: c[1] };
  const s = trimmed(p, cp, nodeR.value + 2);
  const e = trimmed(q, cp, nodeR.value + 4);
  return { p0: [s.x, s.y], c, p1: [e.x, e.y] };
}

function pointAt(r: Shape, s: number) {
  const u = 1 - s;
  return {
    x: u * u * r.p0[0] + 2 * u * s * r.c[0] + s * s * r.p1[0],
    y: u * u * r.p0[1] + 2 * u * s * r.c[1] + s * s * r.p1[1],
  };
}

const routes = computed<Route[]>(() => {
  const t = vNow.value;
  const map = new Map<string, Route>();
  for (const { ev, atV } of visualEvents.value) {
    if (atV > t) break;
    const live = playing.value && atV > t - pulseWindow.value;
    for (const toKey of ev.toKeys) {
      const key = `${ev.fromKey}>${toKey}>${ev.edge}`;
      const existing = map.get(key);
      if (existing) {
        existing.ev = ev;
        existing.count++;
        existing.ids.push(ev.id);
        existing.live ||= live;
        continue;
      }
      const shape = curve(ev.fromKey, toKey, ev.edge);
      if (!shape) continue;
      map.set(key, {
        key,
        ev,
        count: 1,
        ids: [ev.id],
        d: `M${shape.p0[0]},${shape.p0[1]} Q${shape.c[0]},${shape.c[1]} ${shape.p1[0]},${shape.p1[1]}`,
        // Off-centre, so badges on opposite-direction routes do not stack.
        mid: pointAt(shape, 0.42),
        ...shape,
        live,
      });
    }
  }
  return [...map.values()];
});

/** Messages sent but not yet received at the playhead: a busy recipient's queue. */
const inFlight = computed(() => {
  const t = vNow.value;
  return visualEvents.value.flatMap(({ ev, atV, deliveries }) =>
    deliveries.flatMap((d) => {
      if (atV > t || d.atV <= t || d.atV - atV <= 0) return [];
      const shape = curve(ev.fromKey, d.toKey, ev.edge);
      if (!shape) return [];
      return [
        { key: `${ev.id}>${d.toKey}`, edge: ev.edge, ...pointAt(shape, (t - atV) / (d.atV - atV)) },
      ];
    }),
  );
});

const selectedRoute = computed(() =>
  props.selectedId
    ? routes.value.find((r) => r.ids.includes(props.selectedId as string))
    : undefined,
);

function selectRoute(r: Route) {
  emit("select", selectedRoute.value?.key === r.key ? null : r.ev.id);
}

// ── Controls ──
const eventTimes = computed(() => [...new Set(visualEvents.value.map((e) => e.atV))]);

function stepTo(direction: -1 | 1) {
  props.playback.pause();
  const t = vNow.value;
  const target =
    direction > 0
      ? eventTimes.value.find((v) => v > t + 1)
      : [...eventTimes.value].reverse().find((v) => v < t - 1);
  props.playback.seek(target ?? (direction > 0 ? vDuration.value : 0));
}

function onScrub(e: Event) {
  props.playback.pause();
  props.playback.seek(Number((e.target as HTMLInputElement).value));
}

const atEnd = computed(() => vNow.value >= vDuration.value);
const clock = computed(() => {
  const real = props.timeline.durationMs;
  return `${formatTimelineOffset(props.scale.toReal(vNow.value), real)} / ${formatTimelineOffset(real, real)}`;
});
const scrubStep = computed(() => Math.max(1, Math.round(vDuration.value / 1000)));
</script>

<template>
  <div ref="frame" class="comms-frame">
    <div class="graph-controls">
      <button type="button" class="graph-btn" aria-label="Previous exchange" title="Previous exchange" @click="stepTo(-1)">
        <ChevronLeft :size="14" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="graph-btn graph-btn--primary"
        :aria-label="playing ? 'Pause' : atEnd ? 'Replay from the start' : 'Play'"
        @click="playback.toggle()"
      >
        <Pause v-if="playing" :size="14" aria-hidden="true" />
        <RotateCcw v-else-if="atEnd" :size="14" aria-hidden="true" />
        <Play v-else :size="14" aria-hidden="true" />
        <span>{{ playing ? "Pause" : atEnd ? "Replay" : "Play" }}</span>
      </button>
      <button type="button" class="graph-btn" aria-label="Next exchange" title="Next exchange" @click="stepTo(1)">
        <ChevronRight :size="14" aria-hidden="true" />
      </button>
      <input
        id="comms-graph-scrubber"
        class="graph-scrubber"
        type="range"
        min="0"
        :max="vDuration"
        :step="scrubStep"
        :value="vNow"
        aria-label="Playhead"
        @input="onScrub"
      />
      <span class="graph-clock">{{ clock }}</span>
      <label class="graph-speed">
        <span class="sr-only">Playback speed</span>
        <select id="comms-graph-speed" v-model.number="speed">
          <option v-for="s in SPEEDS" :key="s" :value="s">{{ s }}×</option>
        </select>
      </label>
    </div>
    <div class="comms-scroll">
      <svg
        class="comms-svg"
        :class="{ 'comms-dimmed': !!selectedRoute }"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        role="group"
        aria-label="Agent communication graph"
      >
        <CommsMarkers :id-base="markerId" />
        <line
          v-for="l in treeLinks"
          :key="`tree-${l.key}`"
          class="graph-tree-link"
          :class="{ 'graph-tree-link--pending': !l.started }"
          :x1="l.x1"
          :y1="l.y1"
          :x2="l.x2"
          :y2="l.y2"
        />
        <g
          v-for="r in routes"
          :key="r.key"
          :class="[
            'comms-edge',
            `edge--${r.ev.edge}`,
            { 'comms-edge--selected': selectedRoute?.key === r.key, 'graph-edge--live': r.live },
          ]"
          role="button"
          tabindex="0"
          :aria-label="`${r.count} × ${eventSummary(timeline, r.ev)}`"
          @click="selectRoute(r)"
          @keydown.enter.prevent="selectRoute(r)"
          @keydown.space.prevent="selectRoute(r)"
        >
          <title>{{ r.count > 1 ? `${r.count} exchanges on this route. Latest:\n` : "" }}{{ eventSummary(timeline, r.ev) }}</title>
          <path class="comms-edge-hit" :d="r.d" />
          <path
            class="comms-edge-line"
            :d="r.d"
            :stroke-dasharray="edgeDash(r.ev)"
            :marker-end="`url(#${markerId}-${r.ev.edge})`"
            :style="{ strokeWidth: Math.min(6, 1.4 + r.count * 0.6) }"
          />
          <g v-if="r.count > 1">
            <circle class="graph-count-bg" :cx="r.mid.x" :cy="r.mid.y" r="9" />
            <text class="graph-count" :x="r.mid.x" :y="r.mid.y + 3.5" text-anchor="middle">{{ r.count }}</text>
          </g>
        </g>
        <circle
          v-for="m in inFlight"
          :key="m.key"
          :class="['graph-in-flight', `edge--${m.edge}`]"
          :cx="m.x"
          :cy="m.y"
          r="4"
        />
        <g
          v-for="n in nodes"
          :key="n.agent.key"
          :class="['graph-node', `graph-node--${n.state.phase}`]"
        >
          <title>{{ n.agent.name }} · {{ n.agent.isMain ? "main agent" : n.agent.type }} · {{ n.state.label }}</title>
          <circle
            class="graph-node-ring"
            :cx="n.x"
            :cy="n.y"
            :r="n.agent.isMain && radial ? 22 : nodeR"
            :style="{ stroke: n.color }"
          />
          <circle
            class="graph-node-core"
            :cx="n.x"
            :cy="n.y"
            :r="(n.agent.isMain && radial ? 22 : nodeR) * 0.36"
            :style="{ fill: n.color }"
          />
          <template v-if="showLabels || n.agent.isMain">
            <text class="graph-node-name" :x="n.x" :y="n.y + (n.agent.isMain && radial ? 22 : nodeR) + 16" text-anchor="middle">{{ n.label }}</text>
            <text class="graph-node-state" :x="n.x" :y="n.y + (n.agent.isMain && radial ? 22 : nodeR) + 30" text-anchor="middle">{{ n.state.label }}</text>
          </template>
        </g>
      </svg>
    </div>
    <p v-if="radial && !showLabels" class="graph-hint">
      {{ timeline.agents.length - 1 }} agents in launch order, clockwise from the top. Hover an agent for its name.
    </p>
  </div>
</template>

<style scoped>
.graph-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-muted);
}
.graph-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
}
.graph-btn:hover {
  color: var(--text-primary);
}
.graph-btn--primary {
  min-width: 84px;
  justify-content: center;
  border-color: var(--accent-muted);
  background: var(--accent-subtle);
  color: var(--text-primary);
}
.graph-btn:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}
.graph-scrubber {
  flex: 1 1 200px;
  min-width: 120px;
  accent-color: var(--accent-emphasis);
}
.graph-clock {
  min-width: 96px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.graph-speed select {
  padding: 2px 4px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
  color: var(--text-secondary);
  font-size: 0.75rem;
}
.graph-hint {
  margin: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--border-muted);
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}
.graph-tree-link {
  stroke: var(--border-default);
  stroke-width: 1;
}
.graph-tree-link--pending {
  stroke-dasharray: 3 4;
  opacity: 0.5;
}
.graph-count-bg {
  fill: var(--canvas-raised);
  stroke: var(--edge);
}
.comms-svg .graph-count {
  fill: var(--text-primary);
  font-size: 10px;
  font-weight: 600;
}
.graph-in-flight {
  fill: var(--edge);
  stroke: var(--canvas-subtle);
  stroke-width: 2;
}
.graph-node-ring {
  fill: var(--canvas-default);
  stroke-width: 2;
  transition: opacity var(--transition-fast, 120ms) ease;
}
.graph-node-core {
  transition: opacity var(--transition-fast, 120ms) ease;
}
.graph-node--pending .graph-node-ring {
  stroke-dasharray: 3 3;
  opacity: 0.4;
}
.graph-node--pending .graph-node-core {
  opacity: 0.15;
}
.graph-node--waiting .graph-node-core,
.graph-node--done .graph-node-core {
  opacity: 0.45;
}
.graph-node--working .graph-node-ring {
  stroke-width: 3;
}
.comms-svg .graph-node-name,
.comms-svg .graph-node-state {
  paint-order: stroke;
  stroke: var(--canvas-subtle);
  stroke-width: 4px;
  stroke-linejoin: round;
}
.comms-svg .graph-node-name {
  fill: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
}
.comms-svg .graph-node-state {
  fill: var(--text-tertiary);
  font-size: 10.5px;
}
.graph-node--working .graph-node-state {
  fill: var(--success-fg);
}
.graph-edge--live .comms-edge-line {
  animation: graph-flow 0.8s linear infinite;
  stroke-dasharray: 6 4;
}
@keyframes graph-flow {
  to {
    stroke-dashoffset: -20;
  }
}
@media (prefers-reduced-motion: reduce) {
  .graph-edge--live .comms-edge-line {
    animation: none;
    stroke-dasharray: none;
  }
  .graph-node-ring,
  .graph-node-core {
    transition: none;
  }
}
</style>
