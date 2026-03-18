<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import type { SessionDetail, ShutdownMetrics, ConversationTurn, SessionListItem } from '@tracepilot/types';
import { formatDuration, formatNumber, formatCost, Badge, SectionPanel, EmptyState, ErrorAlert, SkeletonLoader } from '@tracepilot/ui';
import { getSessionDetail, getShutdownMetrics, getSessionTurns } from '@tracepilot/client';
import { useSessionsStore } from '@/stores/sessions';
import { usePreferencesStore } from '@/stores/preferences';

// ── State ───────────────────────────────────────────────────────────

const sessionsStore = useSessionsStore();
const prefs = usePreferencesStore();

type NormMode = 'raw' | 'per-turn' | 'per-minute';
const normMode = ref<NormMode>('raw');

const selectedA = ref('');
const selectedB = ref('');
const loading = ref(false);
const error = ref<string | null>(null);
const compared = ref(false);

interface SessionData {
  detail: SessionDetail | null;
  metrics: ShutdownMetrics | null;
  turns: ConversationTurn[];
}

const dataA = reactive<SessionData>({ detail: null, metrics: null, turns: [] });
const dataB = reactive<SessionData>({ detail: null, metrics: null, turns: [] });

onMounted(async () => {
  if (sessionsStore.sessions.length === 0) {
    await sessionsStore.fetchSessions();
  }
});

const sessionOptions = computed<SessionListItem[]>(() => sessionsStore.sessions);

const canCompare = computed(() =>
  selectedA.value && selectedB.value && selectedA.value !== selectedB.value && !loading.value,
);

// ── Load real data ──────────────────────────────────────────────────

async function runComparison() {
  if (!selectedA.value || !selectedB.value) return;
  loading.value = true;
  error.value = null;
  compared.value = false;
  try {
    const [detailA, metricsA, turnsA, detailB, metricsB, turnsB] = await Promise.all([
      getSessionDetail(selectedA.value),
      getShutdownMetrics(selectedA.value),
      getSessionTurns(selectedA.value),
      getSessionDetail(selectedB.value),
      getShutdownMetrics(selectedB.value),
      getSessionTurns(selectedB.value),
    ]);
    dataA.detail = detailA;
    dataA.metrics = metricsA;
    dataA.turns = turnsA;
    dataB.detail = detailB;
    dataB.metrics = metricsB;
    dataB.turns = turnsB;
    compared.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

// ── Derived metric helpers ──────────────────────────────────────────

function totalTokens(m: ShutdownMetrics | null): number {
  if (!m?.modelMetrics) return 0;
  return Object.values(m.modelMetrics).reduce((sum, mm) => {
    return sum + (mm.usage?.inputTokens ?? 0) + (mm.usage?.outputTokens ?? 0);
  }, 0);
}

function totalInputTokens(m: ShutdownMetrics | null): number {
  if (!m?.modelMetrics) return 0;
  return Object.values(m.modelMetrics).reduce((s, mm) => s + (mm.usage?.inputTokens ?? 0), 0);
}

function totalOutputTokens(m: ShutdownMetrics | null): number {
  if (!m?.modelMetrics) return 0;
  return Object.values(m.modelMetrics).reduce((s, mm) => s + (mm.usage?.outputTokens ?? 0), 0);
}

function totalCacheRead(m: ShutdownMetrics | null): number {
  if (!m?.modelMetrics) return 0;
  return Object.values(m.modelMetrics).reduce((s, mm) => s + (mm.usage?.cacheReadTokens ?? 0), 0);
}

function totalCostVal(m: ShutdownMetrics | null): number {
  if (!m?.modelMetrics) return 0;
  return Object.values(m.modelMetrics).reduce((s, mm) => s + (mm.requests?.cost ?? 0), 0);
}

function wholesaleCost(m: ShutdownMetrics | null): number {
  if (!m?.modelMetrics) return 0;
  return Object.entries(m.modelMetrics).reduce((sum, [model, mm]) => {
    const cost = prefs.computeWholesaleCost(
      model,
      mm.usage?.inputTokens ?? 0,
      mm.usage?.cacheReadTokens ?? 0,
      mm.usage?.outputTokens ?? 0,
    );
    return sum + (cost ?? 0);
  }, 0);
}

function copilotCost(m: ShutdownMetrics | null): number {
  if (!m) return 0;
  return (m.totalPremiumRequests ?? 0) * prefs.costPerPremiumRequest;
}

function totalToolCalls(turns: ConversationTurn[]): number {
  return turns.reduce((s, t) => s + (t.toolCalls?.length ?? 0), 0);
}

function successRate(turns: ConversationTurn[]): number {
  let total = 0;
  let success = 0;
  for (const t of turns) {
    for (const tc of t.toolCalls ?? []) {
      total++;
      if (tc.success === true) success++;
    }
  }
  return total === 0 ? 1 : success / total;
}

function toolCounts(turns: ConversationTurn[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of turns) {
    for (const tc of t.toolCalls ?? []) {
      counts[tc.toolName] = (counts[tc.toolName] ?? 0) + 1;
    }
  }
  return counts;
}

function sessionDurationMs(detail: SessionDetail | null): number {
  if (!detail?.createdAt || !detail?.updatedAt) return 0;
  return new Date(detail.updatedAt).getTime() - new Date(detail.createdAt).getTime();
}

function linesChanged(m: ShutdownMetrics | null): number {
  return (m?.codeChanges?.linesAdded ?? 0) + (m?.codeChanges?.linesRemoved ?? 0);
}

function filesModified(m: ShutdownMetrics | null): number {
  return m?.codeChanges?.filesModified?.length ?? 0;
}

function healthScore(turns: ConversationTurn[]): number {
  if (turns.length === 0) return 0;
  const sr = successRate(turns);
  const avgToolsPerTurn = totalToolCalls(turns) / turns.length;
  const efficiencyPenalty = Math.min(avgToolsPerTurn / 20, 0.3);
  return Math.max(0, Math.min(1, sr - efficiencyPenalty));
}

// ── Formatting ──────────────────────────────────────────────────────

function fmtPercent(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

// ── Delta table ─────────────────────────────────────────────────────

interface MetricRow {
  label: string;
  valueA: string;
  valueB: string;
  rawA: number;
  rawB: number;
  delta: string;
  deltaClass: string;
  arrow: string;
}

function computeDelta(
  a: number,
  b: number,
  higherIsBetter: boolean,
): { delta: string; deltaClass: string; arrow: string } {
  if (a === 0 && b === 0) return { delta: '—', deltaClass: 'delta-neutral', arrow: '' };
  const diff = b - a;
  if (Math.abs(diff) < 0.001) return { delta: '—', deltaClass: 'delta-neutral', arrow: '' };
  const base = Math.max(Math.abs(a), 1);
  const pct = Math.abs(diff / base) * 100;
  const isBetter = higherIsBetter ? diff > 0 : diff < 0;
  const arrow = diff > 0 ? '↑' : '↓';
  const cls = isBetter ? 'delta-positive' : 'delta-negative';
  const label = pct > 1 ? `${pct.toFixed(0)}%` : `${Math.abs(diff).toFixed(1)}`;
  return { delta: `${arrow} ${label}`, deltaClass: cls, arrow };
}

const metricsRows = computed<MetricRow[]>(() => {
  if (!compared.value) return [];
  const durA = sessionDurationMs(dataA.detail);
  const durB = sessionDurationMs(dataB.detail);
  const turnsA = dataA.turns.length;
  const turnsB = dataB.turns.length;

  let divA = 1;
  let divB = 1;
  if (normMode.value === 'per-turn') {
    divA = Math.max(turnsA, 1);
    divB = Math.max(turnsB, 1);
  } else if (normMode.value === 'per-minute') {
    divA = Math.max(durA / 60000, 0.01);
    divB = Math.max(durB / 60000, 0.01);
  }

  const tokA = totalTokens(dataA.metrics);
  const tokB = totalTokens(dataB.metrics);
  const wcA = wholesaleCost(dataA.metrics);
  const wcB = wholesaleCost(dataB.metrics);
  const ccA = copilotCost(dataA.metrics);
  const ccB = copilotCost(dataB.metrics);
  const tcA = totalToolCalls(dataA.turns);
  const tcB = totalToolCalls(dataB.turns);
  const srA = successRate(dataA.turns);
  const srB = successRate(dataB.turns);
  const fmA = filesModified(dataA.metrics);
  const fmB = filesModified(dataB.metrics);
  const lcA = linesChanged(dataA.metrics);
  const lcB = linesChanged(dataB.metrics);
  const hsA = healthScore(dataA.turns);
  const hsB = healthScore(dataB.turns);

  const isNorm = normMode.value !== 'raw';
  const suffix = normMode.value === 'per-turn' ? ' /turn' : normMode.value === 'per-minute' ? ' /min' : '';

  function row(label: string, va: number, vb: number, fmt: (v: number) => string, hib: boolean): MetricRow {
    const d = computeDelta(va, vb, hib);
    return { label, valueA: fmt(va), valueB: fmt(vb), rawA: va, rawB: vb, ...d };
  }

  const fmtN = (v: number) => isNorm ? v.toFixed(1) : formatNumber(v);
  const fmtInt = (v: number) => isNorm ? v.toFixed(1) : String(Math.round(v));

  return [
    row('Duration', durA, durB, (v) => formatDuration(v) || '0s', false),
    row('Turns', turnsA, turnsB, String, false),
    row('Total Tokens' + suffix, tokA / divA, tokB / divB, fmtN, false),
    row('Wholesale Cost' + suffix, wcA / divA, wcB / divB, formatCost, false),
    row('Copilot Cost' + suffix, ccA / divA, ccB / divB, formatCost, false),
    row('Tool Calls' + suffix, tcA / divA, tcB / divB, fmtInt, false),
    row('Success Rate', srA, srB, fmtPercent, true),
    row('Files Modified', fmA, fmB, String, false),
    row('Lines Changed' + suffix, lcA / divA, lcB / divB, fmtInt, false),
    row('Health Score', hsA, hsB, (v) => Math.round(v * 100).toString(), true),
  ];
});

// ── Token bar chart data ────────────────────────────────────────────

interface TokenBarRow {
  label: string;
  valueA: number;
  valueB: number;
  maxVal: number;
  isCacheRow?: boolean;
}

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
    { label: 'Input', valueA: inA, valueB: inB, maxVal: maxAll },
    ...(crA > 0 || crB > 0 ? [{ label: '\u00A0\u00A0└ Cached', valueA: crA, valueB: crB, maxVal: maxAll, isCacheRow: true }] : []),
    { label: 'Output', valueA: outA, valueB: outB, maxVal: maxAll },
  ];
});

// ── Model distribution (donut) ──────────────────────────────────────

interface DonutSegment {
  model: string;
  tokens: number;
  percentage: number;
  color: string;
}

const DONUT_COLORS_A = ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff'];
const DONUT_COLORS_B = ['#7c3aed', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe'];

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

const donutA = computed(() => modelDistribution(dataA.metrics, DONUT_COLORS_A));
const donutB = computed(() => modelDistribution(dataB.metrics, DONUT_COLORS_B));

function donutSegments(segments: DonutSegment[]): Array<{ offset: number; length: number; color: string }> {
  const circumference = 2 * Math.PI * 60; // r=60
  let offset = 0;
  return segments.map((seg) => {
    const length = seg.percentage * circumference;
    const result = { offset, length, color: seg.color };
    offset += length;
    return result;
  });
}

// ── Tool usage comparison ───────────────────────────────────────────

interface ToolCompRow {
  tool: string;
  countA: number;
  countB: number;
  maxCount: number;
}

const toolCompRows = computed<ToolCompRow[]>(() => {
  if (!compared.value) return [];
  const cA = toolCounts(dataA.turns);
  const cB = toolCounts(dataB.turns);
  const allTools = [...new Set([...Object.keys(cA), ...Object.keys(cB)])];
  const maxCount = Math.max(...allTools.map((t) => Math.max(cA[t] ?? 0, cB[t] ?? 0)), 1);
  return allTools
    .map((tool) => ({ tool, countA: cA[tool] ?? 0, countB: cB[tool] ?? 0, maxCount }))
    .sort((a, b) => (b.countA + b.countB) - (a.countA + a.countB));
});

// ── Waveform (message length per turn) ──────────────────────────────

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

const waveA = computed(() => waveformData(dataA.turns));
const waveB = computed(() => waveformData(dataB.turns));

// ── Timeline overlay ────────────────────────────────────────────────

function timelineBlocks(turns: ConversationTurn[]): number[] {
  if (turns.length === 0) return [];
  const durations = turns.map((t) => t.durationMs ?? 0);
  const total = durations.reduce((s, d) => s + d, 0);
  if (total === 0) return durations.map(() => 100 / turns.length);
  return durations.map((d) => (d / total) * 100);
}

const timelineA = computed(() => timelineBlocks(dataA.turns));
const timelineB = computed(() => timelineBlocks(dataB.turns));

// ── Summary card helpers ────────────────────────────────────────────

function sessionLabel(detail: SessionDetail | null): string {
  return detail?.summary || detail?.id || 'Unknown';
}

function exitBadgeVariant(m: ShutdownMetrics | null): string {
  if (!m?.shutdownType) return 'neutral';
  const t = m.shutdownType.toLowerCase();
  if (t.includes('clean') || t === 'completed' || t === 'normal') return 'success';
  if (t.includes('forced') || t.includes('error') || t.includes('crash')) return 'danger';
  return 'warning';
}

function exitLabel(m: ShutdownMetrics | null): string {
  if (!m?.shutdownType) return 'Unknown';
  return m.shutdownType;
}
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- Page Title -->
      <div class="mb-4">
        <h1 class="page-title">Compare Sessions</h1>
        <p class="page-subtitle">Rich side-by-side session analysis with metric deltas and visual comparisons</p>
      </div>

      <!-- Session Selector -->
      <div class="selector-row">
        <select
          v-model="selectedA"
          class="comp-select"
          :disabled="loading"
          aria-label="Select Session A"
        >
          <option value="" disabled>Select Session A…</option>
          <option
            v-for="s in sessionOptions"
            :key="s.id"
            :value="s.id"
          >
            {{ s.summary || s.id }}{{ s.repository ? ` — ${s.repository}` : '' }}
          </option>
        </select>
        <span class="vs-label">vs</span>
        <select
          v-model="selectedB"
          class="comp-select"
          :disabled="loading"
          aria-label="Select Session B"
        >
          <option value="" disabled>Select Session B…</option>
          <option
            v-for="s in sessionOptions"
            :key="s.id"
            :value="s.id"
          >
            {{ s.summary || s.id }}{{ s.repository ? ` — ${s.repository}` : '' }}
          </option>
        </select>
        <button
          class="compare-btn"
          type="button"
          :disabled="!canCompare"
          @click="runComparison"
        >
          Compare
        </button>
      </div>

      <!-- Error -->
      <ErrorAlert v-if="error" :message="error" />

      <!-- Loading -->
      <div v-if="loading" class="loading-area">
        <SkeletonLoader variant="card" :count="2" />
        <SkeletonLoader variant="text" :count="9" />
      </div>

      <!-- Empty state -->
      <EmptyState
        v-else-if="!compared"
        icon="⚖️"
        title="Select Two Sessions"
        message="Pick two sessions above and click Compare to see a side-by-side analysis."
      />

      <template v-else>
        <!-- ═══════ Summary Cards ═══════ -->
        <div class="summary-pair">
          <div class="summary-card session-a">
            <div class="summary-label">Session A</div>
            <div class="session-name">{{ sessionLabel(dataA.detail) }}</div>
            <div class="summary-meta">
              <Badge v-if="dataA.detail?.repository" variant="accent">{{ dataA.detail.repository }}</Badge>
              <Badge v-if="dataA.metrics?.currentModel" variant="accent">{{ dataA.metrics.currentModel }}</Badge>
              <Badge :variant="exitBadgeVariant(dataA.metrics) as any">{{ exitLabel(dataA.metrics) }}</Badge>
              <Badge variant="neutral">{{ formatDuration(sessionDurationMs(dataA.detail)) || '—' }}</Badge>
              <Badge variant="neutral">{{ dataA.turns.length }} turns</Badge>
              <Badge variant="neutral">{{ dataA.detail?.eventCount ?? 0 }} events</Badge>
            </div>
          </div>
          <div class="summary-card session-b">
            <div class="summary-label">Session B</div>
            <div class="session-name">{{ sessionLabel(dataB.detail) }}</div>
            <div class="summary-meta">
              <Badge v-if="dataB.detail?.repository" variant="accent">{{ dataB.detail.repository }}</Badge>
              <Badge v-if="dataB.metrics?.currentModel" variant="accent">{{ dataB.metrics.currentModel }}</Badge>
              <Badge :variant="exitBadgeVariant(dataB.metrics) as any">{{ exitLabel(dataB.metrics) }}</Badge>
              <Badge variant="neutral">{{ formatDuration(sessionDurationMs(dataB.detail)) || '—' }}</Badge>
              <Badge variant="neutral">{{ dataB.turns.length }} turns</Badge>
              <Badge variant="neutral">{{ dataB.detail?.eventCount ?? 0 }} events</Badge>
            </div>
          </div>
        </div>

        <!-- ═══════ Metrics Delta Table ═══════ -->
        <SectionPanel title="Metrics Comparison">
          <div class="norm-toggle">
            <button
              :class="['toggle-btn', { active: normMode === 'raw' }]"
              @click="normMode = 'raw'"
            >Raw</button>
            <button
              :class="['toggle-btn', { active: normMode === 'per-turn' }]"
              @click="normMode = 'per-turn'"
            >Per Turn</button>
            <button
              :class="['toggle-btn', { active: normMode === 'per-minute' }]"
              @click="normMode = 'per-minute'"
            >Per Minute</button>
          </div>
          <div class="delta-table-wrap">
            <table class="delta-table" aria-label="Metrics comparison between sessions">
              <thead>
                <tr>
                  <th class="col-val-a">Session A</th>
                  <th class="col-metric">Metric</th>
                  <th class="col-val-b">Session B</th>
                  <th class="col-delta">Delta</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in metricsRows" :key="row.label">
                  <td class="val-a">{{ row.valueA }}</td>
                  <td class="metric-name">{{ row.label }}</td>
                  <td class="val-b">{{ row.valueB }}</td>
                  <td class="delta-col" :class="row.deltaClass">{{ row.delta }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </SectionPanel>

        <!-- ═══════ Token Usage Comparison ═══════ -->
        <div class="chart-grid-2">
          <div class="chart-box">
            <div class="chart-box-header">Token Usage — Session A</div>
            <div class="chart-box-body chart-body-col">
              <div v-for="bar in tokenBars" :key="'a-' + bar.label" class="bar-row">
                <span class="bar-label">{{ bar.label }}</span>
                <div class="bar-track">
                  <div
                    :class="['bar-fill', bar.isCacheRow ? 'bar-fill-cache' : 'bar-fill-a']"
                    :style="{ width: (bar.valueA / bar.maxVal * 100) + '%' }"
                  >
                    <span v-if="(bar.valueA / bar.maxVal * 100) >= 15" class="bar-value">{{ formatNumber(bar.valueA) }}</span>
                  </div>
                  <span v-if="bar.valueA > 0 && (bar.valueA / bar.maxVal * 100) < 15" class="bar-value-outside">{{ formatNumber(bar.valueA) }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="chart-box">
            <div class="chart-box-header">Token Usage — Session B</div>
            <div class="chart-box-body chart-body-col">
              <div v-for="bar in tokenBars" :key="'b-' + bar.label" class="bar-row">
                <span class="bar-label">{{ bar.label }}</span>
                <div class="bar-track">
                  <div
                    :class="['bar-fill', bar.isCacheRow ? 'bar-fill-cache' : 'bar-fill-b']"
                    :style="{ width: (bar.valueB / bar.maxVal * 100) + '%' }"
                  >
                    <span v-if="(bar.valueB / bar.maxVal * 100) >= 15" class="bar-value">{{ formatNumber(bar.valueB) }}</span>
                  </div>
                  <span v-if="bar.valueB > 0 && (bar.valueB / bar.maxVal * 100) < 15" class="bar-value-outside">{{ formatNumber(bar.valueB) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════ Model Distribution Donuts ═══════ -->
        <div class="chart-grid-2">
          <div class="chart-box">
            <div class="chart-box-header">Model Distribution — Session A</div>
            <div class="chart-box-body chart-body-center">
              <div v-if="donutA.length === 0" class="no-data">No model data</div>
              <div v-else class="donut-wrap">
                <svg width="160" height="160" viewBox="0 0 160 160">
                  <circle cx="80" cy="80" r="60" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="20" />
                  <circle
                    v-for="(seg, i) in donutSegments(donutA)"
                    :key="'da-' + i"
                    cx="80" cy="80" r="60" fill="none"
                    :stroke="seg.color"
                    stroke-width="20"
                    :stroke-dasharray="`${seg.length} ${2 * Math.PI * 60 - seg.length}`"
                    :stroke-dashoffset="`${-(seg.offset - 2 * Math.PI * 60 * 0.25)}`"
                  />
                  <text v-if="donutA[0]" x="80" y="76" text-anchor="middle" fill="var(--text-primary)" font-size="18" font-weight="700">{{ Math.round(donutA[0].percentage * 100) }}%</text>
                  <text v-if="donutA[0]" x="80" y="94" text-anchor="middle" fill="var(--text-tertiary)" font-size="10">{{ donutA[0].model.split('/').pop() }}</text>
                </svg>
                <div class="donut-legend">
                  <div v-for="seg in donutA" :key="seg.model" class="donut-legend-item">
                    <div class="donut-swatch" :style="{ background: seg.color }"></div>
                    <span>{{ seg.model }} ({{ Math.round(seg.percentage * 100) }}%)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="chart-box">
            <div class="chart-box-header">Model Distribution — Session B</div>
            <div class="chart-box-body chart-body-center">
              <div v-if="donutB.length === 0" class="no-data">No model data</div>
              <div v-else class="donut-wrap">
                <svg width="160" height="160" viewBox="0 0 160 160">
                  <circle cx="80" cy="80" r="60" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="20" />
                  <circle
                    v-for="(seg, i) in donutSegments(donutB)"
                    :key="'db-' + i"
                    cx="80" cy="80" r="60" fill="none"
                    :stroke="seg.color"
                    stroke-width="20"
                    :stroke-dasharray="`${seg.length} ${2 * Math.PI * 60 - seg.length}`"
                    :stroke-dashoffset="`${-(seg.offset - 2 * Math.PI * 60 * 0.25)}`"
                  />
                  <text v-if="donutB[0]" x="80" y="76" text-anchor="middle" fill="var(--text-primary)" font-size="18" font-weight="700">{{ Math.round(donutB[0].percentage * 100) }}%</text>
                  <text v-if="donutB[0]" x="80" y="94" text-anchor="middle" fill="var(--text-tertiary)" font-size="10">{{ donutB[0].model.split('/').pop() }}</text>
                </svg>
                <div class="donut-legend">
                  <div v-for="seg in donutB" :key="seg.model" class="donut-legend-item">
                    <div class="donut-swatch" :style="{ background: seg.color }"></div>
                    <span>{{ seg.model }} ({{ Math.round(seg.percentage * 100) }}%)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════ Tool Usage Comparison ═══════ -->
        <SectionPanel title="Tool Usage Comparison">
          <div v-if="toolCompRows.length === 0" class="no-data">No tool usage data</div>
          <template v-else>
            <div class="tool-legend">
              <div class="tool-legend-item">
                <div class="tool-legend-swatch swatch-a"></div>
                <span>Session A</span>
              </div>
              <div class="tool-legend-item">
                <div class="tool-legend-swatch swatch-b"></div>
                <span>Session B</span>
              </div>
            </div>
            <div v-for="row in toolCompRows" :key="row.tool" class="tool-row">
              <span class="tool-label">{{ row.tool }}</span>
              <div class="tool-bars">
                <div v-if="row.countA > 0" class="tool-bar tool-bar-a" :style="{ width: (row.countA / row.maxCount * 100) + '%' }">{{ row.countA }}</div>
                <div v-if="row.countB > 0" class="tool-bar tool-bar-b" :style="{ width: (row.countB / row.maxCount * 100) + '%' }">{{ row.countB }}</div>
              </div>
            </div>
          </template>
        </SectionPanel>

        <!-- ═══════ Message Length Waveform ═══════ -->
        <div class="chart-grid-2">
          <div class="chart-box">
            <div class="chart-box-header">Message Length by Turn — Session A</div>
            <div class="chart-box-body">
              <div v-if="waveA.length === 0" class="no-data">No turns</div>
              <div v-else class="waveform-container">
                <div
                  v-for="(h, i) in waveA"
                  :key="'wa-' + i"
                  class="waveform-bar waveform-bar-a"
                  :style="{ height: Math.max(h, 8) + '%' }"
                  :title="`Turn ${i + 1}`"
                ></div>
              </div>
            </div>
          </div>
          <div class="chart-box">
            <div class="chart-box-header">Message Length by Turn — Session B</div>
            <div class="chart-box-body">
              <div v-if="waveB.length === 0" class="no-data">No turns</div>
              <div v-else class="waveform-container">
                <div
                  v-for="(h, i) in waveB"
                  :key="'wb-' + i"
                  class="waveform-bar waveform-bar-b"
                  :style="{ height: Math.max(h, 8) + '%' }"
                  :title="`Turn ${i + 1}`"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════ Timeline Overlay ═══════ -->
        <SectionPanel title="Timeline Overlay">
          <p class="timeline-desc">Session duration and pacing — each block represents a turn proportional to its duration</p>
          <div class="timeline-section">
            <div class="timeline-label label-a">Session A — {{ formatDuration(sessionDurationMs(dataA.detail)) || '—' }} ({{ dataA.turns.length }} turns)</div>
            <div class="mini-timeline-row">
              <div
                v-for="(pct, i) in timelineA"
                :key="'tla-' + i"
                class="mini-tl-block"
                :style="{
                  width: pct + '%',
                  background: i % 2 === 0
                    ? 'linear-gradient(90deg, #6366f1, #818cf8)'
                    : 'rgba(99,102,241,0.3)',
                }"
                :title="`Turn ${i + 1}: ${formatDuration(dataA.turns[i]?.durationMs) || '—'}`"
              ></div>
            </div>
          </div>
          <div class="timeline-section">
            <div class="timeline-label label-b">Session B — {{ formatDuration(sessionDurationMs(dataB.detail)) || '—' }} ({{ dataB.turns.length }} turns)</div>
            <div class="mini-timeline-row">
              <div
                v-for="(pct, i) in timelineB"
                :key="'tlb-' + i"
                class="mini-tl-block"
                :style="{
                  width: pct + '%',
                  background: i % 2 === 0
                    ? 'linear-gradient(90deg, #7c3aed, #a78bfa)'
                    : 'rgba(124,58,237,0.3)',
                }"
                :title="`Turn ${i + 1}: ${formatDuration(dataB.turns[i]?.durationMs) || '—'}`"
              ></div>
            </div>
          </div>
        </SectionPanel>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ── Selector Row ── */
.selector-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.comp-select {
  flex: 0 1 340px;
  min-width: 200px;
  max-width: 340px;
  padding: 10px 14px;
  font-size: 0.8125rem;
  font-weight: 500;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%2371717a' stroke-width='1.5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
}

.comp-select:focus {
  outline: none;
  border-color: var(--accent-emphasis);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}

.vs-label {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.compare-btn {
  padding: 10px 24px;
  font-size: 0.8125rem;
  font-weight: 600;
  border: none;
  border-radius: var(--radius-md);
  background: var(--gradient-accent);
  color: #fff;
  cursor: pointer;
  transition: all 150ms ease;
  white-space: nowrap;
}

.compare-btn:hover:not(:disabled) {
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.3);
  transform: translateY(-1px);
}

.compare-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Loading ── */
.loading-area {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 24px;
}

/* ── Summary Cards ── */
.summary-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}

.summary-card {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 18px;
  position: relative;
  overflow: hidden;
}

.summary-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
}

.summary-card.session-a::before {
  background: linear-gradient(90deg, #6366f1, #818cf8);
}

.summary-card.session-b::before {
  background: linear-gradient(90deg, #7c3aed, #a78bfa);
}

.summary-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.session-name {
  font-size: 0.9375rem;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--text-primary);
}

.summary-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

/* ── Delta Table ── */
.delta-table-wrap {
  margin: -4px -4px;
}

.delta-table {
  width: 100%;
  border-collapse: collapse;
}

.delta-table th {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-default);
}

.delta-table td {
  padding: 10px 14px;
  font-size: 0.8125rem;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
  font-variant-numeric: tabular-nums;
}

.col-val-a { text-align: right; width: 30%; }
.col-metric { text-align: center; width: 20%; }
.col-val-b { text-align: left; width: 30%; }
.col-delta { text-align: center; width: 20%; }

.delta-table .metric-name {
  color: var(--text-secondary);
  font-weight: 500;
  text-align: center;
}

.delta-table .val-a {
  color: var(--accent-fg);
  font-weight: 600;
  text-align: right;
}

.delta-table .val-b {
  color: var(--done-fg);
  font-weight: 600;
  text-align: left;
}

.delta-table .delta-col {
  text-align: center;
  font-weight: 600;
  font-size: 0.75rem;
}

.delta-positive { color: var(--success-fg); }
.delta-negative { color: var(--danger-fg); }
.delta-neutral { color: var(--text-tertiary); }

/* ── Chart Grid ── */
.chart-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}

.chart-box {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.chart-box-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.chart-box-body {
  padding: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.chart-body-col {
  flex-direction: column;
  align-items: stretch;
}

.chart-body-center {
  flex-direction: column;
  align-items: center;
}

/* ── Bar Charts ── */
.bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.bar-label {
  width: 90px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-align: right;
  flex-shrink: 0;
}

.bar-track {
  flex: 1;
  height: 18px;
  position: relative;
  display: flex;
  align-items: center;
}

.bar-fill {
  height: 100%;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 6px;
  transition: width 500ms ease;
  min-width: 2px;
  position: relative;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar-fill-a {
  background: linear-gradient(90deg, #6366f1, #818cf8);
}

.bar-fill-b {
  background: linear-gradient(90deg, #7c3aed, #a78bfa);
}

.bar-value {
  font-size: 0.625rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
  position: relative;
  z-index: 1;
}

.bar-fill-cache {
  background: linear-gradient(90deg, #34d399cc, #6ee7b7cc);
}

.bar-value-outside {
  margin-left: 6px;
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Donut Charts ── */
.donut-wrap {
  text-align: center;
}

.donut-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 12px;
}

.donut-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.6875rem;
  color: var(--text-secondary);
}

.donut-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

/* ── Tool Usage ── */
.tool-legend {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 0.6875rem;
}

.tool-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
}

.tool-legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.swatch-a { background: #6366f1; }
.swatch-b { background: #a78bfa; }

.tool-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.tool-label {
  width: 100px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-align: right;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', monospace;
}

.tool-bars {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.tool-bar {
  height: 14px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  padding-left: 6px;
  font-size: 0.625rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  font-family: 'JetBrains Mono', monospace;
  transition: width 500ms ease;
  min-width: 20px;
}

.tool-bar-a { background: linear-gradient(90deg, #6366f1, #818cf8); }
.tool-bar-b { background: linear-gradient(90deg, #7c3aed, #a78bfa); }

/* ── Waveform ── */
.waveform-container {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 60px;
  padding: 0 4px;
  width: 100%;
}

.waveform-bar {
  flex: 1;
  border-radius: 2px 2px 0 0;
  min-width: 4px;
  transition: height 300ms ease;
}

.waveform-bar-a { background: linear-gradient(180deg, #818cf8, #6366f1); }
.waveform-bar-b { background: linear-gradient(180deg, #a78bfa, #7c3aed); }

/* ── Timeline ── */
.timeline-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}

.timeline-section {
  margin-bottom: 8px;
}

.timeline-label {
  font-size: 0.6875rem;
  font-weight: 500;
  margin-bottom: 4px;
}

.label-a { color: var(--accent-fg); }
.label-b { color: var(--done-fg); }

.mini-timeline-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
}

.mini-tl-block {
  height: 8px;
  border-radius: 2px;
  transition: width 300ms ease;
}

/* ── Normalization Toggle ── */
.norm-toggle {
  display: flex;
  gap: 2px;
  margin-bottom: 16px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 3px;
  width: fit-content;
}

.norm-toggle .toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
}

.norm-toggle .toggle-btn:hover {
  color: var(--text-secondary);
}

.norm-toggle .toggle-btn.active {
  background: var(--canvas-subtle);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

/* ── Utilities ── */
.no-data {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  text-align: center;
  padding: 20px;
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .selector-row {
    flex-direction: column;
  }
  .comp-select {
    width: 100%;
    max-width: none;
  }
  .summary-pair,
  .chart-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
