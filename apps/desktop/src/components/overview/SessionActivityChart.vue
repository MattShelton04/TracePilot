<script setup lang="ts">
/**
 * When a session's turns happened: a histogram of turn starts across the
 * session, with resumes, incidents and file snapshots pinned above it at
 * the moment they occurred. Bars, pins and ticks share one coordinate
 * space (percent of the window), so a pin sits over the bar it fell in.
 */
import { Tooltip } from "@tracepilot/ui";
import { History, OctagonX, RotateCcw, Scissors, Shrink, TriangleAlert } from "lucide-vue-next";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { formatRecordedDuration } from "@/utils/sessionDurations";
import {
  type ActivityMarker,
  type ActivityMarkerKind,
  activityBinCount,
  activityWindow,
  binTurnStarts,
  clusterMarkers,
  formatClock,
  type MarkerCluster,
  spansDays,
  type TimeWindow,
} from "@/utils/sessionOverview";

const props = defineProps<{
  createdAt: string | null | undefined;
  updatedAt: string | null | undefined;
  /** Turn starts in Unix ms; `null` while they load. */
  turnStarts: (number | null)[] | null;
  loading: boolean;
  error: string | null;
  markers: ActivityMarker[];
  /** Stretches between runs when the session was not running. */
  gaps: TimeWindow[];
  running: boolean;
  isClaude: boolean;
}>();

const emit = defineEmits<{ select: [kind: ActivityMarkerKind] }>();

// Room each axis label needs, wider when labels carry a date.
const TICK_SPACING_PX = { clock: 110, dated: 170 };

const timedStarts = computed(() => (props.turnStarts ?? []).filter((t): t is number => t != null));

const timeWindow = computed(() =>
  activityWindow(
    props.createdAt ? Date.parse(props.createdAt) : null,
    props.updatedAt ? Date.parse(props.updatedAt) : null,
    props.turnStarts ?? [],
  ),
);

const binCount = computed(() => activityBinCount(timedStarts.value.length));
const binMs = computed(() =>
  timeWindow.value ? (timeWindow.value.end - timeWindow.value.start) / binCount.value : 0,
);
const counts = computed(() =>
  timeWindow.value ? binTurnStarts(timedStarts.value, timeWindow.value, binCount.value) : [],
);
const maxCount = computed(() => Math.max(1, ...counts.value));
const withDates = computed(() => (timeWindow.value ? spansDays(timeWindow.value) : false));

const bars = computed(() => {
  const w = timeWindow.value;
  if (!w) return [];
  return counts.value.map((count, i) => {
    const start = w.start + i * binMs.value;
    const mid = start + binMs.value / 2;
    const idle = props.gaps.some((g) => mid > g.start && mid < g.end);
    return {
      i,
      count,
      idle,
      left: (i / binCount.value) * 100,
      height: count ? Math.max(6, (count / maxCount.value) * 100) : 0,
      title: `${formatClock(start, withDates.value)} – ${formatClock(start + binMs.value, withDates.value)} · ${
        idle ? "not running" : `${count} turn${count === 1 ? "" : "s"}`
      }`,
    };
  });
});

const ticks = computed(() => {
  const w = timeWindow.value;
  if (!w) return [];
  const spacing = withDates.value ? TICK_SPACING_PX.dated : TICK_SPACING_PX.clock;
  const count = plotWidth.value
    ? Math.max(2, Math.min(5, Math.floor(plotWidth.value / spacing) + 1))
    : 5;
  return Array.from({ length: count }, (_, i) => {
    const t = w.start + ((w.end - w.start) * i) / (count - 1);
    const last = i === count - 1;
    return {
      pct: (i / (count - 1)) * 100,
      label: last && props.running ? "now" : formatClock(t, withDates.value),
      align: i === 0 ? "start" : last ? "end" : "middle",
    };
  });
});

// Pins closer than a pin and its count badge merge into one, so the
// merge distance follows the plot's width.
const PIN_SPACING_PX = 30;
const pinsEl = ref<HTMLElement | null>(null);
const plotWidth = ref(0);
let resizeObserver: ResizeObserver | null = null;
watch(pinsEl, (el) => {
  resizeObserver?.disconnect();
  if (!el || typeof ResizeObserver === "undefined") return;
  plotWidth.value = el.clientWidth;
  resizeObserver = new ResizeObserver(() => {
    plotWidth.value = el.clientWidth;
  });
  resizeObserver.observe(el);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

const clusters = computed<MarkerCluster[]>(() =>
  timeWindow.value
    ? clusterMarkers(
        props.markers,
        timeWindow.value,
        plotWidth.value ? (PIN_SPACING_PX / plotWidth.value) * 100 : undefined,
      )
    : [],
);

const MARKER_ICON = {
  error: OctagonX,
  warning: TriangleAlert,
  compaction: Shrink,
  truncation: Scissors,
  resume: RotateCcw,
  snapshot: History,
} as const;

function clusterText(cluster: MarkerCluster): string {
  const shown = cluster.markers
    .slice(0, 4)
    .map((m) => `${formatClock(m.at, withDates.value)} · ${m.label}`);
  const more = cluster.markers.length - shown.length;
  return more > 0 ? `${shown.join("; ")}; +${more} more` : shown.join("; ");
}

const summary = computed(() => {
  const w = timeWindow.value;
  const n = timedStarts.value.length;
  if (!w || n === 0) return null;
  const peak = counts.value.indexOf(Math.max(...counts.value));
  const minutes = (w.end - w.start) / 60_000;
  const perMinute = n / minutes;
  const pace =
    perMinute >= 0.1
      ? `${perMinute.toFixed(1)} turns/min`
      : perMinute * 60 >= 0.1
        ? `${(perMinute * 60).toFixed(1)} turns/hour`
        : `1 turn every ${formatRecordedDuration((w.end - w.start) / n)}`;
  const away = props.gaps.reduce((sum, g) => sum + (g.end - g.start), 0);
  return {
    busiest: formatClock(w.start + peak * binMs.value, withDates.value),
    busiestCount: counts.value[peak],
    pace,
    away: away > 0 ? formatRecordedDuration(away) : null,
  };
});

const ariaLabel = computed(() => {
  const s = summary.value;
  if (!s) return "No turn activity";
  return `Turn activity: ${timedStarts.value.length} turns, busiest at ${s.busiest} with ${s.busiestCount}, ${s.pace} on average.`;
});

// Only the kinds a pin shows; merged kinds are listed in the pin's tooltip.
const shownKinds = computed(() => new Set<ActivityMarkerKind>(clusters.value.map((c) => c.kind)));
const legend = computed(() =>
  (
    [
      ["resume", "Resumed"],
      ["error", "Error"],
      ["warning", "Warning"],
      ["compaction", "Compaction"],
      ["truncation", "Truncation"],
      ["snapshot", "File snapshot"],
    ] as const
  )
    .filter(([kind]) => shownKinds.value.has(kind))
    .map(([kind, label]) => ({ kind, label })),
);
</script>

<template>
  <div class="activity" :class="{ 'activity--claude': isClaude }" data-testid="session-activity">
    <p v-if="error" class="activity__note">Couldn't load turn activity: {{ error }}</p>
    <p v-else-if="!loading && turnStarts && timedStarts.length === 0" class="activity__note">
      {{ turnStarts.length === 0 ? "No turns recorded yet." : "These turns have no timestamps." }}
    </p>

    <div v-else class="activity__plot">
      <div ref="pinsEl" class="activity__pins">
        <span
          v-for="(cluster, i) in clusters"
          :key="`${cluster.kind}-${i}`"
          class="activity__pin-wrap"
          :style="{ left: `${cluster.pct}%` }"
        >
          <Tooltip :text="clusterText(cluster)">
            <button
              type="button"
              class="activity__pin"
              :class="`activity__pin--${cluster.kind}`"
              :aria-label="clusterText(cluster)"
              data-reveal="pop"
              @click="emit('select', cluster.kind)"
            >
              <component :is="MARKER_ICON[cluster.kind]" :size="10" :stroke-width="2.5" aria-hidden="true" />
              <span v-if="cluster.markers.length > 1" class="activity__pin-count">{{ cluster.markers.length }}</span>
            </button>
          </Tooltip>
        </span>
      </div>

      <div class="activity__bars" role="img" :aria-label="ariaLabel">
        <span
          v-for="cluster in clusters"
          :key="`guide-${cluster.pct}`"
          class="activity__guide"
          :class="`activity__guide--${cluster.kind}`"
          :style="{ left: `${cluster.pct}%` }"
          aria-hidden="true"
        />
        <template v-if="loading && !turnStarts">
          <span
            v-for="n in 32"
            :key="n"
            class="activity__bar activity__bar--loading"
            :style="{ left: `${((n - 1) / 32) * 100}%`, width: `calc(${100 / 32}% - 2px)`, height: `${20 + ((n * 37) % 60)}%` }"
            aria-hidden="true"
          />
        </template>
        <template v-else>
          <!-- Each bin is a full-height hover column, so short bars are easy to hit. -->
          <span
            v-for="bar in bars"
            :key="bar.i"
            class="activity__col"
            :style="{ left: `${bar.left}%`, width: `${100 / binCount}%` }"
          >
            <Tooltip :text="bar.title">
              <span
                class="activity__bar"
                :class="{ 'activity__bar--idle': bar.idle, 'activity__bar--empty': !bar.count && !bar.idle }"
                :style="{ height: bar.count ? `${bar.height}%` : undefined }"
                data-reveal="grow-y"
              />
            </Tooltip>
          </span>
        </template>
      </div>

      <div class="activity__axis" aria-hidden="true">
        <span
          v-for="tick in ticks"
          :key="tick.pct"
          class="activity__tick"
          :class="`activity__tick--${tick.align}`"
          :style="{ left: `${tick.pct}%` }"
        >{{ tick.label }}</span>
      </div>

      <div class="activity__footer">
        <span v-if="summary && summary.busiestCount > 1">Busiest <b>{{ summary.busiest }}</b> ({{ summary.busiestCount }} turns)</span>
        <span v-if="summary">Average <b>{{ summary.pace }}</b></span>
        <span v-if="summary?.away">Not running for <b>{{ summary.away }}</b></span>
        <span class="activity__legend">
          <span v-for="item in legend" :key="item.kind" class="activity__legend-item">
            <i :class="`activity__dot activity__dot--${item.kind}`" />{{ item.label }}
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity {
  --bar-color: var(--accent-fg);
}

.activity--claude {
  --bar-color: var(--claude-fg);
}

.activity__note {
  margin: 0;
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-tertiary);
}

.activity__pins {
  position: relative;
  height: 22px;
}

.activity__pin-wrap {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
}

.activity__pin {
  position: relative;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 2px solid var(--canvas-subtle);
  border-radius: 50%;
  color: var(--text-inverse);
  cursor: pointer;
}

.activity__pin-count {
  position: absolute;
  top: -6px;
  right: -9px;
  min-width: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  font: 600 9px/12px var(--font-mono);
}

.activity__pin--error,
.activity__dot--error {
  background: var(--danger-fg);
}
.activity__pin--warning,
.activity__dot--warning {
  background: var(--warning-fg);
}
.activity__pin--compaction,
.activity__pin--truncation,
.activity__dot--compaction,
.activity__dot--truncation {
  background: var(--attention-fg);
}
.activity__pin--resume,
.activity__dot--resume {
  background: var(--accent-fg);
}
.activity__pin--snapshot,
.activity__dot--snapshot {
  background: var(--done-fg);
}

.activity__bars {
  position: relative;
  height: 76px;
  border-bottom: 1px solid var(--border-default);
}

.activity__guide {
  position: absolute;
  top: -4px;
  bottom: 0;
  border-left: 1px dashed var(--border-emphasis);
  transform: translateX(-0.5px);
}

.activity__col {
  position: absolute;
  top: 0;
  bottom: 0;
}

.activity__col :deep(.tooltip) {
  width: 100%;
  height: 100%;
  align-items: flex-end;
}

.activity__bar {
  display: block;
  width: calc(100% - 2px);
  margin-left: 1px;
  border-radius: 2px 2px 0 0;
  background: var(--bar-color);
  opacity: 0.85;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.activity__col:hover .activity__bar {
  opacity: 1;
}

.activity__bar--empty {
  height: 2px;
  opacity: 0.2;
}

.activity__bar--idle {
  height: 0;
  border-bottom: 2px dashed var(--border-default);
  background: transparent;
  border-radius: 0;
}

.activity__bar--loading {
  position: absolute;
  bottom: 0;
  margin-left: 1px;
  background: var(--surface-tertiary);
  opacity: 0.5;
}

.activity__axis {
  position: relative;
  height: 18px;
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 16px;
  color: var(--text-tertiary);
}

.activity__tick {
  position: absolute;
  white-space: nowrap;
  transform: translateX(-50%);
}

.activity__tick--start {
  transform: none;
}

.activity__tick--end {
  transform: translateX(-100%);
}

.activity__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.activity__footer b {
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--text-primary);
}

.activity__legend {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-left: auto;
  color: var(--text-tertiary);
}

.activity__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.activity__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
</style>
