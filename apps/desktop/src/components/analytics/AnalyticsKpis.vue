<script setup lang="ts">
/**
 * The dashboard's five headline numbers, each with the context that makes it
 * readable: sessions (runs and active days), tokens (what they were), cost
 * (in its source's unit, or every source in USD), model time (median and
 * p95) and errors (rate limits and sessions hit).
 */
import { type AnalyticsData, sourceLabel } from "@tracepilot/types";
import {
  formatAiCredits,
  formatCost,
  formatDuration,
  formatNumber,
  formatNumberFull,
  KPI,
  KPIRow,
} from "@tracepilot/ui";
import { Coins, Layers, OctagonAlert, Timer, Zap } from "lucide-vue-next";
import { computed } from "vue";
import { binRows, type DayRow, formatShare, SOURCE_COLORS } from "@/utils/analyticsDashboard";
import {
  aiCreditBasis,
  COMPOSITION,
  costBreakdown,
  type DashboardSummary,
} from "@/utils/analyticsSummary";

const props = defineProps<{
  data: AnalyticsData;
  summary: DashboardSummary;
  /** Zero-filled days of the range; their runs and incidents. */
  rows: DayRow[];
}>();

const has = computed(() => props.data.totalSessions > 0);
const runs = computed(() => props.rows.reduce((sum, row) => sum + row.runs, 0));
const activeDays = computed(() => props.rows.filter((row) => row.runs > 0).length);
const errors = computed(() => props.rows.reduce((sum, row) => sum + row.errors, 0));
const rateLimits = computed(() => props.rows.reduce((sum, row) => sum + row.rateLimits, 0));

/** Runs per day, merged into weeks or more once the range is long. */
const strip = computed(() => {
  if (props.rows.length < 3) return [];
  const bins = binRows(props.rows, 46);
  const max = Math.max(1, ...bins.map((row) => row.runs));
  return bins.map((row) => ({
    key: row.from,
    height: row.runs ? Math.max(12, (row.runs / max) * 100) : 0,
  }));
});

const tokens = computed(() => {
  const parts = props.summary.composition;
  return {
    meter: COMPOSITION.filter((part) => parts[part.key] > 0).map((part) => ({
      ...part,
      width: (parts[part.key] / parts.total) * 100,
      title: `${part.label}: ${formatNumber(parts[part.key])}`,
    })),
    cacheShare: parts.total ? formatShare((parts.cacheRead / parts.total) * 100) : null,
    fresh: formatNumber(parts.fresh),
  };
});

interface CostKpi {
  label: string;
  value: string;
  unit?: string;
  note: string;
  partial: boolean;
  tooltip: string;
  meter: { key: string; color: string; width: number; title: string }[];
}

/**
 * Copilot alone reads in AI Credits; Claude Code alone in its API-equivalent
 * estimate; together, every source adds up in USD with AI Credits at $0.01.
 */
const cost = computed<CostKpi>(() => {
  const { summary, data } = props;
  const rows = summary.costRows.filter((row) => row.sessions > 0);
  if (!has.value || rows.length === 0) {
    return {
      label: "Cost",
      value: "—",
      note: "No usage in this range",
      partial: false,
      tooltip: "",
      meter: [],
    };
  }
  if (summary.inAiCredits) {
    const credits = summary.credits;
    const copilot = rows[0];
    const value = formatAiCredits(credits.credits);
    return {
      label: "AI Credits",
      value: value.replace(/ AIC$/, ""),
      unit: credits.credits == null ? undefined : "AIC",
      note:
        credits.usdEquivalent == null
          ? "No compatible pricing"
          : `≈ ${formatCost(credits.usdEquivalent)} · ${formatNumberFull(data.sessionsWithObservedAiCredits ?? 0)} of ${formatNumberFull(copilot.sessions)} observed`,
      partial: credits.isPartial,
      tooltip: aiCreditBasis(credits),
      meter: [],
    };
  }
  if (rows.length === 1) {
    const entry = data.costBySource?.find((e) => e.source === rows[0].source);
    const priced = entry
      ? `${formatNumberFull(entry.sessionsWithCostUsd)} of ${formatNumberFull(entry.sessions)} priced`
      : "";
    return {
      label: "Estimated cost",
      value: rows[0].usdEquivalent == null ? "—" : formatCost(rows[0].usdEquivalent),
      note: `API-equivalent · ${priced}`,
      partial: rows[0].partial,
      tooltip: `API-equivalent USD from ${sourceLabel(rows[0].source)} usage.${rows[0].partial ? " Partial: some sessions could not be priced." : ""}`,
      meter: [],
    };
  }
  const total = summary.costTotal;
  return {
    label: "Cost",
    value: total.usd == null ? "—" : formatCost(total.usd),
    note: rows
      .map(
        (row) =>
          `${sourceLabel(row.source)} ${row.usdEquivalent == null ? "unpriced" : formatCost(row.usdEquivalent)}`,
      )
      .join(" · "),
    partial: total.partial,
    tooltip: `${costBreakdown(rows)}. AI Credits count at $0.01 each.${total.partial ? " Partial: some usage could not be priced." : ""}`,
    meter:
      total.usd && total.usd > 0
        ? rows
            .filter((row) => (row.usdEquivalent ?? 0) > 0)
            .map((row) => ({
              key: row.source,
              color: SOURCE_COLORS[row.source],
              width: ((row.usdEquivalent ?? 0) / (total.usd ?? 1)) * 100,
              title: `${sourceLabel(row.source)}: ${formatCost(row.usdEquivalent)}`,
            }))
        : [],
  };
});

const pace = computed(() => {
  const stats = props.data.apiDurationStats;
  if (!stats || stats.totalSessionsWithDuration === 0) return null;
  return {
    median: formatDuration(stats.medianMs) || "—",
    p95: formatDuration(stats.p95Ms) || "—",
    timed: stats.totalSessionsWithDuration,
  };
});
</script>

<template>
  <KPIRow class="analytics-kpis" data-testid="analytics-kpis">
    <KPI label="Sessions" :value="formatNumberFull(data.totalSessions)">
      <template #icon><Layers :size="13" /></template>
      <template #footer>
        <div v-if="strip.length" class="day-strip" aria-hidden="true">
          <i
            v-for="bar in strip"
            :key="bar.key"
            :class="{ 'day-strip__zero': !bar.height }"
            :style="bar.height ? { height: `${bar.height}%` } : undefined"
            data-reveal="grow-y"
          />
        </div>
        <span class="kpi-note">
          <template v-if="has">
            <b>{{ formatNumberFull(runs) }}</b> runs · active <b>{{ activeDays }}</b> of {{ rows.length }}
            day{{ rows.length === 1 ? "" : "s" }}
          </template>
          <template v-else>No sessions in this range</template>
        </span>
      </template>
    </KPI>

    <KPI label="Tokens" :value="formatNumber(data.totalTokens)">
      <template #icon><Zap :size="13" /></template>
      <template #footer>
        <div v-if="tokens.meter.length" class="ad-meter" aria-hidden="true">
          <i
            v-for="part in tokens.meter"
            :key="part.key"
            :title="part.title"
            :style="{ width: `${part.width}%`, background: part.color }"
            data-reveal="grow-x"
          />
        </div>
        <span class="kpi-note">
          <template v-if="tokens.cacheShare"><b>{{ tokens.cacheShare }}</b> cache reads · {{ tokens.fresh }} fresh</template>
          <template v-else>No model usage</template>
        </span>
      </template>
    </KPI>

    <KPI :label="cost.label" :value="cost.value" :unit="cost.unit" :description="cost.tooltip || undefined">
      <template #icon><Coins :size="13" /></template>
      <template #footer>
        <div v-if="cost.meter.length" class="ad-meter" aria-hidden="true">
          <i
            v-for="part in cost.meter"
            :key="part.key"
            :title="part.title"
            :style="{ width: `${part.width}%`, background: part.color }"
            data-reveal="grow-x"
          />
        </div>
        <span class="kpi-note" :title="cost.note">
          {{ cost.note }}<template v-if="cost.partial"> · <span class="ad-partial">partial</span></template>
        </span>
      </template>
    </KPI>

    <KPI label="Model time / session" :value="pace?.median ?? '—'">
      <template #icon><Timer :size="13" /></template>
      <template #footer>
        <span class="kpi-note">
          <template v-if="pace && pace.timed >= 5">median · p95 <b>{{ pace.p95 }}</b> · {{ formatNumberFull(pace.timed) }} timed</template>
          <template v-else-if="pace">median of {{ pace.timed }} timed session{{ pace.timed === 1 ? "" : "s" }}</template>
          <template v-else>No model timing recorded</template>
        </span>
      </template>
    </KPI>

    <KPI label="Errors" :value="formatNumberFull(errors + rateLimits)">
      <template #icon><OctagonAlert :size="13" /></template>
      <template #footer>
        <span class="kpi-note">
          <template v-if="errors + rateLimits > 0">
            <b>{{ formatNumberFull(rateLimits) }}</b> rate limits · in {{ formatNumberFull(data.sessionsWithErrors) }}
            session{{ data.sessionsWithErrors === 1 ? "" : "s" }}
          </template>
          <template v-else-if="has">No errors or rate limits</template>
          <template v-else>No incidents</template>
        </span>
      </template>
    </KPI>
  </KPIRow>
</template>

<style scoped>
.analytics-kpis {
  border-color: var(--border-default);
  background: var(--border-default);
}

.analytics-kpis.kpi-row.kpi-row--wrap {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.analytics-kpis :deep(.kpi) {
  background: var(--canvas-subtle);
  padding: 14px 16px;
}

.analytics-kpis :deep(.kpi__footer) {
  gap: 6px;
}

/* Two columns, the last tile full width, when five footers no longer fit. */
@container (max-width: 1000px) {
  .analytics-kpis.kpi-row.kpi-row--wrap {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analytics-kpis :deep(.kpi:last-child) {
    grid-column: 1 / -1;
  }
}

.kpi-note {
  display: block;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.kpi-note b {
  font-weight: 500;
  color: var(--text-secondary);
}

.day-strip {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
}

.day-strip i {
  flex: 1;
  min-width: 1px;
  border-radius: 1px;
  background: var(--chart-primary);
  opacity: 0.85;
}

.day-strip i.day-strip__zero {
  height: 2px;
  background: var(--surface-tertiary);
  opacity: 1;
}
</style>
