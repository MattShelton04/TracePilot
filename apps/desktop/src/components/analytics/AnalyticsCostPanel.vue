<script setup lang="ts">
/**
 * What the range cost. "By source" gives each source a card in its own unit
 * (AI Credits for Copilot, API-equivalent USD for Claude Code) with how much
 * of it is observed or priced; "Running total" draws the spend accumulating
 * across the range. The choice is remembered between visits.
 */
import {
  type AnalyticsData,
  formatAiCredits,
  formatCost,
  formatNumberFull,
  sourceLabel,
} from "@tracepilot/types";
import { SegmentedControl } from "@tracepilot/ui";
import { ArrowRight, Coins, Cpu } from "lucide-vue-next";
import { computed } from "vue";
import { useRouter } from "vue-router";
import AnalyticsDayChart from "@/components/analytics/AnalyticsDayChart.vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import SourceLogo from "@/components/sources/SourceLogo.vue";
import { useAnalyticsDashboardViews } from "@/composables/useAnalyticsDashboardViews";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import {
  activityRows,
  cumulativeRows,
  type DayRow,
  formatShare,
  SOURCE_COLORS,
} from "@/utils/analyticsDashboard";
import {
  type DashboardSummary,
  formatAxisCost,
  formatDashboardCost,
} from "@/utils/analyticsSummary";

const props = defineProps<{
  data: AnalyticsData;
  summary: DashboardSummary;
  days: string[];
  rangeText: string;
  /** Legacy premium requests are priced at this rate per request. */
  costPerPremiumRequest: number;
}>();

const router = useRouter();
const views = useAnalyticsDashboardViews();
const VIEWS = [
  { value: "sources", label: "By source" },
  { value: "running", label: "Running total" },
];
const view = computed({
  get: () => views.value.costView,
  set: (value: string) => {
    views.value.costView = value as "sources" | "running";
  },
});

const has = computed(() => props.summary.costRows.some((row) => row.sessions > 0));
const entry = (source: string) => props.data.costBySource?.find((e) => e.source === source);
const activeDays = computed(() => props.data.activityPerDay.filter((p) => p.count > 0).length);

const copilot = computed(() => {
  const row = props.summary.costRows.find((r) => r.unit === "aic" && r.sessions > 0);
  if (!row) return null;
  const credits = props.summary.credits;
  const total = credits.credits ?? 0;
  const observedShare = total > 0 ? credits.observedCredits / total : 0;
  return {
    row,
    credits: formatAiCredits(credits.credits),
    usd: credits.usdEquivalent == null ? null : formatCost(credits.usdEquivalent),
    observedShare,
    basis:
      credits.source === "unavailable"
        ? "no compatible pricing"
        : observedShare >= 0.995
          ? "observed billing"
          : credits.observedCredits === 0
            ? "estimated from tokens"
            : `${observedShare < 0.01 ? "<1" : Math.round(observedShare * 100)}% observed · rest estimated`,
    meterTitle: `${formatAiCredits(credits.observedCredits)} observed, ${formatAiCredits(credits.estimatedCredits)} estimated from token rates`,
    observed: `${formatNumberFull(props.data.sessionsWithObservedAiCredits ?? 0)} of ${formatNumberFull(row.sessions)} sessions`,
    perSession: credits.credits == null ? "—" : formatAiCredits(total / Math.max(1, row.sessions)),
    // Copilot's older billing unit, kept for comparison when it was recorded.
    legacy:
      props.data.totalPremiumRequests > 0
        ? `${formatNumberFull(Math.round(props.data.totalPremiumRequests))} req · ${formatCost(props.data.totalPremiumRequests * props.costPerPremiumRequest)}`
        : null,
    partial: credits.isPartial,
  };
});

const usdSources = computed(() =>
  props.summary.costRows
    .filter((row) => row.unit === "usd" && row.sessions > 0)
    .map((row) => {
      const source = entry(row.source);
      const priced = source?.sessionsWithCostUsd ?? 0;
      return {
        row,
        value: row.usdEquivalent == null ? "Unpriced" : formatCost(row.usdEquivalent),
        pricedShare: row.sessions ? priced / row.sessions : 0,
        priced: `${formatNumberFull(priced)} of ${formatNumberFull(row.sessions)} sessions`,
        perSession:
          row.usdEquivalent == null ? "—" : formatCost(row.usdEquivalent / Math.max(1, priced)),
        perMillion:
          row.usdEquivalent == null || row.tokens === 0
            ? "—"
            : formatCost(row.usdEquivalent / (row.tokens / 1e6)),
      };
    }),
);

/** With one source, its biggest models by cost fill the second card. */
const byModel = computed(() => {
  if (props.summary.sources.length !== 1) return null;
  const priced = props.summary.models
    .filter((m) => (m.usd ?? 0) > 0)
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  const max = priced[0]?.usd ?? 1;
  return {
    rows: priced.slice(0, 4).map((m) => ({ ...m, width: ((m.usd ?? 0) / max) * 100 })),
    unpriced: props.summary.models.filter((m) => m.usd == null).length,
  };
});

/** With several sources, they add up on one USD scale. */
const allSources = computed(() => {
  const rows = props.summary.costRows.filter((row) => row.sessions > 0);
  const usd = props.summary.costTotal.usd;
  if (rows.length < 2 || usd == null) return null;
  return {
    value: formatCost(usd),
    partial: props.summary.costTotal.partial,
    parts: rows.map((row) => ({
      key: row.source,
      label: sourceLabel(row.source),
      color: SOURCE_COLORS[row.source],
      width: usd > 0 ? ((row.usdEquivalent ?? 0) / usd) * 100 : 0,
      share: usd > 0 ? formatShare(((row.usdEquivalent ?? 0) / usd) * 100) : "—",
    })),
    perDay: formatCost(usd / Math.max(1, activeDays.value)),
  };
});

// ---------- running total ----------
const daily = computed(() =>
  activityRows({
    data: props.data,
    days: props.days,
    metric: "cost",
    aiCreditsByDay: props.summary.aiCreditsByDay,
    label: sourceLabel,
  }),
);
const running = computed(() => cumulativeRows(daily.value.rows));
const inCredits = computed(() => props.summary.inAiCredits);
const format = (value: number) => formatDashboardCost(value, inCredits.value);
const axisFormat = (value: number) => formatAxisCost(value, inCredits.value);

/** What a column added: the running total at its end less the one before it. */
const indexByDay = computed(() => new Map(running.value.map((row, i) => [row.from, i])));
function runningDetail(row: DayRow): string[] {
  const start = indexByDay.value.get(row.from) ?? 0;
  const before = start > 0 ? running.value[start - 1].values.reduce((a, b) => a + b, 0) : 0;
  const spent = row.values.reduce((a, b) => a + b, 0) - before;
  return [`${format(spent)} ${row.from === row.to ? "that day" : "in these days"}`];
}

const runningFoot = computed(() => {
  const rows = daily.value.rows;
  const totals = rows.map((row) => row.values.reduce((a, b) => a + b, 0));
  const spent = totals.reduce((a, b) => a + b, 0);
  if (!spent) return null;
  const peak = totals.indexOf(Math.max(...totals));
  return {
    total: format(spent),
    pace: rows.length > 7 ? format(spent / rows.length) : null,
    peak: new Date(`${rows[peak].from}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    legend: daily.value.series.filter((_, j) => rows.some((row) => row.values[j] > 0)),
  };
});

const unitNote = computed(() =>
  inCredits.value
    ? "AI Credits"
    : props.summary.sources.length > 1
      ? "USD · AI Credits at $0.01"
      : "USD",
);

function openModels() {
  pushRoute(router, ROUTE_NAMES.modelComparison);
}
</script>

<template>
  <OverviewPanel title="Cost" :flush="view === 'sources' && has" data-testid="analytics-cost">
    <template #aside>
      <span v-if="view === 'running' && has">running total · {{ unitNote }}</span>
      <SegmentedControl v-model="view" class="ad-seg" :options="VIEWS" aria-label="Cost view" />
    </template>

    <p v-if="!has" class="ad-empty">
      <b>No cost</b>
      Nothing was used in {{ rangeText }}.
    </p>

    <div v-else-if="view === 'sources'" class="cost-cards">
      <section v-if="copilot" class="cost-card" data-source="copilot">
        <header class="cost-card__head">
          <span class="ad-source" :style="{ color: SOURCE_COLORS.copilot }"><SourceLogo source="copilot" /></span>
          Copilot<span class="cost-card__aside">AI Credits</span>
        </header>
        <div class="ad-tile__value ad-tile__value--lg" data-count-up>
          {{ copilot.credits }}<small v-if="copilot.usd">≈ {{ copilot.usd }}</small>
        </div>
        <div class="ad-meter" :title="copilot.meterTitle">
          <i :style="{ width: `${copilot.observedShare * 100}%`, background: SOURCE_COLORS.copilot }" data-reveal="grow-x" />
          <i :style="{ width: `${(1 - copilot.observedShare) * 100}%`, background: 'var(--accent-muted)' }" data-reveal="grow-x" />
        </div>
        <dl class="cost-kv">
          <dt>Basis</dt><dd>{{ copilot.basis }}<span v-if="copilot.partial" class="ad-partial"> · partial</span></dd>
          <dt>Observed in</dt><dd>{{ copilot.observed }}</dd>
          <dt>Per session</dt><dd>{{ copilot.perSession }}</dd>
          <template v-if="copilot.legacy"><dt>Legacy premium</dt><dd>{{ copilot.legacy }}</dd></template>
        </dl>
      </section>

      <section v-for="card in usdSources" :key="card.row.source" class="cost-card" :data-source="card.row.source">
        <header class="cost-card__head">
          <span class="ad-source" :style="{ color: SOURCE_COLORS[card.row.source] }"><SourceLogo :source="card.row.source" /></span>
          {{ sourceLabel(card.row.source) }}<span class="cost-card__aside">API-equivalent USD</span>
        </header>
        <div class="ad-tile__value ad-tile__value--lg" data-count-up>
          {{ card.value }}<small v-if="card.row.partial" class="ad-partial">partial</small>
        </div>
        <div class="ad-meter" :title="`${card.priced} could be priced`">
          <i :style="{ width: `${card.pricedShare * 100}%`, background: SOURCE_COLORS[card.row.source] }" data-reveal="grow-x" />
          <i v-if="card.pricedShare < 1" :style="{ width: `${(1 - card.pricedShare) * 100}%`, background: 'var(--warning-muted)' }" />
        </div>
        <dl class="cost-kv">
          <dt>Priced</dt><dd>{{ card.priced }}</dd>
          <dt>Per session</dt><dd>{{ card.perSession }}</dd>
          <dt>Per 1M tokens</dt><dd>{{ card.perMillion }}</dd>
        </dl>
      </section>

      <section v-if="byModel" class="cost-card" data-source="models">
        <header class="cost-card__head">
          <Cpu :size="14" class="cost-card__icon" aria-hidden="true" />By model
          <button type="button" class="ad-link cost-card__aside" @click="openModels">
            Compare models <ArrowRight :size="12" aria-hidden="true" />
          </button>
        </header>
        <div class="ad-rows">
          <div v-for="model in byModel.rows" :key="model.key" class="ad-row cost-card__model">
            <span class="ad-row__name"><i class="ad-sw" :style="{ background: model.color }" /><span>{{ model.label }}</span></span>
            <span class="ad-track"><i :style="{ width: `${model.width}%`, background: model.color }" data-reveal="grow-x" /></span>
            <span class="ad-num">{{ model.costText }}</span>
          </div>
        </div>
        <p v-if="byModel.unpriced" class="ad-note">
          {{ byModel.unpriced }} model{{ byModel.unpriced === 1 ? "" : "s" }} could not be priced.
        </p>
      </section>

      <section v-if="allSources" class="cost-card" data-source="total">
        <header class="cost-card__head">
          <Coins :size="14" class="cost-card__icon" aria-hidden="true" />All sources
          <span class="cost-card__aside">one USD scale</span>
        </header>
        <div class="ad-tile__value ad-tile__value--lg" data-count-up>
          {{ allSources.value }}<small v-if="allSources.partial" class="ad-partial">partial</small>
        </div>
        <div class="ad-meter">
          <i
            v-for="part in allSources.parts"
            :key="part.key"
            :title="`${part.label} ${part.share}`"
            :style="{ width: `${part.width}%`, background: part.color }"
            data-reveal="grow-x"
          />
        </div>
        <dl class="cost-kv">
          <template v-for="part in allSources.parts" :key="part.key">
            <dt>{{ part.label }}</dt><dd>{{ part.share }}</dd>
          </template>
          <dt>Per active day</dt><dd>{{ allSources.perDay }}</dd>
        </dl>
        <p class="ad-note">AI Credits count at $0.01 each.</p>
      </section>
    </div>

    <template v-else>
      <AnalyticsDayChart
        v-if="runningFoot"
        :series="daily.series"
        :rows="running"
        mode="lines"
        cumulative
        :format="format"
        :axis-format="axisFormat"
        :detail="runningDetail"
        :height="200"
        label="Running total of cost"
      />
      <div v-if="runningFoot" class="ad-foot">
        <span>Total <b>{{ runningFoot.total }}</b></span>
        <span v-if="runningFoot.pace">Pace <b>{{ runningFoot.pace }}</b>/day</span>
        <span>Biggest day <b>{{ runningFoot.peak }}</b></span>
        <span v-if="summary.costTotal.partial" class="ad-partial">Some usage unpriced</span>
        <span class="ad-legend">
          <span v-for="series in runningFoot.legend" :key="series.key">
            <i class="ad-sw" :style="{ background: series.color }" />{{ series.label }}
          </span>
        </span>
      </div>
      <p v-else class="ad-empty">
        <b>Nothing priced</b>
        No usage in {{ rangeText }} could be priced.
      </p>
    </template>
  </OverviewPanel>
</template>

<style scoped>
/* Hairlines drawn by each card, so a short last row leaves no grey gap. */
.cost-cards {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.cost-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 14px 16px;
  box-shadow:
    1px 0 0 var(--border-muted),
    0 1px 0 var(--border-muted);
}

.cost-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.cost-card__icon {
  color: var(--text-tertiary);
}

.cost-card__aside {
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-tertiary);
}

button.cost-card__aside {
  color: var(--accent-fg);
  font-weight: 500;
}

.cost-kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 12px;
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
}

.cost-kv dd {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.cost-card__model {
  grid-template-columns: minmax(0, 1.2fr) minmax(40px, 1fr) 84px;
  padding: 0;
}
</style>
