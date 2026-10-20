<script setup lang="ts">
/**
 * The dashboard's five headline numbers, each with the context that makes it
 * readable: sessions (runs and active days), tokens (what they were), cost
 * (in USD, AI Credits at $0.01 each), model time (median and
 * p95) and errors (apart from rate limits, as the Incidents panel counts
 * them; the rate limits and the sessions affected beside them).
 */
import { type AnalyticsData, sourceLabel } from "@tracepilot/types";
import {
  formatAiCredits,
  formatAiCreditsUsd,
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
  countOf,
  type DashboardSummary,
} from "@/utils/analyticsSummary";
import { formatUsd } from "@/utils/sourceCost";

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
  note: string;
  partial: boolean;
  tooltip: string;
  meter: { key: string; color: string; width: number; title: string }[];
  /** Each source's share of a mixed total, one line each so none is cut off. */
  sources: { key: string; label: string; color: string; value: string; partial: boolean }[];
}

/**
 * Cost always reads in USD: Copilot's AI Credits at $0.01 each, Claude Code's
 * API-equivalent estimate, and the two added together when both are in range.
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
      sources: [],
    };
  }
  if (rows.length === 1 && rows[0].unit === "aic") {
    const credits = summary.credits;
    const copilot = rows[0];
    return {
      label: "Cost",
      value: formatAiCreditsUsd(credits.credits),
      note:
        credits.credits == null
          ? "No compatible pricing"
          : `${formatNumberFull(data.sessionsWithObservedAiCredits ?? 0)} of ${formatNumberFull(copilot.sessions)} observed`,
      partial: credits.isPartial,
      tooltip: `${aiCreditBasis(credits)}${credits.credits == null ? "" : ` ${formatAiCredits(credits.credits)} at $0.01 each.`}`,
      meter: [],
      sources: [],
    };
  }
  if (rows.length === 1) {
    const entry = data.costBySource?.find((e) => e.source === rows[0].source);
    const priced = entry
      ? `${formatNumberFull(entry.sessionsWithCostUsd)} of ${formatNumberFull(entry.sessions)} priced`
      : "";
    return {
      label: "Estimated cost",
      value: rows[0].usdEquivalent == null ? "—" : formatUsd(rows[0].usdEquivalent),
      note: `API-equivalent · ${priced}`,
      partial: rows[0].partial,
      tooltip: `API-equivalent USD from ${sourceLabel(rows[0].source)} usage.${rows[0].partial ? " Partial: some sessions could not be priced." : ""}`,
      meter: [],
      sources: [],
    };
  }
  const total = summary.costTotal;
  return {
    label: "Cost",
    value: total.usd == null ? "—" : formatUsd(total.usd),
    note: "",
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
              title: `${sourceLabel(row.source)}: ${formatUsd(row.usdEquivalent ?? 0)}`,
            }))
        : [],
    sources: rows.map((row) => ({
      key: row.source,
      label: sourceLabel(row.source),
      color: SOURCE_COLORS[row.source],
      value: row.usdEquivalent == null ? "unpriced" : formatUsd(row.usdEquivalent),
      partial: row.partial,
    })),
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
  <KPIRow class="ad-kpis" data-testid="analytics-kpis">
    <KPI label="Sessions" :value="formatNumberFull(data.totalSessions)">
      <template #icon><Layers :size="13" /></template>
      <template #footer>
        <div v-if="strip.length" class="ad-day-strip" aria-hidden="true">
          <i
            v-for="bar in strip"
            :key="bar.key"
            :class="{ 'ad-day-strip__zero': !bar.height }"
            :style="bar.height ? { height: `${bar.height}%` } : undefined"
            data-reveal="grow-y"
          />
        </div>
        <span class="ad-kpi-note">
          <!-- Runs count by the day they ended, so a session resumed after the range adds runs but no session. -->
          <template v-if="has || runs > 0">
            <b>{{ formatNumberFull(runs) }}</b> run{{ runs === 1 ? "" : "s" }} · active <b>{{ activeDays }}</b> of {{ rows.length }}
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
        <span class="ad-kpi-note">
          <template v-if="tokens.cacheShare"><b>{{ tokens.cacheShare }}</b> cache reads · {{ tokens.fresh }} fresh</template>
          <template v-else>No model usage</template>
        </span>
      </template>
    </KPI>

    <KPI :label="cost.label" :value="cost.value" :description="cost.tooltip || undefined">
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
        <ul v-if="cost.sources.length" class="ad-kpi-sources">
          <li v-for="part in cost.sources" :key="part.key">
            <i class="ad-sw" :style="{ background: part.color }" aria-hidden="true" />
            <span class="ad-kpi-sources__name">{{ part.label }}</span>
            <span class="ad-kpi-sources__value"><b>{{ part.value }}</b><span
              v-if="part.partial"
              class="ad-partial ad-kpi-sources__partial"
              title="Partly priced: some usage could not be priced"
            >*</span></span>
          </li>
        </ul>
        <span v-else class="ad-kpi-note" :title="cost.note">
          {{ cost.note }}<template v-if="cost.partial"> · <span class="ad-partial">partial</span></template>
        </span>
      </template>
    </KPI>

    <KPI label="Model time / session" :value="pace?.median ?? '—'">
      <template #icon><Timer :size="13" /></template>
      <template #footer>
        <span class="ad-kpi-note">
          <template v-if="pace && pace.timed >= 5">median · p95 <b>{{ pace.p95 }}</b> · {{ formatNumberFull(pace.timed) }} timed</template>
          <template v-else-if="pace">median of {{ pace.timed }} timed session{{ pace.timed === 1 ? "" : "s" }}</template>
          <template v-else>No model timing recorded</template>
        </span>
      </template>
    </KPI>

    <KPI
      label="Errors"
      :value="formatNumberFull(errors)"
      :description="has ? 'Errors apart from rate limits. Sessions affected had an error or a rate limit.' : undefined"
    >
      <template #icon><OctagonAlert :size="13" /></template>
      <template #footer>
        <span class="ad-kpi-note">
          <template v-if="errors + rateLimits > 0">
            <b>{{ formatNumberFull(rateLimits) }}</b> rate limit{{ rateLimits === 1 ? "" : "s" }} ·
            {{ countOf(data.sessionsWithErrors, "session") }} affected
          </template>
          <template v-else-if="has">No errors or rate limits</template>
          <template v-else>No incidents</template>
        </span>
      </template>
    </KPI>
  </KPIRow>
</template>
