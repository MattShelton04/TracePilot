<script setup lang="ts">
/**
 * What went wrong: errors (rate limits apart), rate limits, compactions and
 * truncations. "Tiles" gives each a total with its rate and a strip of the
 * days it happened; "Chart" stacks them per day, as counts or per 100 runs.
 * Truncations are Copilot's alone, so they show only when Copilot is in range.
 */
import type { AnalyticsData, SessionSource } from "@tracepilot/types";
import { formatNumberFull } from "@tracepilot/types";
import { SegmentedControl } from "@tracepilot/ui";
import { Minimize2, OctagonX, Scissors, TriangleAlert } from "lucide-vue-next";
import { computed } from "vue";
import AnalyticsDayChart from "@/components/analytics/AnalyticsDayChart.vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useAnalyticsDashboardViews } from "@/composables/useAnalyticsDashboardViews";
import { binRows, type DayRow, type DaySeries } from "@/utils/analyticsDashboard";

const props = defineProps<{
  data: AnalyticsData;
  days: string[];
  sources: SessionSource[];
  rangeText: string;
}>();

const views = useAnalyticsDashboardViews();
const VIEWS = [
  { value: "tiles", label: "Tiles" },
  { value: "chart", label: "Chart" },
];
const SCALES = [
  { value: "count", label: "Count" },
  { value: "per100", label: "Per 100 runs" },
];
const view = computed({
  get: () => views.value.incidentsView,
  set: (value: string) => {
    views.value.incidentsView = value as "tiles" | "chart";
  },
});
const scale = computed({
  get: () => views.value.incidentsScale,
  set: (value: string) => {
    views.value.incidentsScale = value as "count" | "per100";
  },
});

const KINDS = [
  { key: "errors", label: "Errors", color: "var(--danger-fg)", icon: OctagonX },
  { key: "rateLimits", label: "Rate limits", color: "var(--warning-fg)", icon: TriangleAlert },
  { key: "compactions", label: "Compactions", color: "var(--chart-secondary)", icon: Minimize2 },
  { key: "truncations", label: "Truncations", color: "var(--neutral-emphasis)", icon: Scissors },
] as const;
type Kind = (typeof KINDS)[number]["key"];

const kinds = computed(() =>
  KINDS.filter((kind) => kind.key !== "truncations" || props.sources.includes("copilot")),
);

/** Per-day counts over the range, zero-filled; errors exclude rate limits. */
const perDay = computed(() => {
  const byDate = new Map((props.data.incidentsByDay ?? []).map((p) => [p.date, p]));
  const runs = new Map(props.data.activityPerDay.map((p) => [p.date, p.count]));
  return props.days.map((date) => {
    const p = byDate.get(date);
    return {
      date,
      runs: runs.get(date) ?? 0,
      errors: p ? Math.max(0, p.errors - p.rateLimits) : 0,
      rateLimits: p?.rateLimits ?? 0,
      compactions: p?.compactions ?? 0,
      truncations: p?.truncations ?? 0,
    };
  });
});

const totalRuns = computed(() => perDay.value.reduce((sum, d) => sum + d.runs, 0));
const per100 = (value: number) =>
  `${((value / Math.max(1, totalRuns.value)) * 100).toFixed(1)} per 100 runs`;

const tiles = computed(() =>
  kinds.value.map((kind) => {
    const total = perDay.value.reduce((sum, d) => sum + d[kind.key as Kind], 0);
    const rows: DayRow[] = perDay.value.map((d) => ({
      from: d.date,
      to: d.date,
      values: [d[kind.key as Kind]],
      runs: d.runs,
      errors: 0,
      rateLimits: 0,
    }));
    const bins = rows.length > 1 ? binRows(rows, 62) : [];
    const max = Math.max(1, ...bins.map((b) => b.values[0]));
    return {
      ...kind,
      total,
      detail: total
        ? `${kind.key === "errors" ? "excl. rate limits · " : ""}${per100(total)}`
        : "none",
      bars: bins.map((b) => ({
        key: b.from,
        height: b.values[0] ? Math.max(8, (b.values[0] / max) * 100) : 0,
      })),
    };
  }),
);

const hasAny = computed(() => tiles.value.some((tile) => tile.total > 0));

const chartSeries = computed<DaySeries[]>(() =>
  kinds.value.map((kind) => ({ key: kind.key, label: kind.label, color: kind.color })),
);
const chartRows = computed<DayRow[]>(() =>
  perDay.value.map((d) => {
    const k = scale.value === "per100" ? (d.runs ? 100 / d.runs : 0) : 1;
    return {
      from: d.date,
      to: d.date,
      values: kinds.value.map((kind) => d[kind.key as Kind] * k),
      runs: d.runs,
      errors: 0,
      rateLimits: 0,
    };
  }),
);
const chartFormat = computed(() =>
  scale.value === "per100"
    ? (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1))
    : formatNumberFull,
);
function chartDetail(row: DayRow): string[] {
  return [`${formatNumberFull(row.runs)} run${row.runs === 1 ? "" : "s"}`];
}
</script>

<template>
  <OverviewPanel title="Incidents" :flush="view === 'tiles' && data.totalSessions > 0" data-testid="analytics-incidents">
    <template #aside>
      <span v-if="view === 'tiles' && data.totalSessions > 0" class="incidents__aside">
        {{ formatNumberFull(data.sessionsWithErrors) }} session{{ data.sessionsWithErrors === 1 ? "" : "s" }} with errors
      </span>
      <SegmentedControl v-if="view === 'chart'" v-model="scale" class="ad-seg" :options="SCALES" aria-label="Incident scale" />
      <SegmentedControl v-model="view" class="ad-seg" :options="VIEWS" aria-label="Incidents view" />
    </template>

    <p v-if="data.totalSessions === 0" class="ad-empty">
      <b>No incidents</b>
      No sessions in {{ rangeText }}.
    </p>

    <div v-else-if="view === 'tiles'" class="ad-tiles incidents__tiles">
      <div v-for="tile in tiles" :key="tile.key" class="ad-tile" :data-kind="tile.key">
        <div class="ad-tile__label"><component :is="tile.icon" :size="13" aria-hidden="true" />{{ tile.label }}</div>
        <div class="ad-tile__value" :class="{ 'ad-tile__value--muted': !tile.total }">
          <span data-count-up>{{ formatNumberFull(tile.total) }}</span><small>{{ tile.detail }}</small>
        </div>
        <div v-if="tile.bars.length" class="incidents__bars" aria-hidden="true">
          <i
            v-for="bar in tile.bars"
            :key="bar.key"
            :class="{ 'incidents__bar--zero': !bar.height }"
            :style="bar.height ? { height: `${bar.height}%`, background: tile.color } : undefined"
            data-reveal="grow-y"
          />
        </div>
      </div>
    </div>

    <template v-else>
      <AnalyticsDayChart
        v-if="hasAny"
        :series="chartSeries"
        :rows="chartRows"
        :format="chartFormat"
        :integer="scale === 'count'"
        :detail="chartDetail"
        :height="170"
        :label="scale === 'per100' ? 'Incidents per 100 runs, by day' : 'Incidents by day'"
      />
      <div v-if="hasAny" class="ad-foot">
        <span class="ad-legend">
          <span v-for="tile in tiles.filter((t) => t.total)" :key="tile.key">
            <i class="ad-sw" :style="{ background: tile.color }" />{{ tile.label }} <b>{{ formatNumberFull(tile.total) }}</b>
          </span>
        </span>
      </div>
      <p v-else class="ad-empty">
        <b>Nothing went wrong</b>
        No errors, rate limits or compactions in {{ rangeText }}.
      </p>
    </template>
  </OverviewPanel>
</template>

<style scoped>
.incidents__tiles {
  flex: 1;
}

/* Three kinds (no Copilot in range) leave the last tile the full width. */
.incidents__tiles > .ad-tile:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

.incidents__bars {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 28px;
  margin-top: auto;
}

.incidents__bars i {
  flex: 1;
  min-width: 1px;
  border-radius: 1px 1px 0 0;
}

.incidents__bars i.incidents__bar--zero {
  height: 1px;
  background: var(--surface-tertiary);
}

.incidents__aside {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
