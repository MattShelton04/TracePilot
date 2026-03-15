<script setup lang="ts">
// STUB: Currently displays mock comparison data.
// STUB: Replace with real session comparison when dedicated API is available.
// STUB: The comparison logic should load two sessions via getSessionDetail()
// STUB: and compute metrics diffs server-side for accuracy.

import { ref, onMounted, computed } from 'vue';
import type { ComparisonResult, SessionListItem } from '@tracepilot/types';
import { formatDuration } from '@tracepilot/ui';
import { useSessionsStore } from '@/stores/sessions';
import StubBanner from '@/components/StubBanner.vue';

// ── Mock comparison data ────────────────────────────────────────────
// STUB: useComparisonComposable — loads two session details for comparison.
// STUB: Currently uses mock data to simulate comparison results.
// STUB: In production, this should use a dedicated comparison API or
// STUB: load two sessions via getSessionDetail() and compute diffs.

const MOCK_COMPARISON: ComparisonResult = {
  sessionA: {
    id: 'session-001',
    summary: 'OAuth Login Implementation',
    model: 'claude-opus-4.6',
    duration: 8100,
    turns: 12,
    tokens: 892300,
    cost: 0.87,
    toolCalls: 24,
    successRate: 0.958,
    filesModified: 8,
    linesChanged: 398,
    healthScore: 0.82,
  },
  sessionB: {
    id: 'session-002',
    summary: 'Database Connection Pooling',
    model: 'gpt-5.4',
    duration: 5400,
    turns: 8,
    tokens: 234100,
    cost: 0.46,
    toolCalls: 18,
    successRate: 1.0,
    filesModified: 5,
    linesChanged: 210,
    healthScore: 0.91,
  },
  modelUsage: {
    sessionA: [
      { model: 'claude-opus-4.6', tokens: 724000, requests: 9 },
      { model: 'claude-haiku-4.5', tokens: 168300, requests: 3 },
    ],
    sessionB: [
      { model: 'gpt-5.4', tokens: 198100, requests: 6 },
      { model: 'gpt-5-mini', tokens: 36000, requests: 2 },
    ],
  },
};

// ── State ───────────────────────────────────────────────────────────

const sessionsStore = useSessionsStore();
const selectedA = ref('');
const selectedB = ref('');
const comparison = ref<ComparisonResult | null>(null);
const loading = ref(false);

onMounted(async () => {
  if (sessionsStore.sessions.length === 0) {
    await sessionsStore.fetchSessions();
  }
});

const sessionOptions = computed<SessionListItem[]>(() => sessionsStore.sessions);

function runComparison() {
  if (!selectedA.value || !selectedB.value) return;
  loading.value = true;
  // STUB: Replace with real comparison API call
  setTimeout(() => {
    comparison.value = MOCK_COMPARISON;
    loading.value = false;
  }, 300);
}

// ── Metrics table rows ──────────────────────────────────────────────

interface MetricRow {
  label: string;
  valueA: string;
  valueB: string;
  delta: string;
  deltaClass: string;
}

function fmtDurationSec(seconds: number): string {
  return formatDuration(seconds * 1000);
}

function fmtTokens(t: number): string {
  return t >= 1000 ? `${(t / 1000).toFixed(1)}K` : String(t);
}

function fmtCost(c: number): string {
  return `$${c.toFixed(2)}`;
}

function fmtPercent(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

/**
 * Compute delta class. "lower is better" metrics (duration, tokens, cost)
 * get green when B < A; "higher is better" metrics (successRate, healthScore)
 * get green when B > A.
 */
function deltaInfo(
  a: number,
  b: number,
  fmt: (v: number) => string,
  higherIsBetter: boolean,
): { delta: string; deltaClass: string } {
  const diff = b - a;
  if (Math.abs(diff) < 0.001) return { delta: '—', deltaClass: 'delta-neutral' };
  const sign = diff > 0 ? '+' : '';
  const isBetter = higherIsBetter ? diff > 0 : diff < 0;
  return {
    delta: `${sign}${fmt(diff)}`,
    deltaClass: isBetter ? 'delta-positive' : 'delta-negative',
  };
}

const metricsRows = computed<MetricRow[]>(() => {
  if (!comparison.value) return [];
  const a = comparison.value.sessionA;
  const b = comparison.value.sessionB;

  const rows: MetricRow[] = [];

  function row(
    label: string,
    va: number,
    vb: number,
    fmt: (v: number) => string,
    higherIsBetter: boolean,
  ) {
    const { delta, deltaClass } = deltaInfo(va, vb, fmt, higherIsBetter);
    rows.push({ label, valueA: fmt(va), valueB: fmt(vb), delta, deltaClass });
  }

  row('Duration', a.duration, b.duration, fmtDurationSec, false);
  row('Turns', a.turns, b.turns, String, false);
  row('Total Tokens', a.tokens, b.tokens, fmtTokens, false);
  row('Cost', a.cost, b.cost, fmtCost, false);
  row('Tool Calls', a.toolCalls, b.toolCalls, String, false);
  row('Success Rate', a.successRate, b.successRate, fmtPercent, true);
  row('Files Modified', a.filesModified, b.filesModified, String, false);
  row('Lines Changed', a.linesChanged, b.linesChanged, String, false);
  row('Health Score', a.healthScore, b.healthScore, (v) => v.toFixed(2), true);

  return rows;
});

// ── Value classes for side-by-side summary ──────────────────────────

function valueCls(a: number, b: number, higherIsBetter: boolean): string {
  if (Math.abs(a - b) < 0.001) return '';
  const aBetter = higherIsBetter ? a > b : a < b;
  return aBetter ? 'value-better' : 'value-worse';
}

// ── SVG bar chart helpers ───────────────────────────────────────────

interface BarGroup {
  label: string;
  valueA: number;
  valueB: number;
  displayA: string;
  displayB: string;
}

const barGroups = computed<BarGroup[]>(() => {
  if (!comparison.value) return [];
  const a = comparison.value.sessionA;
  const b = comparison.value.sessionB;
  return [
    { label: 'Turns', valueA: a.turns, valueB: b.turns, displayA: String(a.turns), displayB: String(b.turns) },
    { label: 'Tokens(K)', valueA: a.tokens / 1000, valueB: b.tokens / 1000, displayA: String(Math.round(a.tokens / 1000)), displayB: String(Math.round(b.tokens / 1000)) },
    { label: 'Cost($×100)', valueA: a.cost * 100, valueB: b.cost * 100, displayA: String(Math.round(a.cost * 100)), displayB: String(Math.round(b.cost * 100)) },
    { label: 'Tool Calls', valueA: a.toolCalls, valueB: b.toolCalls, displayA: String(a.toolCalls), displayB: String(b.toolCalls) },
    { label: 'Files', valueA: a.filesModified, valueB: b.filesModified, displayA: String(a.filesModified), displayB: String(b.filesModified) },
    { label: 'Health(×100)', valueA: a.healthScore * 100, valueB: b.healthScore * 100, displayA: String(Math.round(a.healthScore * 100)), displayB: String(Math.round(b.healthScore * 100)) },
  ];
});

const chartHeight = 200;
const barBaseline = 200;
const barAreaHeight = 160;

function barHeight(value: number, group: BarGroup): number {
  const max = Math.max(group.valueA, group.valueB, 1);
  return (value / max) * barAreaHeight;
}
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <StubBanner />
      <!-- Page Title -->
      <div class="mb-4">
        <h1 class="page-title">Compare Sessions</h1>
        <p class="page-subtitle">Side-by-side comparison of session metrics and outcomes</p>
      </div>

      <!-- Session Selector -->
      <div class="section-panel" style="margin-bottom: 20px;">
        <div class="section-panel-body">
          <div class="session-selector-row">
            <select
              v-model="selectedA"
              class="filter-select"
              style="flex: 1;"
              aria-label="Select Session A"
            >
              <option value="" disabled>Select Session A…</option>
              <option
                v-for="s in sessionOptions"
                :key="s.id"
                :value="s.id"
              >
                {{ s.summary || s.id }}
              </option>
            </select>
            <span class="vs-label">vs</span>
            <select
              v-model="selectedB"
              class="filter-select"
              style="flex: 1;"
              aria-label="Select Session B"
            >
              <option value="" disabled>Select Session B…</option>
              <option
                v-for="s in sessionOptions"
                :key="s.id"
                :value="s.id"
              >
                {{ s.summary || s.id }}
              </option>
            </select>
            <button
              class="btn btn-primary"
              type="button"
              :disabled="!selectedA || !selectedB || selectedA === selectedB"
              @click="runComparison"
            >
              Compare
            </button>
          </div>
        </div>
      </div>

      <!-- Loading state -->
      <div v-if="loading" class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <h2 class="empty-state-title">Comparing sessions…</h2>
      </div>

      <!-- No comparison yet -->
      <div v-else-if="!comparison" class="empty-state">
        <div class="empty-state-icon">⚖️</div>
        <h2 class="empty-state-title">Select Two Sessions</h2>
        <p class="empty-state-desc">
          Pick two sessions above and click Compare to see a side-by-side analysis.
        </p>
      </div>

      <template v-else>
        <!-- Side-by-Side Diff Panel -->
        <div
          class="diff-panel"
          style="margin-bottom: 20px;"
          role="region"
          aria-label="Side-by-side session comparison"
        >
          <div class="diff-header">Session A: {{ comparison.sessionA.summary }}</div>
          <div class="diff-header">Session B: {{ comparison.sessionB.summary }}</div>

          <!-- Session A Details -->
          <div class="diff-side">
            <p class="diff-summary">{{ comparison.sessionA.summary }}</p>
            <dl class="def-list">
              <dt>Model</dt>
              <dd><span class="badge badge-done">{{ comparison.sessionA.model }}</span></dd>
              <dt>Duration</dt>
              <dd :class="valueCls(comparison.sessionA.duration, comparison.sessionB.duration, false)">
                {{ fmtDurationSec(comparison.sessionA.duration) }}
              </dd>
              <dt>Turns</dt>
              <dd :class="valueCls(comparison.sessionA.turns, comparison.sessionB.turns, false)">
                {{ comparison.sessionA.turns }}
              </dd>
              <dt>Tokens</dt>
              <dd :class="valueCls(comparison.sessionA.tokens, comparison.sessionB.tokens, false)">
                {{ fmtTokens(comparison.sessionA.tokens) }}
              </dd>
              <dt>Cost</dt>
              <dd :class="valueCls(comparison.sessionA.cost, comparison.sessionB.cost, false)">
                {{ fmtCost(comparison.sessionA.cost) }}
              </dd>
              <dt>Files Modified</dt>
              <dd>{{ comparison.sessionA.filesModified }}</dd>
              <dt>Lines Changed</dt>
              <dd :class="valueCls(comparison.sessionA.linesChanged, comparison.sessionB.linesChanged, false)">
                {{ comparison.sessionA.linesChanged }}
              </dd>
            </dl>
          </div>

          <!-- Session B Details -->
          <div class="diff-side">
            <p class="diff-summary">{{ comparison.sessionB.summary }}</p>
            <dl class="def-list">
              <dt>Model</dt>
              <dd><span class="badge badge-done">{{ comparison.sessionB.model }}</span></dd>
              <dt>Duration</dt>
              <dd :class="valueCls(comparison.sessionB.duration, comparison.sessionA.duration, false)">
                {{ fmtDurationSec(comparison.sessionB.duration) }}
              </dd>
              <dt>Turns</dt>
              <dd :class="valueCls(comparison.sessionB.turns, comparison.sessionA.turns, false)">
                {{ comparison.sessionB.turns }}
              </dd>
              <dt>Tokens</dt>
              <dd :class="valueCls(comparison.sessionB.tokens, comparison.sessionA.tokens, false)">
                {{ fmtTokens(comparison.sessionB.tokens) }}
              </dd>
              <dt>Cost</dt>
              <dd :class="valueCls(comparison.sessionB.cost, comparison.sessionA.cost, false)">
                {{ fmtCost(comparison.sessionB.cost) }}
              </dd>
              <dt>Files Modified</dt>
              <dd>{{ comparison.sessionB.filesModified }}</dd>
              <dt>Lines Changed</dt>
              <dd :class="valueCls(comparison.sessionB.linesChanged, comparison.sessionA.linesChanged, false)">
                {{ comparison.sessionB.linesChanged }}
              </dd>
            </dl>
          </div>
        </div>

        <!-- Metrics Comparison Table -->
        <div class="section-panel" style="margin-bottom: 20px;">
          <div class="section-panel-header">Metrics Comparison</div>
          <table class="data-table" aria-label="Metrics comparison between sessions">
            <thead>
              <tr>
                <th>Metric</th>
                <th style="text-align: right;">Session A</th>
                <th style="text-align: right;">Session B</th>
                <th style="text-align: right;">Delta</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in metricsRows" :key="row.label">
                <td>{{ row.label }}</td>
                <td style="text-align: right;">{{ row.valueA }}</td>
                <td style="text-align: right;">{{ row.valueB }}</td>
                <td style="text-align: right;" :class="row.deltaClass">{{ row.delta }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Model Usage Breakdown -->
        <div class="section-panel" style="margin-bottom: 20px;">
          <div class="section-panel-header">Model Usage Breakdown</div>
          <div class="section-panel-body">
            <div class="grid-2">
              <div>
                <h4 class="model-usage-heading">Session A</h4>
                <table class="data-table" aria-label="Session A model usage">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th style="text-align: right;">Tokens</th>
                      <th style="text-align: right;">Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="entry in comparison.modelUsage.sessionA" :key="entry.model">
                      <td><span class="badge badge-accent">{{ entry.model }}</span></td>
                      <td style="text-align: right;">{{ fmtTokens(entry.tokens) }}</td>
                      <td style="text-align: right;">{{ entry.requests }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div>
                <h4 class="model-usage-heading">Session B</h4>
                <table class="data-table" aria-label="Session B model usage">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th style="text-align: right;">Tokens</th>
                      <th style="text-align: right;">Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="entry in comparison.modelUsage.sessionB" :key="entry.model">
                      <td><span class="badge badge-accent">{{ entry.model }}</span></td>
                      <td style="text-align: right;">{{ fmtTokens(entry.tokens) }}</td>
                      <td style="text-align: right;">{{ entry.requests }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- Visual Comparison Bar Chart -->
        <div class="section-panel" style="margin-bottom: 20px;">
          <div class="section-panel-header">Visual Comparison</div>
          <div class="chart-container">
            <svg
              :viewBox="`0 0 700 ${chartHeight + 60}`"
              role="img"
              aria-label="Visual comparison bar chart"
              font-family="Inter, sans-serif"
            >
              <!-- Legend -->
              <circle cx="260" cy="16" r="5" fill="#6366f1" />
              <text x="270" y="20" fill="#a1a1aa" font-size="11" font-weight="500">Session A</text>
              <circle cx="370" cy="16" r="5" fill="#a78bfa" />
              <text x="380" y="20" fill="#a1a1aa" font-size="11" font-weight="500">Session B</text>

              <!-- Grid lines -->
              <line
                v-for="i in 5"
                :key="'grid-' + i"
                x1="60"
                :y1="barBaseline - (i - 1) * (barAreaHeight / 4)"
                x2="680"
                :y2="barBaseline - (i - 1) * (barAreaHeight / 4)"
                stroke="#27272a"
                stroke-width="0.5"
              />

              <!-- Baseline -->
              <line x1="60" :y1="barBaseline" x2="680" :y2="barBaseline" stroke="#3f3f46" stroke-width="1" />

              <!-- Bar groups -->
              <g
                v-for="(group, idx) in barGroups"
                :key="group.label"
                :transform="`translate(${80 + idx * 110}, 0)`"
              >
                <!-- Bar A -->
                <rect
                  x="0"
                  :y="barBaseline - barHeight(group.valueA, group)"
                  width="30"
                  :height="barHeight(group.valueA, group)"
                  rx="3"
                  fill="#6366f1"
                  opacity="0.9"
                />
                <!-- Bar B -->
                <rect
                  x="34"
                  :y="barBaseline - barHeight(group.valueB, group)"
                  width="30"
                  :height="barHeight(group.valueB, group)"
                  rx="3"
                  fill="#a78bfa"
                  opacity="0.9"
                />
                <!-- Value labels -->
                <text
                  x="15"
                  :y="barBaseline - barHeight(group.valueA, group) - 4"
                  fill="#fafafa"
                  font-size="9"
                  text-anchor="middle"
                >{{ group.displayA }}</text>
                <text
                  x="49"
                  :y="barBaseline - barHeight(group.valueB, group) - 4"
                  fill="#fafafa"
                  font-size="9"
                  text-anchor="middle"
                >{{ group.displayB }}</text>
                <!-- Group label -->
                <text
                  x="32"
                  :y="barBaseline + 18"
                  fill="#a1a1aa"
                  font-size="10"
                  text-anchor="middle"
                >{{ group.label }}</text>
              </g>
            </svg>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.session-selector-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.vs-label {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  font-weight: 600;
  flex-shrink: 0;
}

.diff-summary {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-bottom: 12px;
  line-height: 1.6;
}

.delta-positive { color: var(--success-fg); font-weight: 600; }
.delta-negative { color: var(--danger-fg); font-weight: 600; }
.delta-neutral  { color: var(--text-secondary); }

.value-better { color: var(--success-fg); }
.value-worse  { color: var(--danger-fg); }

.model-usage-heading {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.chart-container {
  padding: 16px;
  display: flex;
  justify-content: center;
}

.chart-container svg {
  max-width: 100%;
  height: auto;
}
</style>
