import { getSessionDetail, getSessionTurns, getShutdownMetrics } from "@tracepilot/client";
import {
  AI_CREDIT_USD,
  type ConversationTurn,
  isNonCopilotSource,
  type SessionDetail,
  type SessionListItem,
  type SessionSource,
  type ShutdownMetrics,
  sourceCapabilities,
} from "@tracepilot/types";
import {
  formatCost,
  formatDuration,
  formatNumber,
  formatNumberFull,
  formatRate,
  toErrorMessage,
  useAsyncGuard,
} from "@tracepilot/ui";
import {
  computed,
  type InjectionKey,
  inject,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
} from "vue";
import {
  type ToolCompRow,
  toolComparisonRows,
} from "@/components/sessionComparison/toolComparisonRows";
import {
  allowsAiCreditEstimate,
  filesModified,
  linesChanged,
  sessionDurationMs,
  shutdownAiCreditUsage,
  successRate,
  totalCacheRead,
  totalInputTokens,
  totalOutputTokens,
  totalTokens,
  totalToolCalls,
} from "@/composables/useSessionMetrics";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";
import {
  type FormattedDelta,
  formatSessionDelta,
  formatSessionPointDelta,
} from "@/utils/deltaFormatting";
import { getChartColors } from "@/utils/designTokens";
import { modelTokenBreakdown } from "@/utils/metricsTokenBreakdown";
import { modelLabels } from "@/utils/modelLabels";
import { DURATION_HINTS } from "@/utils/sessionDurations";
import { exitTitle, isNormalExit } from "@/utils/sessionExit";
import { sessionCostEstimate } from "@/utils/sourceCost";

/**
 * State + derivations for `SessionComparisonView`.
 *
 * Extracted from `views/SessionComparisonView.vue` in Wave 32. Behaviour is
 * preserved byte-for-byte; the shell provides a single instance of this
 * composable which the children consume via `provide`/`inject`
 * (`SessionComparisonKey` + `useSessionComparisonContext`).
 */

export type { ToolCompRow };

export type NormMode = "raw" | "per-turn" | "per-minute";

export interface SessionData {
  detail: SessionDetail | null;
  metrics: ShutdownMetrics | null;
  turns: ConversationTurn[];
}

export interface MetricRow {
  label: string;
  /** What the metric measures, when the label alone is ambiguous. */
  hint?: string;
  valueA: string;
  valueB: string;
  rawA: number | null;
  rawB: number | null;
  delta: string;
  deltaClass: string;
  arrow: string;
}

export interface TokenBarRow {
  label: string;
  valueA: number | null;
  valueB: number | null;
  maxVal: number;
  isCacheRow?: boolean;
}

export interface DonutSegment {
  model: string;
  /** The model as other views name it (`claude-opus-5.5` for Claude Code). */
  label: string;
  tokens: number;
  percentage: number;
  color: string;
}

// Donut chart color palettes derived from design tokens
// Gradients from primary to lighter shades of indigo/violet
const chartColors = getChartColors();
const DONUT_COLORS_A = [
  chartColors.primary, // #6366f1 indigo
  chartColors.primaryLight, // #818cf8 lighter indigo
  "#a5b4fc", // even lighter indigo (keeping for gradient consistency)
  "#c7d2fe", // pastel indigo
  "#e0e7ff", // very light indigo
];
const DONUT_COLORS_B = [
  "#7c3aed", // purple (keeping as distinct from palette A)
  chartColors.secondary, // #a78bfa violet
  "#c4b5fd", // lighter violet (keeping for gradient)
  "#ddd6fe", // pastel violet
  "#ede9fe", // very light violet
];

function modelDistribution(data: SessionData, colors: string[]): DonutSegment[] {
  const m = data.metrics;
  if (!m?.modelMetrics || totalTokens(m) == null) return [];
  const entries = Object.entries(m.modelMetrics).map(([model, mm]) => ({
    model,
    tokens: modelTokenBreakdown(mm).total ?? 0,
  }));
  const total = entries.reduce((s, e) => s + e.tokens, 0);
  if (total === 0) return [];
  entries.sort((a, b) => b.tokens - a.tokens);
  const source = data.detail?.source;
  const labels = modelLabels(entries.map((e) => ({ model: e.model, source })));
  return entries.map((e, i) => ({
    model: e.model,
    label: labels[i].label,
    tokens: e.tokens,
    percentage: e.tokens / total,
    color: colors[i % colors.length],
  }));
}

export function donutSegments(
  segments: DonutSegment[],
): Array<{ offset: number; length: number; color: string }> {
  const circumference = 2 * Math.PI * 60; // r=60
  let offset = 0;
  return segments.map((seg) => {
    const length = seg.percentage * circumference;
    const result = { offset, length, color: seg.color };
    offset += length;
    return result;
  });
}

function waveformData(turns: ConversationTurn[]): number[] {
  if (turns.length === 0) return [];
  const lengths = turns.map((t) => {
    const userLen = t.userMessage?.length ?? 0;
    const assistLen = t.assistantMessages.reduce((s, m) => s + m.content.length, 0);
    return userLen + assistLen;
  });
  const maxLen = Math.max(...lengths, 1);
  return lengths.map((l) => (l / maxLen) * 100);
}

function timelineBlocks(turns: ConversationTurn[]): number[] {
  if (turns.length === 0) return [];
  const durations = turns.map((t) => t.durationMs ?? 0);
  const total = durations.reduce((s, d) => s + d, 0);
  if (total === 0) return durations.map(() => 100 / turns.length);
  return durations.map((d) => (d / total) * 100);
}

/**
 * A session's cost in its own billing unit: AI Credits for a source billed
 * in them, otherwise the provider's USD figure. When that figure could not
 * be priced, `atLeast` keeps the last snapshot's cost, as Overview shows it.
 */
export function sessionCost(
  data: SessionData,
  pricing: Parameters<typeof shutdownAiCreditUsage>[1],
): { unit: "aic" | "usd"; value: number | null; atLeast: number | null } {
  const source = data.detail?.source;
  if (allowsAiCreditEstimate(source, data.metrics)) {
    const credits = shutdownAiCreditUsage(data.metrics, pricing).credits;
    return { unit: "aic", value: credits, atLeast: null };
  }
  if (data.metrics?.costUnit === "usd") {
    return { unit: "usd", value: data.metrics.costAmount ?? null, atLeast: null };
  }
  // A source billed in AI Credits keeps its observed credits only.
  if (sourceCapabilities(source).hasAic) {
    const credits = shutdownAiCreditUsage(data.metrics, pricing, true).credits;
    return { unit: "aic", value: credits, atLeast: null };
  }
  const atLeast = source ? sessionCostEstimate(source, data.metrics).snapshotAmount : null;
  return { unit: "usd", value: null, atLeast };
}

export function sessionLabel(detail: SessionDetail | null): string {
  return detail?.summary || detail?.id || "Unknown";
}

/** The exit chip's tone, as Overview's Exit tile colours the same exit. */
export function exitBadgeVariant(m: ShutdownMetrics | null): "success" | "danger" | "neutral" {
  if (!m?.shutdownType) return "neutral";
  return isNormalExit(m.shutdownType) ? "success" : "danger";
}

/**
 * The exit chip's text, named as Overview names it, or `null` to hide the
 * chip. Only Copilot records how a session ended, so a missing exit is
 * reported there and simply not mentioned for other sources.
 */
export function exitLabel(m: ShutdownMetrics | null, source?: SessionSource | null): string | null {
  if (m?.shutdownType) return exitTitle(m.shutdownType);
  return isNonCopilotSource(source) ? null : exitTitle(null);
}

// Comparison components take the shared helper from here with the rest of the page's helpers.
export { plural } from "@/utils/format";

export function useSessionComparison() {
  const sessionsStore = useSessionsStore();
  const prefs = usePreferencesStore();

  const normMode = ref<NormMode>("raw");
  const selectedA = ref("");
  const selectedB = ref("");
  const loading = ref(false);
  const error = ref<string | null>(null);
  const compared = ref(false);
  /** The pair the results describe, so a later re-pick can be flagged. */
  const comparedIds = ref<{ a: string; b: string } | null>(null);
  // A newer comparison supersedes one still in flight.
  const guard = useAsyncGuard();
  onBeforeUnmount(() => guard.invalidate());

  const dataA = reactive<SessionData>({ detail: null, metrics: null, turns: [] });
  const dataB = reactive<SessionData>({ detail: null, metrics: null, turns: [] });

  onMounted(async () => {
    if (sessionsStore.sessions.length === 0) {
      await sessionsStore.fetchSessions();
    }
  });

  // The sessions the list shows: with "Hide empty sessions" on, sessions
  // without turns are left out, unless one is already chosen on either side.
  const sessionOptions = computed<SessionListItem[]>(() => {
    if (!prefs.hideEmptySessions) return sessionsStore.sessions;
    return sessionsStore.sessions.filter(
      (s) => (s.turnCount ?? 0) > 0 || s.id === selectedA.value || s.id === selectedB.value,
    );
  });

  const canCompare = computed(
    () =>
      selectedA.value && selectedB.value && selectedA.value !== selectedB.value && !loading.value,
  );

  // The results no longer match the pickers once either pick changes.
  const isStale = computed(
    () =>
      compared.value &&
      comparedIds.value != null &&
      (comparedIds.value.a !== selectedA.value || comparedIds.value.b !== selectedB.value),
  );

  async function runComparison() {
    const a = selectedA.value;
    const b = selectedB.value;
    if (!a || !b) return;
    const token = guard.start();
    loading.value = true;
    error.value = null;
    compared.value = false;
    try {
      const [detailA, metricsA, turnsA, detailB, metricsB, turnsB] = await Promise.all([
        getSessionDetail(a),
        getShutdownMetrics(a),
        getSessionTurns(a).then((r) => r.turns),
        getSessionDetail(b),
        getShutdownMetrics(b),
        getSessionTurns(b).then((r) => r.turns),
      ]);
      if (!guard.isValid(token)) return;
      dataA.detail = detailA;
      dataA.metrics = metricsA;
      dataA.turns = turnsA;
      dataB.detail = detailB;
      dataB.metrics = metricsB;
      dataB.turns = turnsB;
      comparedIds.value = { a, b };
      compared.value = true;
    } catch (e) {
      if (guard.isValid(token)) error.value = toErrorMessage(e);
    } finally {
      if (guard.isValid(token)) loading.value = false;
    }
  }

  const metricsRows = computed<MetricRow[]>(() => {
    if (!compared.value) return [];
    const durA = sessionDurationMs(dataA.detail);
    const durB = sessionDurationMs(dataB.detail);
    const turnsA = dataA.turns.length;
    const turnsB = dataB.turns.length;

    // An unknown span gives no per-minute rates.
    let divA: number | null = 1;
    let divB: number | null = 1;
    if (normMode.value === "per-turn") {
      divA = Math.max(turnsA, 1);
      divB = Math.max(turnsB, 1);
    } else if (normMode.value === "per-minute") {
      divA = durA == null ? null : Math.max(durA / 60000, 0.01);
      divB = durB == null ? null : Math.max(durB / 60000, 0.01);
    }
    const per = (v: number | null, div: number | null) =>
      v == null || div == null ? null : v / div;

    const tokA = totalTokens(dataA.metrics);
    const tokB = totalTokens(dataB.metrics);
    const costA = sessionCost(dataA, prefs);
    const costB = sessionCost(dataB, prefs);
    const tcA = totalToolCalls(dataA.turns);
    const tcB = totalToolCalls(dataB.turns);
    const srA = successRate(dataA.turns);
    const srB = successRate(dataB.turns);
    const fmA = filesModified(dataA.metrics);
    const fmB = filesModified(dataB.metrics);
    const lcA = linesChanged(dataA.metrics);
    const lcB = linesChanged(dataB.metrics);
    const isNorm = normMode.value !== "raw";
    const suffix =
      normMode.value === "per-turn" ? " /turn" : normMode.value === "per-minute" ? " /min" : "";

    function row(
      label: string,
      va: number | null,
      vb: number | null,
      fmt: (v: number) => string,
      hib: boolean,
      delta: (a: number, b: number, hib: boolean) => FormattedDelta = formatSessionDelta,
    ): MetricRow {
      const d =
        va == null || vb == null
          ? { delta: "—", deltaClass: "delta-neutral", arrow: "" }
          : delta(va, vb, hib);
      return {
        label,
        valueA: va == null ? "—" : fmt(va),
        valueB: vb == null ? "—" : fmt(vb),
        rawA: va,
        rawB: vb,
        ...d,
      };
    }

    /** Cost in USD, AI Credits at $0.01 each, so any pair compares directly. */
    function costRow(): MetricRow {
      const usd = (cost: typeof costA, div: number | null) =>
        per(
          cost.value != null && cost.unit === "aic" ? cost.value * AI_CREDIT_USD : cost.value,
          div,
        );
      // A lower bound is shown but never compared.
      const shown = (cost: typeof costA, div: number | null, value: string) => {
        const bound = cost.value == null ? per(cost.atLeast, div) : null;
        return bound == null ? value : `≥ ${formatCost(bound)}`;
      };
      const label = costA.unit === "usd" && costB.unit === "usd" ? "Estimated Cost" : "Cost";
      const r = row(`${label}${suffix}`, usd(costA, divA), usd(costB, divB), formatCost, false);
      return { ...r, valueA: shown(costA, divA, r.valueA), valueB: shown(costB, divB, r.valueB) };
    }

    const fmtN = (v: number) => (isNorm ? v.toFixed(1) : formatNumber(v));
    const fmtInt = (v: number) => (isNorm ? v.toFixed(1) : formatNumberFull(Math.round(v)));

    return [
      {
        ...row("Session Span", durA, durB, formatDuration, false),
        hint: DURATION_HINTS.sessionSpan,
      },
      row("Turns", turnsA, turnsB, formatNumberFull, false),
      row(`Total Tokens${suffix}`, per(tokA, divA), per(tokB, divB), fmtN, false),
      costRow(),
      row(`Tool Calls${suffix}`, per(tcA, divA), per(tcB, divB), fmtInt, false),
      // A change between two rates reads in percentage points.
      row("Success Rate", srA, srB, formatRate, true, formatSessionPointDelta),
      row("Files Modified", fmA, fmB, formatNumberFull, false),
      row(`Lines Changed${suffix}`, per(lcA, divA), per(lcB, divB), fmtInt, false),
    ];
  });

  const tokenBars = computed<TokenBarRow[]>(() => {
    if (!compared.value) return [];
    const inA = totalInputTokens(dataA.metrics);
    const inB = totalInputTokens(dataB.metrics);
    const outA = totalOutputTokens(dataA.metrics);
    const outB = totalOutputTokens(dataB.metrics);
    const crA = totalCacheRead(dataA.metrics);
    const crB = totalCacheRead(dataB.metrics);
    const maxAll = Math.max(inA ?? 0, inB ?? 0, outA ?? 0, outB ?? 0, 1);
    return [
      { label: "Input", valueA: inA, valueB: inB, maxVal: maxAll },
      ...((crA ?? 0) > 0 || (crB ?? 0) > 0
        ? [
            {
              label: "\u00A0\u00A0└ Cached",
              valueA: crA,
              valueB: crB,
              maxVal: maxAll,
              isCacheRow: true,
            },
          ]
        : []),
      { label: "Output", valueA: outA, valueB: outB, maxVal: maxAll },
    ];
  });

  const donutA = computed(() => modelDistribution(dataA, DONUT_COLORS_A));
  const donutB = computed(() => modelDistribution(dataB, DONUT_COLORS_B));

  const toolCompRows = computed<ToolCompRow[]>(() => {
    if (!compared.value) return [];
    return toolComparisonRows(dataA, dataB);
  });

  const waveA = computed(() => waveformData(dataA.turns));
  const waveB = computed(() => waveformData(dataB.turns));

  const timelineA = computed(() => timelineBlocks(dataA.turns));
  const timelineB = computed(() => timelineBlocks(dataB.turns));

  return reactive({
    // state
    normMode,
    selectedA,
    selectedB,
    loading,
    error,
    compared,
    isStale,
    dataA,
    dataB,
    // computed
    sessionOptions,
    canCompare,
    metricsRows,
    tokenBars,
    donutA,
    donutB,
    toolCompRows,
    waveA,
    waveB,
    timelineA,
    timelineB,
    // actions
    runComparison,
  });
}

export type SessionComparisonContext = ReturnType<typeof useSessionComparison>;

export const SessionComparisonKey: InjectionKey<SessionComparisonContext> = Symbol(
  "SessionComparisonContext",
);

export function useSessionComparisonContext(): SessionComparisonContext {
  const ctx = inject(SessionComparisonKey);
  if (!ctx) {
    throw new Error(
      "useSessionComparisonContext must be used within a SessionComparisonView shell",
    );
  }
  return ctx;
}
