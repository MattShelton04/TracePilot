<script setup lang="ts">
/**
 * The Metrics tab's five headline numbers, each with the context that makes
 * it exact: cost and its basis, tokens and their kinds, requests per turn,
 * model time against wall time, and how much input the cache served.
 */
import { formatNumber, formatNumberFull, formatPercent } from "@tracepilot/types";
import { KPI, KPIRow } from "@tracepilot/ui";
import { Coins, Database, Layers, Timer, Zap } from "lucide-vue-next";
import { computed } from "vue";
import type { MetricsCostSummary } from "@/composables/useMetricsCost";
import { COMPOSITION } from "@/utils/analyticsSummary";
import type { MetricsTokenBreakdown } from "@/utils/metricsTokenBreakdown";
import { DURATION_HINTS, formatRecordedDuration } from "@/utils/sessionDurations";
import { formatUsd } from "@/utils/sourceCost";

const props = defineProps<{
  cost: MetricsCostSummary;
  tokens: MetricsTokenBreakdown;
  /** Recorded model requests (calls). */
  requests: number;
  turns: number;
  apiMs: number | null | undefined;
  /** The session's wall-clock span. */
  wallMs: number | null;
  /** Where the model time comes from, when the source says. */
  apiNote?: string | null;
}>();

const composition = computed(() => {
  const t = props.tokens;
  if (t.total == null || t.total === 0) return [];
  const fresh = t.uncached ?? (t.notCached != null ? t.notCached - (t.cacheWrite ?? 0) : null);
  const values = { cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, fresh, output: t.output };
  return COMPOSITION.filter((part) => (values[part.key] ?? 0) > 0).map((part) => ({
    ...part,
    width: ((values[part.key] ?? 0) / (t.total as number)) * 100,
    title: `${part.label}: ${formatNumberFull(values[part.key] ?? 0)}`,
  }));
});
const readShare = computed(() =>
  props.tokens.total && props.tokens.cacheRead != null
    ? (props.tokens.cacheRead / props.tokens.total) * 100
    : null,
);
const hitRate = computed(() =>
  props.tokens.cacheRatio == null ? null : props.tokens.cacheRatio * 100,
);
const perTurn = computed(() =>
  props.cost.usd != null && props.turns > 0 ? formatUsd(props.cost.usd / props.turns) : null,
);
/** A share too small for one decimal still isn't none, so it never reads "0%". */
function formatShare(percent: number): string {
  return percent > 0 && percent < 0.05 ? "<0.1%" : formatPercent(percent);
}
/** Parallel subagents can add up to more model time than the session lasted. */
const modelShare = computed(() =>
  props.apiMs && props.wallMs ? (props.apiMs / props.wallMs) * 100 : null,
);
</script>

<template>
  <KPIRow class="metrics-kpis" data-testid="metrics-kpis">
    <KPI label="Cost" :value="cost.value" :description="cost.coverage">
      <template #icon><Coins :size="13" /></template>
      <template #footer>
        <span class="kpi-note">
          <b>{{ cost.basis }}</b>
          <template v-if="cost.credits"> · {{ cost.credits }}</template>
          <template v-if="cost.lowerBound"> · <span class="warn">lower bound</span></template>
          <template v-else-if="cost.partial"> · <span class="warn">partial</span></template>
        </span>
        <span v-if="perTurn" class="kpi-note">{{ perTurn }} per turn</span>
      </template>
    </KPI>

    <KPI
      label="Tokens"
      :value="tokens.total == null ? '—' : formatNumber(tokens.total)"
      :description="tokens.total == null ? 'Some token counts were not recorded' : `${formatNumberFull(tokens.total)} tokens: input (cache reads, cache writes, fresh) plus output`"
    >
      <template #icon><Layers :size="13" /></template>
      <template #footer>
        <div v-if="composition.length" class="ad-meter" aria-hidden="true">
          <i v-for="part in composition" :key="part.key" :title="part.title" :style="{ width: `${part.width}%`, background: part.color }" data-reveal="grow-x" />
        </div>
        <span class="kpi-note">
          <template v-if="readShare != null"><b>{{ formatPercent(readShare) }}</b> cache reads · </template>
          {{ tokens.output == null ? "—" : formatNumber(tokens.output) }} output
        </span>
      </template>
    </KPI>

    <KPI label="Requests" :value="formatNumberFull(requests)" description="Model calls recorded for this session">
      <template #icon><Zap :size="13" /></template>
      <template #footer>
        <span class="kpi-note">
          <template v-if="turns > 0"><b>{{ (requests / turns).toFixed(1) }}</b> per turn</template>
          <template v-if="turns > 0 && requests > 0 && tokens.total != null"> · </template>
          <template v-if="requests > 0 && tokens.total != null">{{ formatNumber(Math.round(tokens.total / requests)) }} tokens each</template>
          <template v-if="!turns && !(requests > 0 && tokens.total != null)">No turns recorded</template>
        </span>
      </template>
    </KPI>

    <KPI
      label="Model time"
      :value="apiMs ? formatRecordedDuration(apiMs) : '—'"
      :description="apiNote ? `${DURATION_HINTS.apiTime} ${apiNote}` : DURATION_HINTS.apiTime"
    >
      <template #icon><Timer :size="13" /></template>
      <template #footer>
        <div v-if="modelShare != null" class="ad-meter" aria-hidden="true">
          <i :style="{ width: `${Math.min(100, modelShare)}%`, background: 'var(--chart-primary)' }" data-reveal="grow-x" />
        </div>
        <span class="kpi-note">
          <template v-if="modelShare == null">{{ apiMs ? "Session length unknown" : "No model timing recorded" }}</template>
          <template v-else-if="modelShare > 100"><b>{{ (modelShare / 100).toFixed(1) }}×</b> the {{ formatRecordedDuration(wallMs) }} session</template>
          <template v-else><b>{{ formatShare(modelShare) }}</b> of {{ formatRecordedDuration(wallMs) }} wall time</template>
        </span>
      </template>
    </KPI>

    <KPI label="Cache hit" :value="hitRate == null ? '—' : formatPercent(hitRate)" description="Input tokens read from the prompt cache, weighted by tokens">
      <template #icon><Database :size="13" /></template>
      <template #footer>
        <div v-if="hitRate != null" class="ad-meter" aria-hidden="true">
          <i :style="{ width: `${hitRate}%`, background: 'var(--success-fg)' }" data-reveal="grow-x" />
        </div>
        <span class="kpi-note">
          <template v-if="tokens.input != null">of <b>{{ formatNumber(tokens.input) }}</b> input tokens</template>
          <template v-else>Input not recorded</template>
        </span>
      </template>
    </KPI>
  </KPIRow>
</template>

<style scoped>
.metrics-kpis {
  border-color: var(--border-default);
  background: var(--border-default);
}

.metrics-kpis.kpi-row.kpi-row--wrap {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.metrics-kpis :deep(.kpi) {
  background: var(--canvas-subtle);
  padding: 14px 16px;
}

.metrics-kpis :deep(.kpi__footer) {
  gap: 6px;
}

/* Three over two when five readable footers no longer fit in a row. */
@container (max-width: 1000px) {
  .metrics-kpis.kpi-row.kpi-row--wrap {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .metrics-kpis :deep(.kpi) {
    grid-column: span 2;
  }

  .metrics-kpis :deep(.kpi:nth-child(n + 4)) {
    grid-column: span 3;
  }
}

/* Wraps to a second line rather than cutting a fact off at the default width. */
.kpi-note {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  min-width: 0;
  overflow: hidden;
}

.kpi-note b {
  font-weight: 500;
  color: var(--text-secondary);
}

.warn {
  color: var(--warning-fg);
}
</style>
