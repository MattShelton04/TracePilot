<script setup lang="ts">
/**
 * How long sessions wait on the model, and the pace of the work: the five
 * recorded statistics of model time on one log axis (the spread is often
 * seconds to hours), then turns, tool calls, tokens per turn and throughput.
 */
import type { AnalyticsData } from "@tracepilot/types";
import { formatDuration, formatNumber, formatNumberFull } from "@tracepilot/types";
import { Tooltip } from "@tracepilot/ui";
import { Gauge, MessageSquare, Timer, Wrench, Zap } from "lucide-vue-next";
import { computed, ref } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useElementWidth } from "@/composables/useElementWidth";
import { durationStrip } from "@/utils/analyticsDashboard";

const props = defineProps<{ data: AnalyticsData }>();

const MARK_COLORS: Record<string, string> = {
  min: "var(--text-tertiary)",
  median: "var(--accent-fg)",
  avg: "var(--chart-secondary)",
  p95: "var(--warning-fg)",
  max: "var(--text-tertiary)",
};

const stats = computed(() => {
  const value = props.data.apiDurationStats;
  return value && value.totalSessionsWithDuration > 0 ? value : null;
});

// Labels this many pixels apart share a row; closer ones alternate rows.
// The wrapper is always rendered, so its width is known before any data.
const LABEL_PX = 88;
const stripEl = ref<HTMLElement | null>(null);
const stripWidth = useElementWidth(stripEl, 800);

const marks = computed(() =>
  stats.value
    ? durationStrip(stats.value, (LABEL_PX / Math.max(1, stripWidth.value)) * 100).map((mark) => ({
        ...mark,
        color: MARK_COLORS[mark.key],
        text: formatDuration(mark.ms) || "0s",
      }))
    : [],
);
const band = computed(() => {
  const median = marks.value.find((mark) => mark.key === "median");
  const p95 = marks.value.find((mark) => mark.key === "p95");
  return median && p95 ? { left: median.pct, width: Math.max(0, p95.pct - median.pct) } : null;
});

const tiles = computed(() => {
  const p = props.data.productivityMetrics;
  return [
    {
      key: "turns",
      icon: MessageSquare,
      label: "Turns / session",
      value: p.avgTurnsPerSession.toFixed(1),
      detail: "sessions with turns",
    },
    {
      key: "tools",
      icon: Wrench,
      label: "Tool calls / turn",
      value: p.avgToolCallsPerTurn.toFixed(1),
      detail: "across all turns",
    },
    {
      key: "tokens",
      icon: Zap,
      label: "Tokens / turn",
      value: formatNumber(Math.round(p.avgTokensPerTurn)),
      detail: "incl. cache reads",
    },
    {
      key: "speed",
      icon: Gauge,
      label: "Output speed",
      value: formatNumber(Math.round(p.avgTokensPerApiSecond)),
      detail: "output tokens per model second",
    },
  ];
});
</script>

<template>
  <OverviewPanel title="Model time & pace" flush data-testid="analytics-pace">
    <div ref="stripEl" class="pace__strip-wrap">
      <div class="ad-tile__label">
        <Timer :size="13" aria-hidden="true" />Model time per session
        <span v-if="stats" class="ad-tile__aside">
          {{ formatNumberFull(stats.totalSessionsWithDuration) }} of {{ formatNumberFull(data.totalSessions) }} sessions timed · log scale
        </span>
      </div>
      <div v-if="stats" class="pace__strip" role="img" :aria-label="marks.map((m) => `${m.label} ${m.text}`).join(', ')">
        <div class="pace__axis" />
        <span
          v-if="band"
          class="pace__band"
          :style="{ left: `${band.left}%`, width: `${band.width}%` }"
          data-reveal="grow-x"
        >
          <Tooltip text="Half of timed sessions run longer than the median; one in twenty longer than p95">
            <span class="pace__band-hit" />
          </Tooltip>
        </span>
        <template v-for="mark in marks" :key="mark.key">
          <span class="pace__tick" :style="{ left: `${mark.pct}%`, background: mark.color }" data-reveal="pop" />
          <span
            class="pace__label"
            :class="{ 'pace__label--start': mark.pct < 4, 'pace__label--end': mark.pct > 96 }"
            :style="{ left: `${mark.pct}%`, top: `${34 + mark.row * 14}px` }"
          >{{ mark.label }} <b>{{ mark.text }}</b></span>
        </template>
      </div>
      <p v-else class="ad-note pace__none">No session in this range recorded model time.</p>
    </div>
    <div class="ad-tiles ad-tiles--4 pace__tiles">
      <div v-for="tile in tiles" :key="tile.key" class="ad-tile">
        <div class="ad-tile__label"><component :is="tile.icon" :size="13" aria-hidden="true" />{{ tile.label }}</div>
        <div class="ad-tile__value" data-count-up>{{ data.totalSessions ? tile.value : "—" }}</div>
        <div class="ad-tile__detail">{{ tile.detail }}</div>
      </div>
    </div>
  </OverviewPanel>
</template>

<style scoped>
.pace__strip-wrap {
  padding: 14px 16px 10px;
}

.pace__strip {
  position: relative;
  height: 62px;
  margin: 6px 12px 0;
}

.pace__axis {
  position: absolute;
  left: 0;
  right: 0;
  top: 20px;
  height: 1px;
  background: var(--border-default);
}

.pace__band {
  position: absolute;
  top: 12px;
  height: 16px;
  border: 1px solid var(--border-accent);
  border-radius: 3px;
  background: var(--accent-muted);
}

.pace__band :deep(.tooltip),
.pace__band-hit {
  display: block;
  width: 100%;
  height: 100%;
}

.pace__tick {
  position: absolute;
  top: 8px;
  width: 2px;
  height: 24px;
  margin-left: -1px;
  border-radius: 1px;
}

.pace__label {
  position: absolute;
  transform: translateX(-50%);
  font: 10px/12px var(--font-mono);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.pace__label--start {
  transform: none;
}

.pace__label--end {
  transform: translateX(-100%);
}

.pace__label b {
  font-weight: 500;
  color: var(--text-primary);
}

.pace__none {
  padding: 12px 0 4px;
}

.pace__tiles {
  border-top: 1px solid var(--border-muted);
}

@container (max-width: 760px) {
  .pace__tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
