<script setup lang="ts">
/**
 * Lanes: agents on a time axis, with each agent's lifespan and tool activity,
 * and arcs from sender to recipient. Distances are proportional to time,
 * except idle gaps (nothing recorded for over ten minutes), which collapse
 * to a marked break. When packed, agents that never overlap share a lane
 * and are named inside their bars, so the lane count is peak concurrency.
 * Zooming widens the plot; the lane labels stay in view while it scrolls.
 */
import type { CommsTimeline, CommsTimelineEvent, CommsTimeScale } from "@tracepilot/ui";
import { formatTimelineOffset, getAgentColor, packAgentLanes } from "@tracepilot/ui";
import { computed, ref, useId } from "vue";
import { useElementWidth } from "@/composables/useElementWidth";
import CommsMarkers from "./CommsMarkers.vue";
import { clipText, edgeDash, eventSummary, formatGap, timeTicks } from "./commsVisuals";

const props = defineProps<{
  timeline: CommsTimeline;
  events: CommsTimelineEvent[];
  scale: CommsTimeScale;
  packed: boolean;
  selectedId: string | null;
  focusKey: string | null;
}>();

const emit = defineEmits<{
  select: [id: string | null];
  focus: [key: string | null];
}>();

const LABEL_W = 176;
const ROW_H = 40;
const TOP = 28;
const RIGHT = 20;
const PAD = 8;
const CHAR_W = 6.5;
const ZOOMS = [1, 2, 4, 8, 16];
/** Above this many exchanges, arcs are drawn lighter so lifespans stay readable. */
const DENSE_EVENTS = 120;

const markerId = useId();
const frame = ref<HTMLElement | null>(null);
const frameWidth = useElementWidth(frame, 900);

const zoom = ref(1);

const agents = computed(() => props.timeline.agents);
/** Width of the time plot, right of the fixed lane labels. */
const width = computed(
  () => Math.max(460, Math.floor(frameWidth.value) - LABEL_W - 2) * zoom.value,
);
const dense = computed(() => props.events.length > DENSE_EVENTS);

/** Row per agent, or per shared lane when packed. */
const rowOf = computed(() =>
  props.packed ? packAgentLanes(agents.value) : new Map(agents.value.map((a, i) => [a.key, i])),
);
const rowCount = computed(() => Math.max(1, ...[...rowOf.value.values()].map((r) => r + 1)));
const height = computed(() => TOP + rowCount.value * ROW_H + 12);

function x(ms: number): number {
  const d = props.scale.durationMs;
  return PAD + (d > 0 ? props.scale.toVisual(ms) / d : 0) * (width.value - PAD - RIGHT);
}

function xVisual(visualMs: number): number {
  const d = props.scale.durationMs;
  return PAD + (d > 0 ? visualMs / d : 0) * (width.value - PAD - RIGHT);
}

function laneY(key: string): number {
  return TOP + (rowOf.value.get(key) ?? 0) * ROW_H + ROW_H / 2;
}

const ticks = computed(() => {
  const count = Math.max(3, Math.floor(width.value / 110));
  return timeTicks(props.scale.durationMs, count).map((v) => ({
    v,
    x: xVisual(v),
    label: formatTimelineOffset(props.scale.toReal(v), props.timeline.durationMs),
  }));
});

const breaks = computed(() =>
  props.scale.breaks.map((b) => ({
    x: xVisual(b.atVisualMs),
    w: Math.max(6, xVisual(b.atVisualMs + b.visualMs) - xVisual(b.atVisualMs)),
    label: `${formatGap(b.realMs)} idle`,
  })),
);

/** Row headers: each agent, or in packed mode the main agent and numbered lanes. */
const rowHeads = computed(() => {
  if (!props.packed) {
    return agents.value.map((a) => ({
      key: a.key,
      y: laneY(a.key),
      agentKey: a.key as string | null,
      color: getAgentColor(a.type),
      indent: 12 + a.depth * 14,
      label: clipText(a.name, Math.floor((LABEL_W - 36 - a.depth * 14) / CHAR_W)),
      title: `${a.name} · ${a.isMain ? "main agent" : a.type}`,
    }));
  }
  const counts = new Map<number, number>();
  for (const [, row] of rowOf.value) counts.set(row, (counts.get(row) ?? 0) + 1);
  const main = agents.value.find((a) => a.isMain);
  return [...counts.keys()]
    .sort((a, b) => a - b)
    .map((row) => {
      const isMain = row === 0 && !!main;
      const n = counts.get(row) ?? 0;
      return {
        key: `row-${row}`,
        y: TOP + row * ROW_H + ROW_H / 2,
        agentKey: isMain ? (main?.key ?? null) : null,
        color: isMain ? getAgentColor("main") : "var(--text-tertiary)",
        indent: 12,
        label: isMain
          ? (main?.name ?? "Main agent")
          : `Lane ${row} · ${n} ${n === 1 ? "agent" : "agents"}`,
        title: isMain ? "Main agent" : `${n} agents that never ran at the same time`,
      };
    });
});

const bars = computed(() => {
  const list = agents.value.map((a) => {
    const x1 = x(a.startMs);
    return {
      agent: a,
      y: laneY(a.key),
      x1,
      x2: Math.max(x1 + 2, x(a.endMs)),
      activity: [...new Set(a.activityMs.map((ms) => Math.round(x(ms))))],
      color: getAgentColor(a.type),
      label: "",
    };
  });
  if (props.packed) {
    // Name each bar in the room before the next bar in its lane.
    const byRow = new Map<number, typeof list>();
    for (const b of list) {
      const row = rowOf.value.get(b.agent.key) ?? 0;
      byRow.set(row, [...(byRow.get(row) ?? []), b]);
    }
    for (const [row, rowBars] of byRow) {
      if (row === 0) continue;
      rowBars.sort((a, b) => a.x1 - b.x1);
      rowBars.forEach((b, i) => {
        const room = (rowBars[i + 1]?.x1 ?? width.value - RIGHT) - b.x1 - 8;
        b.label = clipText(b.agent.name, Math.floor(room / CHAR_W));
      });
    }
  }
  return list;
});

const edges = computed(() =>
  props.events.map((ev) => {
    const x1 = x(ev.atMs);
    const y1 = laneY(ev.fromKey);
    const paths = ev.deliveries
      .filter((d) => d.toKey !== ev.fromKey && laneY(d.toKey) !== y1)
      .map((d) => {
        const y2 = laneY(d.toKey);
        // Keep simultaneous deliveries visibly directional.
        const x2 = Math.max(x(d.atMs), x1 + 6);
        const bend = Math.max(16, Math.abs(y2 - y1) * 0.35);
        const endY = y2 + (y2 > y1 ? -8 : 8);
        return {
          key: d.toKey,
          d: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${endY} ${x2},${endY}`,
        };
      });
    return {
      ev,
      x1,
      y1,
      paths,
      marker: `url(#${markerId}-${ev.comm.failed ? "failed" : ev.edge})`,
    };
  }),
);

function toggleSelect(id: string) {
  emit("select", props.selectedId === id ? null : id);
}

function toggleFocus(key: string | null) {
  if (key) emit("focus", props.focusKey === key ? null : key);
}
</script>

<template>
  <div ref="frame" class="comms-frame">
    <div class="lanes-toolbar">
      <span class="lanes-zoom-label" id="comms-lanes-zoom">Zoom</span>
      <div class="lanes-zoom" role="group" aria-labelledby="comms-lanes-zoom">
        <button
          v-for="z in ZOOMS"
          :key="z"
          type="button"
          class="comms-toggle"
          :aria-pressed="zoom === z"
          @click="zoom = z"
        >
          {{ z === 1 ? "Fit" : `${z}×` }}
        </button>
      </div>
      <span v-if="scale.breaks.length" class="lanes-note">
        {{ scale.breaks.length }} idle {{ scale.breaks.length === 1 ? "gap" : "gaps" }} collapsed
      </span>
    </div>
    <div class="comms-scroll">
      <div class="lanes-body">
      <svg class="comms-svg lanes-labels" :width="LABEL_W" :height="height" role="group" aria-label="Lanes">
          <g
            v-for="h in rowHeads"
            :key="h.key"
            class="lane-head"
            :class="{ 'lane-head--focused': !!h.agentKey && focusKey === h.agentKey, 'lane-head--static': !h.agentKey }"
            :role="h.agentKey ? 'button' : undefined"
            :tabindex="h.agentKey ? 0 : undefined"
            :aria-pressed="h.agentKey ? focusKey === h.agentKey : undefined"
            @click="toggleFocus(h.agentKey)"
            @keydown.enter.prevent="toggleFocus(h.agentKey)"
          >
            <title>{{ h.title }}</title>
            <rect class="lane-head-bg" x="4" :y="h.y - ROW_H / 2 + 4" :width="LABEL_W - 12" :height="ROW_H - 8" rx="6" />
            <circle :cx="h.indent" :cy="h.y" r="4" :style="{ fill: h.color }" />
            <text class="lane-name" :x="h.indent + 10" :y="h.y + 4">{{ h.label }}</text>
          </g>
      </svg>
      <svg
        class="comms-svg"
        :class="{ 'comms-dimmed': !!selectedId, 'lanes-dense': dense }"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        role="group"
        aria-label="Agent lanes with exchanges over time"
      >
        <CommsMarkers :id-base="markerId" />
        <g v-for="t in ticks" :key="t.v">
          <line class="comms-grid" :x1="t.x" :x2="t.x" :y1="TOP - 6" :y2="height - 8" />
          <text class="comms-axis-label" :x="t.x" :y="TOP - 12" text-anchor="middle">{{ t.label }}</text>
        </g>
        <g v-for="(b, i) in breaks" :key="`break-${i}`" class="lane-break">
          <title>{{ b.label }}: nothing was recorded, so the gap is collapsed</title>
          <rect :x="b.x" :y="TOP - 6" :width="b.w" :height="height - TOP - 2" />
          <text class="comms-axis-label" :x="b.x + b.w / 2" :y="height - 2" text-anchor="middle">{{ b.label }}</text>
        </g>

        <line
          v-for="h in rowHeads"
          :key="`grid-${h.key}`"
          class="comms-grid"
          :x1="0"
          :x2="width - RIGHT"
          :y1="h.y"
          :y2="h.y"
        />
        <g
          v-for="b in bars"
          :key="`bar-${b.agent.key}`"
          class="lane-bar"
          :class="{ 'lane-bar--focused': focusKey === b.agent.key }"
          @click="toggleFocus(b.agent.key)"
        >
          <title>{{ b.agent.name }} · {{ b.agent.isMain ? "main agent" : b.agent.type }}</title>
          <rect class="comms-lifespan" :x="b.x1" :y="b.y - 7" :width="b.x2 - b.x1" height="14" rx="4" :style="{ fill: b.color }" />
          <line
            v-for="ax in b.activity"
            :key="ax"
            class="comms-activity"
            :x1="ax"
            :x2="ax"
            :y1="b.y - 5"
            :y2="b.y + 5"
            :style="{ stroke: b.color }"
          />
          <text v-if="b.label" class="lane-bar-label" :x="b.x1 + 4" :y="b.y - 10">{{ b.label }}</text>
        </g>
        <g
          v-for="e in edges"
          :key="e.ev.id"
          :class="[
            'comms-edge',
            `edge--${e.ev.edge}`,
            { 'comms-edge--selected': selectedId === e.ev.id, 'comms-edge--failed': e.ev.comm.failed },
          ]"
          role="button"
          tabindex="0"
          :aria-label="eventSummary(timeline, e.ev)"
          :aria-pressed="selectedId === e.ev.id"
          @click="toggleSelect(e.ev.id)"
          @keydown.enter.prevent="toggleSelect(e.ev.id)"
          @keydown.space.prevent="toggleSelect(e.ev.id)"
        >
          <title>{{ eventSummary(timeline, e.ev) }}</title>
          <path v-for="p in e.paths" :key="`hit-${p.key}`" class="comms-edge-hit" :d="p.d" />
          <path
            v-for="p in e.paths"
            :key="p.key"
            class="comms-edge-line"
            :d="p.d"
            :stroke-dasharray="edgeDash(e.ev)"
            :marker-end="e.marker"
          />
          <circle class="comms-edge-dot" :cx="e.x1" :cy="e.y1" r="3" />
        </g>
      </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lanes-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-muted);
}
.lanes-zoom-label,
.lanes-note {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}
.lanes-zoom {
  display: flex;
  gap: 4px;
}
.lanes-note {
  margin-left: auto;
}
.lanes-body {
  display: flex;
  width: max-content;
}
.lanes-labels {
  position: sticky;
  left: 0;
  z-index: 1;
  flex: none;
  border-right: 1px solid var(--border-muted);
  background: var(--canvas-subtle);
}
.lanes-dense .comms-edge:not(.comms-edge--selected):not(:hover) .comms-edge-line {
  opacity: 0.45;
}
.lane-head {
  cursor: pointer;
}
.lane-head--static {
  cursor: default;
}
.lane-head-bg {
  fill: transparent;
}
.lane-head:not(.lane-head--static):hover .lane-head-bg {
  fill: var(--canvas-raised);
}
.lane-head--focused .lane-head-bg {
  fill: var(--accent-subtle);
  stroke: var(--accent-muted);
}
.lane-head:focus-visible {
  outline: 2px solid var(--accent-fg);
}
.comms-svg .lane-name {
  fill: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
}
.lane-head--static .lane-name {
  fill: var(--text-secondary);
  font-weight: 400;
}
.lane-bar {
  cursor: pointer;
}
.lane-bar--focused .comms-lifespan {
  opacity: 0.6;
}
.comms-svg .lane-bar-label {
  fill: var(--text-secondary);
  font-size: 10px;
}
.lane-break rect {
  fill: var(--canvas-default);
  stroke: var(--border-default);
  stroke-dasharray: 2 3;
}
</style>
