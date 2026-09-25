<script setup lang="ts">
/**
 * Sequence diagram: one column per agent, one row per exchange, arrows from
 * sender to recipients. Time runs down the page on a compressed scale that
 * passes through each exchange's row, so bursts get room and quiet stretches
 * collapse. A message that waited for a busy recipient arrives on its
 * lifeline at send time and waits there (dotted) until it was picked up.
 * When packed, agents that never overlap share a column and are named at
 * the top of their lifespans.
 */
import type { CommsTimeline, CommsTimelineEvent } from "@tracepilot/ui";
import { formatTimelineOffset, getAgentColor, packAgentLanes } from "@tracepilot/ui";
import { computed, ref, useId } from "vue";
import { useElementWidth } from "@/composables/useElementWidth";
import CommsMarkers from "./CommsMarkers.vue";
import { clipText, edgeDash, eventSummary } from "./commsVisuals";

const props = defineProps<{
  timeline: CommsTimeline;
  events: CommsTimelineEvent[];
  packed: boolean;
  selectedId: string | null;
  focusKey: string | null;
}>();

const emit = defineEmits<{
  select: [id: string | null];
  focus: [key: string | null];
}>();

const MIN_COL_W = 140;
const MAX_COL_W = 280;
const GUTTER = 64;
const ROW_H = 30;
const TOP = 16;
const BOTTOM = 20;

const markerId = useId();
const frame = ref<HTMLElement | null>(null);
const frameWidth = useElementWidth(frame, 900);

const agents = computed(() => props.timeline.agents);

/** Column per agent, or per shared lane when packed. */
const colOf = computed(() =>
  props.packed ? packAgentLanes(agents.value) : new Map(agents.value.map((a, i) => [a.key, i])),
);

const columns = computed(() => {
  if (!props.packed) {
    return agents.value.map((a) => ({
      key: a.key,
      agentKey: a.key as string | null,
      name: a.name,
      sub: a.isMain ? "main" : a.type,
      color: getAgentColor(a.type),
    }));
  }
  const members = new Map<number, string[]>();
  for (const a of agents.value) {
    const col = colOf.value.get(a.key) ?? 0;
    members.set(col, [...(members.get(col) ?? []), a.name]);
  }
  return [...members.keys()]
    .sort((a, b) => a - b)
    .map((col) => {
      const main = col === 0 ? agents.value.find((a) => a.isMain) : undefined;
      const n = members.get(col)?.length ?? 0;
      return main
        ? {
            key: main.key,
            agentKey: main.key as string | null,
            name: main.name,
            sub: "main",
            color: getAgentColor("main"),
          }
        : {
            key: `col-${col}`,
            agentKey: null,
            name: `Lane ${col}`,
            sub: `${n} ${n === 1 ? "agent" : "agents"}`,
            color: "var(--text-tertiary)",
          };
    });
});

// Columns share the frame, within limits; many agents scroll sideways.
const colW = computed(() =>
  Math.min(
    MAX_COL_W,
    Math.max(
      MIN_COL_W,
      Math.floor((frameWidth.value - GUTTER - 8) / Math.max(1, columns.value.length)),
    ),
  ),
);
const width = computed(() => GUTTER + columns.value.length * colW.value + 8);
const height = computed(() => TOP + Math.max(1, props.events.length) * ROW_H + BOTTOM);
const colX = computed(
  () =>
    new Map(
      agents.value.map((a) => [
        a.key,
        GUTTER + (colOf.value.get(a.key) ?? 0) * colW.value + colW.value / 2,
      ]),
    ),
);

function rowY(index: number): number {
  return TOP + ROW_H / 2 + index * ROW_H;
}

/** Time → y anchors: the top, each exchange's row, then the bottom. */
const anchors = computed<Array<[number, number]>>(() => {
  const list: Array<[number, number]> = [[0, TOP]];
  props.events.forEach((ev, i) => {
    list.push([ev.atMs, rowY(i)]);
  });
  const lastAt = props.events[props.events.length - 1]?.atMs ?? 0;
  list.push([Math.max(props.timeline.durationMs, lastAt), height.value - BOTTOM]);
  return list;
});

function timeY(ms: number): number {
  const list = anchors.value;
  const [firstMs, firstY] = list[0] ?? [0, TOP];
  if (ms <= firstMs) return firstY;
  // First anchor at or after `ms`; anchors are in time order.
  let lo = 1;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as [number, number])[0] < ms) lo = mid + 1;
    else hi = mid;
  }
  const [t1, y1] = list[lo] as [number, number];
  if (ms > t1) return y1;
  const [t0, y0] = list[lo - 1] as [number, number];
  return t1 === t0 ? y0 : y0 + ((ms - t0) / (t1 - t0)) * (y1 - y0);
}

const lifespans = computed(() =>
  agents.value.map((a) => {
    const x = colX.value.get(a.key) ?? 0;
    const y1 = timeY(a.startMs);
    const y2 = Math.max(y1 + 2, timeY(a.endMs));
    // One tick per pixel row is enough; busy agents make hundreds of calls.
    const ticks = [...new Set(a.activityMs.map((ms) => Math.round(timeY(ms))))];
    const label = props.packed && !a.isMain ? clipText(a.name, 22) : "";
    return { agent: a, x, y1, y2, ticks, color: getAgentColor(a.type), label };
  }),
);

interface SequenceEdge {
  ev: CommsTimelineEvent;
  y: number;
  fromX: number;
  paths: Array<{ key: string; d: string }>;
  /** A queued message waiting on the recipient's lifeline until it was picked up. */
  waits: Array<{ key: string; x: number; y1: number; y2: number }>;
  label?: { x: number; y: number; text: string; anchor: "start" | "middle" | "end" };
  marker: string;
}

const edges = computed<SequenceEdge[]>(() =>
  props.events.map((ev, i) => {
    const y = rowY(i);
    const fromX = colX.value.get(ev.fromKey) ?? GUTTER;
    const paths: SequenceEdge["paths"] = [];
    const waits: SequenceEdge["waits"] = [];
    for (const d of ev.deliveries) {
      const toX = colX.value.get(d.toKey) ?? fromX;
      if (toX === fromX) {
        paths.push({ key: d.toKey, d: `M${fromX},${y} c24,0 24,12 6,12` });
        continue;
      }
      paths.push({ key: d.toKey, d: `M${fromX},${y} L${toX + (toX > fromX ? -7 : 7)},${y}` });
      // A queued message always shows its wait, however compressed that stretch is.
      const y2 = d.queued ? Math.max(y + 12, timeY(d.atMs)) : timeY(d.atMs);
      // Beside the lifespan bar, on the side the message arrived from.
      const side = toX > fromX ? -9 : 9;
      if (d.queued || y2 - y >= ROW_H / 2) waits.push({ key: d.toKey, x: toX + side, y1: y, y2 });
    }
    const firstTo = colX.value.get(ev.toKeys[0] ?? "") ?? fromX;
    const rightward = firstTo >= fromX;
    let label: SequenceEdge["label"];
    if (ev.comm.scope || ev.toKeys.length > 1) {
      label = {
        x: fromX + (rightward ? 8 : -8),
        y: y - 6,
        text: ev.comm.scope ? `all ${ev.comm.scope}` : `${ev.toKeys.length} agents`,
        anchor: rightward ? "start" : "end",
      };
    } else {
      const span = Math.abs(firstTo - fromX);
      const text = clipText(ev.comm.content, Math.floor((span - 16) / 6));
      if (span >= 100 && text)
        label = { x: (fromX + firstTo) / 2, y: y - 6, text, anchor: "middle" };
    }
    return {
      ev,
      y,
      fromX,
      paths,
      waits,
      label,
      marker: `url(#${markerId}-${ev.comm.failed ? "failed" : ev.edge})`,
    };
  }),
);

/** Offsets in the gutter, skipping repeats so bursts read as one moment. */
const timeLabels = computed(() => {
  let previous = "";
  return props.events.flatMap((ev, i) => {
    const text = formatTimelineOffset(ev.atMs, props.timeline.durationMs);
    if (text === previous) return [];
    previous = text;
    return [{ y: rowY(i), text }];
  });
});

function toggleSelect(id: string) {
  emit("select", props.selectedId === id ? null : id);
}

function toggleFocus(key: string) {
  emit("focus", props.focusKey === key ? null : key);
}
</script>

<template>
  <div ref="frame" class="comms-frame">
    <div class="comms-scroll">
      <div class="seq-header" :style="{ minWidth: `${width}px`, paddingLeft: `${GUTTER}px` }">
        <template v-for="c in columns" :key="c.key">
          <button
            v-if="c.agentKey"
            type="button"
            class="comms-agent-head"
            :class="{ 'comms-agent-head--focused': focusKey === c.agentKey }"
            :style="{ width: `${colW}px` }"
            :aria-pressed="focusKey === c.agentKey"
            :title="focusKey === c.agentKey ? 'Show every agent' : `Show only exchanges involving ${c.name}`"
            @click="toggleFocus(c.agentKey)"
          >
            <span class="seq-head-name">
              <span class="seq-dot" :style="{ background: c.color }" aria-hidden="true" />
              {{ c.name }}
            </span>
            <span class="seq-head-type">{{ c.sub }}</span>
          </button>
          <div
            v-else
            class="comms-agent-head comms-agent-head--static"
            :style="{ width: `${colW}px` }"
            title="Agents that never ran at the same time share this column"
          >
            <span class="seq-head-name seq-head-name--lane">{{ c.name }}</span>
            <span class="seq-head-type">{{ c.sub }}</span>
          </div>
        </template>
      </div>
      <svg
        class="comms-svg"
        :class="{ 'comms-dimmed': !!selectedId }"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        role="group"
        aria-label="Sequence diagram of agent exchanges"
      >
        <CommsMarkers :id-base="markerId" />
        <text
          v-for="t in timeLabels"
          :key="`t-${t.y}`"
          class="comms-axis-label"
          :x="GUTTER - 12"
          :y="t.y + 3"
          text-anchor="end"
        >{{ t.text }}</text>
        <line
          v-for="(c, i) in columns"
          :key="`life-${c.key}`"
          class="comms-lifeline"
          :x1="GUTTER + i * colW + colW / 2"
          :x2="GUTTER + i * colW + colW / 2"
          :y1="TOP - 8"
          :y2="height - BOTTOM + 8"
        />
        <g
          v-for="l in lifespans"
          :key="l.agent.key"
          :class="{ 'seq-lifespan--focused': focusKey === l.agent.key }"
          @click="packed && toggleFocus(l.agent.key)"
        >
          <title v-if="packed">{{ l.agent.name }} · {{ l.agent.isMain ? "main agent" : l.agent.type }}</title>
          <rect class="comms-lifespan" :x="l.x - 5" :y="l.y1" width="10" :height="l.y2 - l.y1" rx="3" :style="{ fill: l.color }" />
          <text v-if="l.label" class="seq-lifespan-label" :x="l.x + 9" :y="l.y1 + 9">{{ l.label }}</text>
          <line
            v-for="y in l.ticks"
            :key="y"
            class="comms-activity"
            :x1="l.x - 5"
            :x2="l.x + 5"
            :y1="y"
            :y2="y"
            :style="{ stroke: l.color }"
          />
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
          <g v-for="w in e.waits" :key="`wait-${w.key}`">
            <line class="seq-wait" :x1="w.x" :x2="w.x" :y1="w.y1" :y2="w.y2" />
            <circle class="comms-edge-dot" :cx="w.x" :cy="w.y2" r="3" />
          </g>
          <circle v-if="e.paths.length > 1" class="comms-edge-dot" :cx="e.fromX" :cy="e.y" r="3.5" />
          <text
            v-if="e.label"
            class="comms-msg-label"
            :x="e.label.x"
            :y="e.label.y"
            :text-anchor="e.label.anchor"
          >{{ e.label.text }}</text>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.seq-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  box-sizing: border-box;
  padding-block: 8px;
  border-bottom: 1px solid var(--border-muted);
  background: var(--canvas-subtle);
}
.seq-wait {
  stroke: var(--edge);
  stroke-width: 2;
  stroke-dasharray: 1 4;
  stroke-linecap: round;
}
.comms-agent-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
}
.comms-agent-head:hover {
  background: var(--canvas-raised);
}
.comms-agent-head--focused {
  border-color: var(--accent-muted);
  background: var(--accent-subtle);
}
.seq-head-name {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.75rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seq-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}
.comms-agent-head--static {
  cursor: default;
}
.comms-agent-head--static:hover {
  background: transparent;
}
.seq-head-name--lane {
  color: var(--text-secondary);
  font-weight: 500;
}
.comms-svg .seq-lifespan-label {
  fill: var(--text-secondary);
  font-size: 10px;
  paint-order: stroke;
  stroke: var(--canvas-subtle);
  stroke-width: 3px;
  cursor: pointer;
}
.seq-lifespan--focused .comms-lifespan {
  opacity: 0.6;
}
.seq-head-type {
  color: var(--text-tertiary);
  font-size: 0.625rem;
}
</style>
