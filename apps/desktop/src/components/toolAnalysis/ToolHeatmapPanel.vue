<script setup lang="ts">
/**
 * When tools run: calls by local weekday and hour, with each weekday's and
 * each hour's total on the edges. Each cell shows its count when there is
 * room for it. Hovering a cell or an edge reads it out in
 * the footer; otherwise the footer names the busiest slot.
 */
import { formatNumberFull } from "@tracepilot/types";
import { computed, ref } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { type HeatmapEntry, localizeHeatmap } from "@/utils/analytics";
import { formatShare } from "@/utils/analyticsDashboard";
import { formatCellCount, HEAT_LEVELS, heatLevel, summarizeHeatmap } from "@/utils/toolAnalysis";

const props = defineProps<{ entries: readonly HeatmapEntry[] }>();

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const LEVELS = Array.from({ length: HEAT_LEVELS }, (_, i) => i + 1);

const summary = computed(() =>
  summarizeHeatmap(localizeHeatmap([...props.entries], -new Date().getTimezoneOffset())),
);
const maxDay = computed(() => Math.max(1, ...summary.value.dayTotals));
const maxHour = computed(() => Math.max(1, ...summary.value.hourTotals));

const hh = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const calls = (n: number) => `${formatNumberFull(n)} call${n === 1 ? "" : "s"}`;
const share = (n: number) =>
  summary.value.total ? formatShare((n / summary.value.total) * 100) : "0%";

type Hover = { day: number; hour: number } | { day: number } | { hour: number };
const hover = ref<Hover | null>(null);

const readout = computed(() => {
  const at = hover.value;
  const { grid, dayTotals, hourTotals } = summary.value;
  if (!at) return null;
  if ("day" in at && "hour" in at) {
    const n = grid[at.day][at.hour];
    return {
      title: `${DAYS[at.day]} ${hh(at.hour)}–${hh((at.hour + 1) % 24)}`,
      value: `${calls(n)} · ${share(n)}`,
    };
  }
  if ("day" in at) {
    return {
      title: DAY_NAMES[at.day],
      value: `${calls(dayTotals[at.day])} · ${share(dayTotals[at.day])}`,
    };
  }
  return {
    title: `${hh(at.hour)}–${hh((at.hour + 1) % 24)} across the week`,
    value: `${calls(hourTotals[at.hour])} · ${share(hourTotals[at.hour])}`,
  };
});

const ariaLabel = computed(() => {
  const { peak, weekdayShare, total } = summary.value;
  if (!peak) return "No tool calls by weekday and hour";
  return `Tool calls by weekday and hour, local time: ${formatNumberFull(total)} calls, busiest ${DAY_NAMES[peak.day]} at ${hh(peak.hour)} with ${formatNumberFull(peak.count)}, ${formatShare(weekdayShare * 100)} on weekdays`;
});
</script>

<template>
  <OverviewPanel title="When tools run" data-testid="tool-heatmap">
    <template #aside><span>Local time</span></template>

    <template v-if="summary.total > 0">
      <div class="tool-heat-wrap">
        <div class="tool-heat" role="img" :aria-label="ariaLabel" @mouseleave="hover = null">
          <span />
          <span v-for="hour in HOURS" :key="`h${hour}`" class="tool-heat__hour" aria-hidden="true">
            {{ hour % 3 === 0 ? String(hour).padStart(2, "0") : "" }}
          </span>
          <span />

          <template v-for="(row, day) in summary.grid" :key="DAYS[day]">
            <span class="tool-heat__day" aria-hidden="true">{{ DAYS[day] }}</span>
            <i
              v-for="hour in HOURS"
              :key="hour"
              class="tool-heat__cell"
              :class="{ 'tool-heat__cell--active': hover && 'hour' in hover && 'day' in hover && hover.day === day && hover.hour === hour }"
              :data-level="heatLevel(row[hour], summary.max)"
              @mouseenter="hover = { day, hour }"
            >{{ formatCellCount(row[hour]) }}</i>
            <span class="tool-heat__total" @mouseenter="hover = { day }">
              <span class="ad-track">
                <i
                  :style="{ width: `${(summary.dayTotals[day] / maxDay) * 100}%`, background: 'var(--chart-primary)' }"
                  data-reveal="grow-x"
                />
              </span>
            </span>
          </template>

          <span />
          <span
            v-for="hour in HOURS"
            :key="`t${hour}`"
            class="tool-heat__col"
            @mouseenter="hover = { hour }"
          >
            <i :style="{ height: `${(summary.hourTotals[hour] / maxHour) * 100}%` }" data-reveal="grow-y" />
          </span>
          <span />
        </div>
      </div>

      <div class="ad-foot">
        <template v-if="readout">
          <span><b class="tool-heat__readout">{{ readout.title }}</b> {{ readout.value }}</span>
        </template>
        <template v-else-if="summary.peak">
          <span>Busiest <b>{{ DAYS[summary.peak.day] }} {{ hh(summary.peak.hour) }}</b> ({{ formatNumberFull(summary.peak.count) }})</span>
          <span><b>{{ formatShare(summary.weekdayShare * 100) }}</b> on weekdays</span>
          <span v-if="summary.peakHour != null">Peak hour <b>{{ hh(summary.peakHour) }}</b></span>
        </template>
        <span class="ad-legend" aria-hidden="true">
          <span>
            Fewer
            <i v-for="level in LEVELS" :key="level" class="ad-sw tool-heat__cell" :data-level="level" />
            More
          </span>
        </span>
      </div>
    </template>
    <p v-else class="ad-empty">
      <b>No tool calls</b>
      Nothing ran in this range.
    </p>
  </OverviewPanel>
</template>

<style scoped>
.tool-heat-wrap {
  container-type: inline-size;
}

.tool-heat {
  display: grid;
  grid-template-columns: 32px repeat(24, minmax(0, 1fr)) minmax(40px, 64px);
  gap: 2px;
  align-items: center;
}

.tool-heat__hour {
  font: 11px / 16px var(--font-mono);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.tool-heat__day {
  font-size: 11px;
  line-height: 16px;
  color: var(--text-tertiary);
}

.tool-heat__cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--surface-secondary);
  font: normal 500 10px / 1 var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--text-secondary);
  white-space: nowrap;
}

.tool-heat__cell[data-level="4"],
.tool-heat__cell[data-level="5"] {
  color: var(--text-on-emphasis);
}

/* Under about 28px a cell, counts would clip: the hover readout carries them. */
@container (max-width: 760px) {
  .tool-heat__cell {
    font-size: 0;
  }
}

.tool-heat__cell[data-level="0"] {
  opacity: 0.5;
}

.tool-heat__cell[data-level="1"] {
  background: color-mix(in srgb, var(--chart-primary) 22%, var(--surface-secondary));
}

.tool-heat__cell[data-level="2"] {
  background: color-mix(in srgb, var(--chart-primary) 40%, var(--surface-secondary));
}

.tool-heat__cell[data-level="3"] {
  background: color-mix(in srgb, var(--chart-primary) 58%, var(--surface-secondary));
}

.tool-heat__cell[data-level="4"] {
  background: color-mix(in srgb, var(--chart-primary) 78%, var(--surface-secondary));
}

.tool-heat__cell[data-level="5"] {
  background: var(--chart-primary);
}

.tool-heat__cell--active {
  outline: 1px solid var(--text-primary);
  outline-offset: -1px;
}

.ad-legend .tool-heat__cell {
  height: 8px;
  margin: 0 1px;
}

.tool-heat__total {
  display: flex;
  align-items: center;
  height: 22px;
  padding-left: 6px;
}

.tool-heat__total .ad-track {
  flex: 1;
}

.tool-heat__col {
  display: flex;
  align-items: flex-end;
  height: 24px;
  margin-top: 4px;
}

.tool-heat__col i {
  display: block;
  width: 100%;
  min-height: 1px;
  border-radius: 2px 2px 0 0;
  background: var(--chart-primary);
  opacity: 0.85;
}

.tool-heat__total:hover .ad-track,
.tool-heat__col:hover i {
  opacity: 1;
  outline: 1px solid var(--text-secondary);
}

.tool-heat__readout {
  margin-right: 6px;
  font-family: var(--font-family);
}
</style>
