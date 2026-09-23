<script setup lang="ts">
/**
 * "Observed request performance" — recorded per-request latency and cache
 * reuse, read from the Copilot CLI's own session store.
 *
 * Deliberately a section of its own rather than extra columns in the
 * aggregate model table above: those figures are session roll-ups, these are
 * observations of individual API calls over a different population, and
 * merging them would invite an average of one to be read as the other.
 */
import {
  Badge,
  DataTable,
  type DataTableColumn,
  ErrorAlert,
  SectionPanel,
  StatCard,
  Tooltip,
} from "@tracepilot/ui";
import { Info } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useObservedRequestPerformance } from "@/composables/useObservedRequestPerformance";
import {
  buildPerformanceRow,
  type CacheReuseFigure,
  LATENCY_METRICS,
  type LatencyMetricView,
  OBSERVATIONAL_NOTE,
  type PerformanceRowView,
  POPULATION_NOTE,
} from "@/utils/requestPerformance";

const perf = useObservedRequestPerformance();

const ALL_MODELS = "All models";

type SortDirection = "ascending" | "descending";
type SortValue = (row: PerformanceRowView) => number | string | null;

/** Every sortable column's value; a missing figure sorts last either way. */
const SORT_VALUES: Record<string, SortValue> = {
  label: (row) => row.label,
  requestCount: (row) => row.requestCount,
  sessionCount: (row) => row.sessionCount,
  requestWeighted: (row) => row.cache.requestWeighted.ratio,
  tokenWeighted: (row) => row.cache.tokenWeighted.ratio,
  ...Object.fromEntries(
    LATENCY_METRICS.map((meta, index) => [
      meta.key,
      (row: PerformanceRowView) => row.metrics[index]?.medianMs ?? null,
    ]),
  ),
};

function compare(
  a: PerformanceRowView,
  b: PerformanceRowView,
  key: string,
  direction: SortDirection,
): number {
  const left = SORT_VALUES[key]?.(a) ?? null;
  const right = SORT_VALUES[key]?.(b) ?? null;
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  const order =
    typeof left === "string" ? left.localeCompare(String(right)) : left - (right as number);
  return direction === "ascending" ? order : -order;
}

/**
 * One sort per table. The default puts the largest samples on top: a model
 * with three requests says far less than one with hundreds.
 */
function useSort() {
  const key = ref("requestCount");
  const direction = ref<SortDirection>("descending");
  function toggle(next: string): void {
    if (key.value === next) {
      direction.value = direction.value === "ascending" ? "descending" : "ascending";
    } else {
      key.value = next;
      direction.value = next === "label" ? "ascending" : "descending";
    }
  }
  return { key, direction, toggle };
}

const modelRows = computed(() =>
  perf.byModel.value.map((entry) =>
    buildPerformanceRow(entry.model, entry.model, entry.performance),
  ),
);

/** The all-models row stays first; sorting orders the models beneath it. */
function sortedRows(sort: ReturnType<typeof useSort>): PerformanceRowView[] {
  const models = [...modelRows.value].sort(
    (a, b) => compare(a, b, sort.key.value, sort.direction.value) || a.label.localeCompare(b.label),
  );
  const overall = perf.overall.value;
  return overall ? [buildPerformanceRow(null, ALL_MODELS, overall), ...models] : models;
}

const latencySort = useSort();
const cacheSort = useSort();
const rows = computed(() => sortedRows(latencySort));
const latencyRows = computed(() => rows.value.map(tableRow));
const cacheRows = computed(() => sortedRows(cacheSort).map(tableRow));

const LATENCY_COLUMNS: DataTableColumn[] = [
  { key: "label", label: "Model", sortable: true },
  { key: "requestCount", label: "Requests", align: "right", sortable: true },
  { key: "sessionCount", label: "Sessions", align: "right", sortable: true },
  ...LATENCY_METRICS.map((metric) => ({
    key: metric.key,
    label: metric.label,
    title: `${metric.note} Sorts by median.`,
    align: "right" as const,
    sortable: true,
  })),
];

const CACHE_COLUMNS: DataTableColumn[] = [
  { key: "label", label: "Model", sortable: true },
  {
    key: "requestWeighted",
    label: "Requests recording any reuse",
    title: "Request-weighted: the share of requests that recorded at least one cache read.",
    align: "right",
    sortable: true,
  },
  {
    key: "tokenWeighted",
    label: "Cache reads / input tokens",
    title: "Token-weighted: cache-read tokens as a share of input tokens.",
    align: "right",
    sortable: true,
  },
];

const CACHE_KEYS = ["requestWeighted", "tokenWeighted"];

/** A `DataTable` row: the view itself, with each figure under its column key. */
function tableRow(row: PerformanceRowView): Record<string, unknown> {
  return {
    ...row,
    ...Object.fromEntries(row.metrics.map((metric) => [metric.key, metric])),
    requestWeighted: row.cache.requestWeighted,
    tokenWeighted: row.cache.tokenWeighted,
  };
}

function overallClass(row: Record<string, unknown>): string | undefined {
  return row.model === null ? "observed__row--overall" : undefined;
}

const hasSuppressedP95 = computed(() =>
  rows.value.some((row) => row.metrics.some((metric) => metric.p95Absence === "belowThreshold")),
);

const inconsistentTotal = computed(() =>
  rows.value
    .filter((row) => row.model !== null)
    .reduce((total, row) => total + row.cache.inconsistentRows, 0),
);
</script>

<template>
  <SectionPanel
    v-if="perf.enabled.value"
    title="Observed request performance"
    data-testid="observed-request-performance"
  >
    <template #actions>
      <Badge variant="neutral">Observational</Badge>
      <Tooltip :text="OBSERVATIONAL_NOTE">
        <button
          type="button"
          aria-label="About observed request performance"
          class="text-[var(--text-tertiary)]"
        >
          <Info :size="14" />
        </button>
      </Tooltip>
    </template>

    <p class="observed__note" data-testid="observed-disclaimer">{{ OBSERVATIONAL_NOTE }}</p>
    <p v-if="perf.report.value?.stale" class="observed__attention" data-testid="observed-stale">
      Cached observations. The latest refresh could not confirm this data; retry from Settings.
    </p>

    <ErrorAlert
      v-if="perf.error.value"
      :message="perf.error.value"
      retryable
      variant="compact"
      @retry="perf.retry"
    />

    <p v-else-if="perf.loading.value && !perf.loaded.value" class="observed__muted">
      Reading recorded requests…
    </p>

    <p v-else-if="!perf.available.value" class="observed__muted" data-testid="observed-unavailable">
      No session store could be read, so there are no recorded requests to compare. This says
      nothing about how many requests were made.
    </p>

    <p
      v-else-if="perf.emptyForFilters.value"
      class="observed__muted"
      data-testid="observed-empty"
    >
      The session store was read and no recorded requests match the selected repository and date
      range.
    </p>

    <template v-else>
      <div class="observed__stats">
        <StatCard
          :value="rows[0]?.requestCount ?? 0"
          label="Requests sampled"
          tooltip="Individual recorded API calls, not sessions or turns."
          mini
        />
        <StatCard
          :value="perf.sessionCount.value"
          label="Sessions represented"
          tooltip="How many sessions supplied these requests. A low count means one session can dominate the shape."
          mini
        />
        <StatCard
          :value="perf.byModel.value.length"
          label="Models compared"
          mini
        />
      </div>

      <p class="observed__note">{{ POPULATION_NOTE }}</p>

      <DataTable
        class="observed__latencies"
        :columns="LATENCY_COLUMNS"
        :rows="latencyRows"
        row-key="label"
        :row-class="overallClass"
        :sort-key="latencySort.key.value"
        :sort-direction="latencySort.direction.value"
        style="overflow-x: auto"
        data-testid="observed-latency-table"
        @sort="latencySort.toggle"
      >
        <template #cell-requestCount="{ value }">
          <span class="tabular">{{ value }}</span>
        </template>
        <template #cell-sessionCount="{ value }">
          <span class="tabular">{{ value }}</span>
        </template>
        <template v-for="meta in LATENCY_METRICS" :key="meta.key" #[`cell-${meta.key}`]="{ value }">
          <div class="observed__metric">
            <span class="tabular observed__median">{{ (value as LatencyMetricView).median }}</span>
            <span
              class="tabular observed__p95"
              :class="{ observed__suppressed: (value as LatencyMetricView).p95Absence !== null }"
              :title="
                (value as LatencyMetricView).p95Absence === 'belowThreshold'
                  ? 'p95 requires at least 20 valid samples.'
                  : undefined
              "
            >p95 {{ (value as LatencyMetricView).p95Absence ? '—' : (value as LatencyMetricView).p95 }}</span>
            <span class="observed__coverage">{{ (value as LatencyMetricView).coverageText }}</span>
          </div>
        </template>
      </DataTable>

      <p v-if="hasSuppressedP95" class="observed__muted" data-testid="observed-p95-reason">
        p95 requires at least 20 valid samples. A dash means the percentile is unavailable.
      </p>

      <h4 class="observed__subheading">Recorded cache reuse</h4>
      <p class="observed__note">
        Request share counts calls with any reuse; token share measures how much input was reused.
      </p>
      <DataTable
        :columns="CACHE_COLUMNS"
        :rows="cacheRows"
        row-key="label"
        :row-class="overallClass"
        :sort-key="cacheSort.key.value"
        :sort-direction="cacheSort.direction.value"
        style="overflow-x: auto"
        data-testid="observed-cache-table"
        @sort="cacheSort.toggle"
      >
        <template v-for="key in CACHE_KEYS" :key="key" #[`cell-${key}`]="{ value }">
          <span class="tabular" :title="(value as CacheReuseFigure).detail">
            {{ (value as CacheReuseFigure).value }}
          </span>
        </template>
      </DataTable>
      <p v-if="inconsistentTotal > 0" class="observed__attention" data-testid="observed-inconsistent">
        {{ inconsistentTotal }} request(s) recorded more cache reads than input tokens and are
        excluded from these figures rather than clamped.
      </p>
    </template>
  </SectionPanel>
</template>

<style scoped>
.observed__note {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.observed__muted {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-top: 8px;
}
.observed__attention {
  font-size: 0.75rem;
  color: var(--attention-fg);
  margin-top: 8px;
}
.observed__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.observed__latencies :deep(table) {
  min-width: 1000px;
}
.observed__median {
  font-weight: 600;
}
.observed__subheading {
  margin: 20px 0 8px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}
.observed__metric {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.observed__p95 {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--text-secondary);
}
.observed__coverage {
  font-weight: 400;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.observed__suppressed {
  color: var(--text-tertiary);
}
:deep(.observed__row--overall) td {
  background: var(--canvas-subtle);
  font-weight: 600;
}
.tabular {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
