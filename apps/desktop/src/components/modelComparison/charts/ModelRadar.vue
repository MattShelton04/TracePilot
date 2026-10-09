<script setup lang="ts">
import { computed } from "vue";
import { type AxisRank, radarPoint, rankRadius } from "@/composables/modelComparison/charts";

export interface RadarSeries {
  id: string;
  color: string;
  ranks: (AxisRank | null)[];
  /** `ghost` draws a dashed outline only, for a comparison overlay. */
  style?: "solid" | "ghost";
}

const props = withDefaults(
  defineProps<{
    size: number;
    axes: readonly string[];
    series: RadarSeries[];
    /** Space reserved around the radar for axis labels. */
    labelGutter?: number;
    fontSize?: number;
    highlight?: string | null;
  }>(),
  { labelGutter: 46, fontSize: 10, highlight: null },
);

const emit = defineEmits<{
  vertex: [event: PointerEvent, seriesId: string, axis: number];
  leave: [];
}>();

const RINGS = [0.25, 0.5, 0.75, 1];

const geo = computed(() => {
  const center = { x: props.size / 2, y: props.size / 2 + 2 };
  const radius = Math.max(20, props.size / 2 - props.labelGutter);
  const n = props.axes.length;
  const at = (axis: number, r: number) => radarPoint(axis, n, center, radius * r);
  const ring = (r: number) =>
    props.axes
      .map((_, i) => at(i, 0.14 + 0.86 * r))
      .map((p) => `${p.x},${p.y}`)
      .join(" ");
  const labels = props.axes.map((text, i) => {
    const p = radarPoint(i, n, center, radius + 10);
    const dx = p.x - center.x;
    const anchor = Math.abs(dx) < 4 ? "middle" : dx > 0 ? "start" : "end";
    const dy = p.y < center.y - radius * 0.5 ? -2 : p.y > center.y + radius * 0.5 ? 9 : 4;
    return { text, x: p.x, y: p.y + dy, anchor };
  });
  const shapes = props.series.map((s) => {
    const points = s.ranks.map((rank, i) => ({ ...at(i, rankRadius(rank)), ranked: rank != null }));
    return { s, points, path: points.map((p) => `${p.x},${p.y}`).join(" ") };
  });
  return { center, radius, at, ring, labels, shapes };
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="`0 0 ${size} ${size}`"
    class="model-radar"
    @pointerleave="emit('leave')"
  >
    <g class="model-chart-grid">
      <polygon
        v-for="r in RINGS"
        :key="r"
        :points="geo.ring(r)"
        fill="none"
        :class="{ 'model-radar-median': r === 0.5 }"
      />
      <line
        v-for="(_, i) in axes"
        :key="`a${i}`"
        :x1="geo.center.x"
        :y1="geo.center.y"
        :x2="geo.at(i, 1).x"
        :y2="geo.at(i, 1).y"
      />
    </g>
    <text
      v-for="l in geo.labels"
      :key="l.text"
      :x="l.x"
      :y="l.y"
      :text-anchor="l.anchor"
      :font-size="fontSize"
      class="model-radar-axis-label"
    >{{ l.text }}</text>
    <g
      data-reveal="scale-view"
      :style="{ '--reveal-origin': `${geo.center.x}px ${geo.center.y}px` }"
    >
      <g
        v-for="shape in geo.shapes"
        :key="shape.s.id"
        class="model-radar-series"
        :class="{ dimmed: highlight != null && highlight !== shape.s.id }"
      >
        <polygon
          :points="shape.path"
          :fill="shape.s.style === 'ghost' ? 'none' : shape.s.color"
          :fill-opacity="shape.s.style === 'ghost' ? 0 : 0.16"
          :stroke="shape.s.style === 'ghost' ? 'var(--text-secondary)' : shape.s.color"
          :stroke-width="shape.s.style === 'ghost' ? 1.5 : 2"
          :stroke-dasharray="shape.s.style === 'ghost' ? '4 3' : undefined"
          stroke-linejoin="round"
        />
        <template v-if="shape.s.style !== 'ghost'">
          <circle
            v-for="(p, i) in shape.points"
            :key="i"
            :cx="p.x"
            :cy="p.y"
            r="3.5"
            :fill="p.ranked ? shape.s.color : 'var(--canvas-subtle)'"
            :stroke="p.ranked ? 'var(--canvas-subtle)' : 'var(--text-tertiary)'"
            stroke-width="1.5"
          />
        </template>
      </g>
    </g>
    <!-- Generous hit targets over each vertex. -->
    <template v-for="shape in geo.shapes" :key="`hit-${shape.s.id}`">
      <template v-if="shape.s.style !== 'ghost'">
        <circle
          v-for="(p, i) in shape.points"
          :key="i"
          :cx="p.x"
          :cy="p.y"
          r="11"
          fill="transparent"
          class="model-radar-hit"
          @pointermove="emit('vertex', $event, shape.s.id, i)"
        />
      </template>
    </template>
  </svg>
</template>
