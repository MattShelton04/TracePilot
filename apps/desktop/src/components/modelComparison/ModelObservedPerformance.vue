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
import { Badge, ErrorAlert, SectionPanel, StatCard, Tooltip } from "@tracepilot/ui";
import { Info } from "lucide-vue-next";
import { computed } from "vue";
import { useObservedRequestPerformance } from "@/composables/useObservedRequestPerformance";
import {
  buildPerformanceRow,
  LATENCY_METRICS,
  OBSERVATIONAL_NOTE,
  type PerformanceRowView,
  POPULATION_NOTE,
} from "@/utils/requestPerformance";

const perf = useObservedRequestPerformance();

const ALL_MODELS = "All models";

/** The overall row first, then one per model, so a shape is easy to compare. */
const rows = computed<PerformanceRowView[]>(() => {
  const result: PerformanceRowView[] = [];
  if (perf.overall.value) {
    result.push(buildPerformanceRow(null, ALL_MODELS, perf.overall.value));
  }
  for (const entry of perf.byModel.value) {
    result.push(buildPerformanceRow(entry.model, entry.model, entry.performance));
  }
  return result;
});

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

      <div class="observed__table" tabindex="0" role="region" aria-label="Recorded latency by model">
        <table class="data-table observed__latencies">
          <thead>
            <tr>
              <th>Model</th>
              <th style="text-align: right">Requests</th>
              <th style="text-align: right">Sessions</th>
              <th v-for="metric in LATENCY_METRICS" :key="metric.key" style="text-align: right">
                <Tooltip :text="metric.note">
                  <span>{{ metric.label }}</span>
                </Tooltip>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.label"
              :class="{ 'observed__row--overall': row.model === null }"
              :data-testid="row.model === null ? 'observed-row-overall' : 'observed-row-model'"
            >
              <td>{{ row.label }}</td>
              <td style="text-align: right"><span class="tabular">{{ row.requestCount }}</span></td>
              <td style="text-align: right"><span class="tabular">{{ row.sessionCount }}</span></td>
              <td v-for="metric in row.metrics" :key="metric.key" style="text-align: right">
                <div class="observed__metric">
                  <span class="tabular observed__median">{{ metric.median }}</span>
                  <span
                    class="tabular"
                    :class="{ 'observed__suppressed': metric.p95Absence !== null }"
                    :title="
                      metric.p95Absence === 'belowThreshold'
                        ? 'p95 requires at least 20 valid samples.'
                        : undefined
                    "
                  >p95 {{ metric.p95Absence ? '—' : metric.p95 }}</span>
                  <span class="observed__coverage">{{ metric.coverageText }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="hasSuppressedP95" class="observed__muted" data-testid="observed-p95-reason">
        p95 requires at least 20 valid samples. A dash means the percentile is unavailable.
      </p>

      <h4 class="observed__subheading">Recorded cache reuse</h4>
      <p class="observed__note">
        Request share counts calls with any reuse; token share measures how much input was reused.
      </p>
      <div class="observed__table">
        <table class="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th style="text-align: right">
                <Tooltip text="Request-weighted: the share of requests that recorded at least one cache read.">
                  <span>Requests recording any reuse</span>
                </Tooltip>
              </th>
              <th style="text-align: right">
                <Tooltip text="Token-weighted: cache-read tokens as a share of input tokens.">
                  <span>Cache reads / input tokens</span>
                </Tooltip>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="`cache-${row.label}`"
              :class="{ 'observed__row--overall': row.model === null }"
            >
              <td>{{ row.label }}</td>
              <td style="text-align: right">
                <span class="tabular" :title="row.cache.requestWeighted.detail">
                  {{ row.cache.requestWeighted.value }}
                </span>
              </td>
              <td style="text-align: right">
                <span class="tabular" :title="row.cache.tokenWeighted.detail">
                  {{ row.cache.tokenWeighted.value }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
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
.observed__table {
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
.observed__latencies {
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
.observed__coverage {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.observed__suppressed {
  color: var(--text-tertiary);
}
.observed__row--overall td {
  background: var(--canvas-subtle);
  font-weight: 600;
}
.tabular {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
