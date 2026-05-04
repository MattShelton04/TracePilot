import { getSessionDetail, getSessionTurns, getShutdownMetrics } from "@tracepilot/client";
import type {
  ConversationTurn,
  SessionDetail,
  SessionListItem,
  ShutdownMetrics,
} from "@tracepilot/types";
import {
  formatCost,
  formatDuration,
  formatNumber,
  formatRate,
  toErrorMessage,
} from "@tracepilot/ui";
import { computed, type InjectionKey, inject, onMounted, reactive, ref } from "vue";
import {
  copilotCost,
  filesModified,
  linesChanged,
  sessionDurationMs,
  successRate,
  toolCounts,
  totalCacheRead,
  totalInputTokens,
  totalOutputTokens,
  totalTokens,
  totalToolCalls,
  wholesaleCost,
} from "@/composables/useSessionMetrics";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";
import { formatSessionDelta } from "@/utils/deltaFormatting";
import { getChartColors } from "@/utils/designTokens";

/**
 * State + derivations for `SessionComparisonView`.
 *
 * Extracted from `views/SessionComparisonView.vue` in Wave 32. Behaviour is
 * preserved byte-for-byte; the shell provides a single instance of this
 * composable which the children consume via `provide`/`inject`
 * (`SessionComparisonKey` + `useSessionComparisonContext`).
 */

export type NormMode = "raw" | "per-turn" | "per-minute";

export interface SessionData {
  detail: SessionDetail | null;
  metrics: ShutdownMetrics | null;
  turns: ConversationTurn[];
}

export interface MetricRow {
  label: string;
  valueA: string;
  valueB: string;
  rawA: number;
  rawB: number;
  delta: string;
  deltaClass: string;
  arrow: string;
}

export interface TokenBarRow {
  label: string;
  valueA: number;
  valueB: number;
  maxVal: number;
  isCacheRow?: boolean;
}

export interface DonutSegment {
  model: string;
  tokens: number;
  percentage: number;
  color: string;
}

export interface ToolCompRow {
  tool: string;
  countA: number;
  countB: number;
  maxCount: number;
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

function modelDistribution(m: ShutdownMetrics | null, colors: string[]): DonutSegment[] {
  if (!m?.modelMetrics) return [];
  const entries = Object.entries(m.modelMetrics).map(([model, mm]) => ({
    model,
    tokens: (mm.usage?.inputTokens ?? 0) + (mm.usage?.outputTokens ?? 0),
  }));
  const total = entries.reduce((s, e) => s + e.tokens, 0);
  if (total === 0) return [];
  return entries
    .sort((a, b) => b.tokens - a.tokens)
    .map((e, i) => ({
      model: e.model,
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

export function sessionLabel(detail: SessionDetail | null): string {
  return detail?.summary || detail?.id || "Unknown";
}

export function exitBadgeVariant(
  m: ShutdownMetrics | null,
): "default" | "accent" | "success" | "warning" | "danger" | "done" | "neutral" {
  if (!m?.shutdownType) return "neutral";
  const t = m.shutdownType.toLowerCase();
  if (t.includes("clean") || t === "completed" || t === "normal") return "success";
  if (t.includes("forced") || t.includes("error") || t.includes("crash")) return "danger";
  return "warning";
}

export function exitLabel(m: ShutdownMetrics | null): string {
  if (!m?.shutdownType) return "Unknown";
  return m.shutdownType;
}

export function useSessionComparison() {
  const sessionsStore = useSessionsStore();
  const prefs = usePreferencesStore();

  const normMode = ref<NormMode>("raw");
  const selectedA = ref("");
  const selectedB = ref("");
  const loading = ref(false);
  const error = ref<string | null>(null);
  const compared = ref(false);

  const dataA = reactive<SessionData>({ detail: null, metrics: null, turns: [] });
  const dataB = reactive<SessionData>({ detail: null, metrics: null, turns: [] });

  onMounted(async () => {
    if (sessionsStore.sessions.length === 0) {
      await sessionsStore.fetchSessions();
    }
  });

  const sessionOptions = computed<SessionListItem[]>(() => sessionsStore.sessions);

  const canCompare = computed(
    () =>
      selectedA.value && selectedB.value && selectedA.value !== selectedB.value && !loading.value,
  );

  async function runComparison() {
    if (!selectedA.value || !selectedB.value) return;
    loading.value = true;
    error.value = null;
    compared.value = false;
    try {
      const [detailA, metricsA, turnsA, detailB, metricsB, turnsB] = await Promise.all([
        getSessionDetail(selectedA.value),
        getShutdownMetrics(selectedA.value),
        getSessionTurns(selectedA.value).then((r) => r.turns),
        getSessionDetail(selectedB.value),
        getShutdownMetrics(selectedB.value),
        getSessionTurns(selectedB.value).then((r) => r.turns),
      ]);
      dataA.detail = detailA;
      dataA.metrics = metricsA;
      dataA.turns = turnsA;
      dataB.detail = detailB;
      dataB.metrics = metricsB;
      dataB.turns = turnsB;
      compared.value = true;
    } catch (e) {
      error.value = toErrorMessage(e);
    } finally {
      loading.value = false;
    }
  }

  const metricsRows = computed<MetricRow[]>(() => {
    if (!compared.value) return [];
    const durA = sessionDurationMs(dataA.detail);
    const durB = sessionDurationMs(dataB.detail);
    const turnsA = dataA.turns.length;
    const turnsB = dataB.turns.length;

    let divA = 1;
    let divB = 1;
    if (normMode.value === "per-turn") {
      divA = Math.max(turnsA, 1);
      divB = Math.max(turnsB, 1);
    } else if (normMode.value === "per-minute") {
      divA = Math.max(durA / 60000, 0.01);
      divB = Math.max(durB / 60000, 0.01);
    }

    const tokA = totalTokens(dataA.metrics);
    const tokB = totalTokens(dataB.metrics);
    const wcA = wholesaleCost(dataA.metrics, prefs.computeWholesaleCost);
    const wcB = wholesaleCost(dataB.metrics, prefs.computeWholesaleCost);
    const ccA = copilotCost(dataA.metrics, prefs.costPerPremiumRequest);
    const ccB = copilotCost(dataB.metrics, prefs.costPerPremiumRequest);
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
      va: number,
      vb: number,
      fmt: (v: number) => string,
      hib: boolean,
    ): MetricRow {
      const d = formatSessionDelta(va, vb, hib);
      return { label, valueA: fmt(va), valueB: fmt(vb), rawA: va, rawB: vb, ...d };
    }

    const fmtN = (v: number) => (isNorm ? v.toFixed(1) : formatNumber(v));
    const fmtInt = (v: number) => (isNorm ? v.toFixed(1) : String(Math.round(v)));

    return [
      row("Duration", durA, durB, (v) => formatDuration(v) || "0s", false),
      row("Turns", turnsA, turnsB, String, false),
      row(`Total Tokens${suffix}`, tokA / divA, tokB / divB, fmtN, false),
      row(`Direct API Cost${suffix}`, wcA / divA, wcB / divB, formatCost, false),
      row(`Copilot Cost${suffix}`, ccA / divA, ccB / divB, formatCost, false),
      row(`Tool Calls${suffix}`, tcA / divA, tcB / divB, fmtInt, false),
      row("Success Rate", srA, srB, formatRate, true),
      row("Files Modified", fmA, fmB, String, false),
      row(`Lines Changed${suffix}`, lcA / divA, lcB / divB, fmtInt, false),
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
    const maxAll = Math.max(inA, inB, outA, outB, 1);
    return [
      { label: "Input", valueA: inA, valueB: inB, maxVal: maxAll },
      ...(crA > 0 || crB > 0
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

  const donutA = computed(() => modelDistribution(dataA.metrics, DONUT_COLORS_A));
  const donutB = computed(() => modelDistribution(dataB.metrics, DONUT_COLORS_B));

  const toolCompRows = computed<ToolCompRow[]>(() => {
    if (!compared.value) return [];
    const cA = toolCounts(dataA.turns);
    const cB = toolCounts(dataB.turns);
    const allTools = [...new Set([...Object.keys(cA), ...Object.keys(cB)])];
    const maxCount = Math.max(...allTools.map((t) => Math.max(cA[t] ?? 0, cB[t] ?? 0)), 1);
    return allTools
      .map((tool) => ({ tool, countA: cA[tool] ?? 0, countB: cB[tool] ?? 0, maxCount }))
      .sort((a, b) => b.countA + b.countB - (a.countA + a.countB));
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
