<script setup lang="ts">
import { formatCost, formatNumber, formatPercent } from '@tracepilot/ui';
import { computed, onMounted, ref, watch } from 'vue';
import AnalyticsPageHeader from '@/components/AnalyticsPageHeader.vue';
import LoadingOverlay from '@/components/LoadingOverlay.vue';
import { useAnalyticsStore } from '@/stores/analytics';
import { usePreferencesStore } from '@/stores/preferences';
import { MODEL_PALETTE } from '@/utils/chartColors';

const store = useAnalyticsStore();
const prefs = usePreferencesStore();

onMounted(() => {
  store.fetchAvailableRepos();
  store.fetchAnalytics();
});

watch(
  [() => store.selectedRepo, () => store.dateRange],
  () => {
    store.fetchAnalytics({ force: true });
  },
  { deep: true },
);

const loading = computed(() => store.analyticsLoading);
const data = computed(() => store.analytics);

const pageSubtitle = computed(() => {
  const repoSuffix = store.selectedRepo ? ` in ${store.selectedRepo}` : '';
  return `Performance and cost metrics across all models${repoSuffix}`;
});

// ── Constants ────────────────────────────────────────────────
const MODEL_COLORS = MODEL_PALETTE;

// ── Enriched model data ──────────────────────────────────────
interface ModelRow {
  model: string;
  color: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  percentage: number;
  premiumRequests: number;
  cacheHitRate: number;
  cost: number | null;
  copilotCost: number;
}

const modelRows = computed<ModelRow[]>(() => {
  if (!data.value?.modelDistribution) return [];
  const dist = data.value.modelDistribution;
  // Correct total: inputTokens + outputTokens (inputTokens already includes cacheReadTokens)
  const grandTotal = dist.reduce((sum, m) => sum + m.inputTokens + m.outputTokens, 0);
  return dist.map((m, i) => {
    const tokens = m.inputTokens + m.outputTokens;
    const percentage = grandTotal > 0 ? (tokens / grandTotal) * 100 : 0;
    const premiumRequests = m.premiumRequests;
    const cacheHitRate = m.inputTokens > 0 ? (m.cacheReadTokens / m.inputTokens) * 100 : 0;
    const cost = prefs.computeWholesaleCost(
      m.model,
      m.inputTokens,
      m.cacheReadTokens,
      m.outputTokens,
    );
    const copilotCost = premiumRequests * prefs.costPerPremiumRequest;
    return {
      model: m.model,
      color: MODEL_COLORS[i % MODEL_COLORS.length],
      tokens,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheReadTokens: m.cacheReadTokens,
      percentage,
      premiumRequests,
      cacheHitRate,
      cost,
      copilotCost,
    };
  });
});

const totalTokens = computed(() => modelRows.value.reduce((sum, m) => sum + m.tokens, 0));
const totalCost = computed(() => modelRows.value.reduce((sum, m) => sum + (m.cost ?? 0), 0));
const totalCopilotCost = computed(() => modelRows.value.reduce((sum, m) => sum + m.copilotCost, 0));
const modelCount = computed(() => modelRows.value.length);

// ── Cost & normalization toggles ─────────────────────────────
type CostMode = 'wholesale' | 'copilot' | 'both';
const costMode = ref<CostMode>('both');

type NormMode = 'raw' | 'per-10m-tokens' | 'share';
const normMode = ref<NormMode>('raw');

// ── Best/worst highlighting ──────────────────────────────────
function bestIdx(arr: number[], higher = true): number {
  if (!arr.length) return -1;
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (higher ? arr[i] > arr[best] : arr[i] < arr[best]) best = i;
  }
  return best;
}

const bestCacheIdx = computed(() => bestIdx(modelRows.value.map((m) => m.cacheHitRate)));
const bestCostIdx = computed(() => {
  const costs = modelRows.value.map((m) => m.cost ?? Infinity);
  if (costs.every((c) => c === Infinity)) return -1;
  return bestIdx(costs, false);
});
const bestCopilotCostIdx = computed(() =>
  bestIdx(
    modelRows.value.map((m) => m.copilotCost),
    false,
  ),
);

// ── Sort state ───────────────────────────────────────────────
type SortKey =
  | 'model'
  | 'tokens'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'percentage'
  | 'premiumRequests'
  | 'cacheHitRate'
  | 'cost'
  | 'copilotCost';
const sortKey = ref<SortKey>('tokens');
const sortDir = ref<'asc' | 'desc'>('desc');

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortDir.value = key === 'model' ? 'asc' : 'desc';
  }
}

const sortedRows = computed(() => {
  const rows = [...modelRows.value];
  const dir = sortDir.value === 'asc' ? 1 : -1;
  const key = sortKey.value;
  return rows.sort((a, b) => {
    if (key === 'model') return dir * a.model.localeCompare(b.model);
    if (key === 'cost') {
      const ac = a.cost ?? Infinity;
      const bc = b.cost ?? Infinity;
      if (ac === Infinity && bc === Infinity) return 0;
      if (ac === Infinity) return 1;
      if (bc === Infinity) return -1;
      return dir * (ac - bc);
    }
    return dir * ((a[key] as number) - (b[key] as number));
  });
});

function sortArrow(key: SortKey): string {
  if (sortKey.value !== key) return '⇅';
  return sortDir.value === 'asc' ? '↑' : '↓';
}

// ── Normalized display rows ──────────────────────────────────
const displayRows = computed<ModelRow[]>(() => {
  const rows = sortedRows.value;
  if (normMode.value === 'raw') return rows;

  if (normMode.value === 'per-10m-tokens') {
    return rows.map((r) => {
      const divisor = r.tokens / 10_000_000 || 1;
      return {
        ...r,
        tokens: r.tokens / divisor,
        inputTokens: r.inputTokens / divisor,
        outputTokens: r.outputTokens / divisor,
        cacheReadTokens: r.cacheReadTokens / divisor,
        premiumRequests: r.premiumRequests / divisor,
        cost: r.cost != null ? r.cost / divisor : null,
        copilotCost: r.copilotCost / divisor,
      };
    });
  }

  // share mode
  const sums = rows.reduce(
    (acc, r) => ({
      tokens: acc.tokens + r.tokens,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
      premiumRequests: acc.premiumRequests + r.premiumRequests,
      cost: acc.cost + (r.cost ?? 0),
      copilotCost: acc.copilotCost + r.copilotCost,
    }),
    {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      premiumRequests: 0,
      cost: 0,
      copilotCost: 0,
    },
  );

  return rows.map((r) => ({
    ...r,
    tokens: sums.tokens > 0 ? (r.tokens / sums.tokens) * 100 : 0,
    inputTokens: sums.inputTokens > 0 ? (r.inputTokens / sums.inputTokens) * 100 : 0,
    outputTokens: sums.outputTokens > 0 ? (r.outputTokens / sums.outputTokens) * 100 : 0,
    cacheReadTokens:
      sums.cacheReadTokens > 0 ? (r.cacheReadTokens / sums.cacheReadTokens) * 100 : 0,
    premiumRequests:
      sums.premiumRequests > 0 ? (r.premiumRequests / sums.premiumRequests) * 100 : 0,
    cost: sums.cost > 0 ? ((r.cost ?? 0) / sums.cost) * 100 : 0,
    copilotCost: sums.copilotCost > 0 ? (r.copilotCost / sums.copilotCost) * 100 : 0,
  }));
});

function fmtNorm(value: number | null, isCost = false): string {
  if (value == null) return '—';
  if (normMode.value === 'share') return `${value.toFixed(1)}%`;
  if (isCost) {
    // Compact cost format for large values
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return formatCost(value);
  }
  if (normMode.value === 'per-10m-tokens') {
    if (Math.abs(value) >= 1_000) return formatNumber(value);
    return value % 1 === 0 ? value.toString() : value.toFixed(1);
  }
  return formatNumber(value);
}

// ── Radar chart (top 3 by tokens) ────────────────────────────
const radarModels = computed(() => {
  return [...modelRows.value].sort((a, b) => b.tokens - a.tokens).slice(0, 3);
});

const radarAxes = ['Token Vol.', 'Cache Eff.', 'Premium Req.', 'Cost Eff.', 'Token Share'];

function radarValues(row: ModelRow): number[] {
  const maxTokens = Math.max(...modelRows.value.map((m) => m.tokens), 1);
  const tokenVol = row.tokens / maxTokens;
  const cacheEff = row.cacheHitRate / 100;
  const maxPR = Math.max(...modelRows.value.map((m) => m.premiumRequests), 1);
  const prShare = row.premiumRequests / maxPR;
  const costPerToken = row.cost != null && row.tokens > 0 ? row.cost / row.tokens : 0;
  const maxCostPerToken = Math.max(
    ...modelRows.value.map((m) => (m.cost ?? 0) / Math.max(m.tokens, 1)),
    0.0001,
  );
  const costEff = 1 - Math.min(costPerToken / maxCostPerToken, 1);
  const share = row.percentage / 100;
  return [tokenVol, cacheEff, prShare, costEff, share];
}

const RADAR_CX = 150;
const RADAR_CY = 130;
const RADAR_R = 90;

function radarPoint(axisIdx: number, value: number): { x: number; y: number } {
  const angle = (Math.PI * 2 * axisIdx) / 5 - Math.PI / 2;
  return {
    x: RADAR_CX + Math.cos(angle) * RADAR_R * value,
    y: RADAR_CY + Math.sin(angle) * RADAR_R * value,
  };
}

function radarPolygon(values: number[]): string {
  return values
    .map((v, i) => {
      const p = radarPoint(i, v);
      return `${p.x},${p.y}`;
    })
    .join(' ');
}

function radarAxisEnd(idx: number): { x: number; y: number } {
  return radarPoint(idx, 1);
}

function radarLabelPos(idx: number): { x: number; y: number; anchor: string } {
  const p = radarPoint(idx, 1.2);
  const angle = (Math.PI * 2 * idx) / 5 - Math.PI / 2;
  let anchor = 'middle';
  if (Math.cos(angle) > 0.3) anchor = 'start';
  else if (Math.cos(angle) < -0.3) anchor = 'end';
  return { x: p.x, y: p.y, anchor };
}

// ── Scatter plot ─────────────────────────────────────────────
const SCATTER_W = 500;
const SCATTER_H = 250;
const SCATTER_PAD = { top: 20, right: 30, bottom: 40, left: 70 };

const scatterScale = computed(() => {
  const maxT = Math.max(...modelRows.value.map((m) => m.tokens), 1);
  const maxC = Math.max(...modelRows.value.map((m) => m.cost ?? 0), 0.01);
  return { maxT, maxC };
});

function scatterX(tokens: number): number {
  return (
    SCATTER_PAD.left +
    (tokens / scatterScale.value.maxT) * (SCATTER_W - SCATTER_PAD.left - SCATTER_PAD.right)
  );
}

function scatterY(cost: number): number {
  return (
    SCATTER_H -
    SCATTER_PAD.bottom -
    (cost / scatterScale.value.maxC) * (SCATTER_H - SCATTER_PAD.top - SCATTER_PAD.bottom)
  );
}

function scatterRadius(cacheHitRate: number): number {
  return 6 + (cacheHitRate / 100) * 14;
}

// ── Side-by-side comparison ──────────────────────────────────
const compareA = ref<string>('');
const compareB = ref<string>('');

watch(
  modelRows,
  (rows) => {
    if (rows.length >= 2) {
      if (!compareA.value || !rows.find((r) => r.model === compareA.value))
        compareA.value = rows[0].model;
      if (!compareB.value || !rows.find((r) => r.model === compareB.value))
        compareB.value = rows[1].model;
    } else if (rows.length === 1) {
      compareA.value = rows[0].model;
      compareB.value = '';
    }
  },
  { immediate: true },
);

const compareRowA = computed(() => displayRows.value.find((r) => r.model === compareA.value));
const compareRowB = computed(() => displayRows.value.find((r) => r.model === compareB.value));

interface CompareMetric {
  label: string;
  valueA: string;
  valueB: string;
  delta: string;
  direction: 'up' | 'down' | 'neutral';
  better: 'a' | 'b' | 'neutral';
}

const compareMetrics = computed<CompareMetric[]>(() => {
  const a = compareRowA.value;
  const b = compareRowB.value;
  if (!a || !b) return [];

  function delta(
    va: number,
    vb: number,
    higherIsBetter: boolean,
  ): Pick<CompareMetric, 'delta' | 'direction' | 'better'> {
    const diff = va - vb;
    if (Math.abs(diff) < 0.001) return { delta: '—', direction: 'neutral', better: 'neutral' };
    const pct = vb !== 0 ? ((diff / Math.abs(vb)) * 100).toFixed(1) : '∞';
    const dir = diff > 0 ? 'up' : 'down';
    const better = higherIsBetter ? (diff > 0 ? 'a' : 'b') : diff < 0 ? 'a' : 'b';
    return { delta: `${diff > 0 ? '+' : ''}${pct}%`, direction: dir as 'up' | 'down', better };
  }

  return [
    {
      label: 'Total Tokens',
      valueA: fmtNorm(a.tokens),
      valueB: fmtNorm(b.tokens),
      ...delta(a.tokens, b.tokens, true),
    },
    {
      label: 'Input Tokens',
      valueA: fmtNorm(a.inputTokens),
      valueB: fmtNorm(b.inputTokens),
      ...delta(a.inputTokens, b.inputTokens, true),
    },
    {
      label: 'Output Tokens',
      valueA: fmtNorm(a.outputTokens),
      valueB: fmtNorm(b.outputTokens),
      ...delta(a.outputTokens, b.outputTokens, true),
    },
    {
      label: 'Cache Read',
      valueA: fmtNorm(a.cacheReadTokens),
      valueB: fmtNorm(b.cacheReadTokens),
      ...delta(a.cacheReadTokens, b.cacheReadTokens, true),
    },
    {
      label: 'Token Share',
      valueA: formatPercent(a.percentage),
      valueB: formatPercent(b.percentage),
      ...delta(a.percentage, b.percentage, true),
    },
    {
      label: 'Premium Requests',
      valueA: fmtNorm(a.premiumRequests),
      valueB: fmtNorm(b.premiumRequests),
      ...delta(a.premiumRequests, b.premiumRequests, true),
    },
    {
      label: 'Cache Hit Rate',
      valueA: formatPercent(a.cacheHitRate),
      valueB: formatPercent(b.cacheHitRate),
      ...delta(a.cacheHitRate, b.cacheHitRate, true),
    },
    {
      label: 'Wholesale Cost',
      valueA: fmtNorm(a.cost, true),
      valueB: fmtNorm(b.cost, true),
      ...delta(a.cost ?? 0, b.cost ?? 0, false),
    },
    {
      label: 'Copilot Cost',
      valueA: fmtNorm(a.copilotCost, true),
      valueB: fmtNorm(b.copilotCost, true),
      ...delta(a.copilotCost, b.copilotCost, false),
    },
  ];
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <LoadingOverlay :loading="loading" message="Loading model comparison…">
        <div v-if="store.analyticsError" class="error-state">
          <p>Failed to load analytics: {{ store.analyticsError }}</p>
          <button class="btn btn-primary" @click="store.fetchAnalytics({ force: true })">Retry</button>
        </div>

        <template v-else-if="data">
          <AnalyticsPageHeader title="Model Comparison" :subtitle="pageSubtitle" />

          <!-- Empty State -->
          <div v-if="modelRows.length === 0" class="empty-state">
            <div class="empty-state-icon">🤖</div>
            <div class="empty-state-title">No Model Data</div>
            <p class="empty-state-message">No model usage data found for the selected time range and repository.</p>
          </div>

          <template v-else>
            <!-- Stat Cards -->
            <div class="grid-4 mb-4">
              <div class="stat-card">
                <div class="stat-card-value accent">{{ modelCount }}</div>
                <div class="stat-card-label">Models Used</div>
              </div>
              <div class="stat-card">
                <div class="stat-card-value done">{{ formatNumber(totalTokens) }}</div>
                <div class="stat-card-label">Total Tokens</div>
              </div>
              <div class="stat-card">
                <div class="stat-card-value success">{{ formatCost(totalCost) }}</div>
                <div class="stat-card-label">Wholesale Cost</div>
              </div>
              <div class="stat-card">
                <div class="stat-card-value warning">{{ formatCost(totalCopilotCost) }}</div>
                <div class="stat-card-label">Copilot Cost</div>
              </div>
            </div>

            <!-- Model Cards Row -->
            <div class="model-cards-row mb-4">
              <div v-for="row in modelRows" :key="row.model" class="model-card">
                <div class="model-card-name">
                  <span class="model-dot" :style="{ background: row.color }" />
                  <span class="model-card-name-text" :title="row.model">{{ row.model }}</span>
                </div>
                <div class="model-card-stats">
                  <div>
                    <div class="model-card-stat-label">Tokens</div>
                    <div class="model-card-stat-value">{{ formatNumber(row.tokens) }}</div>
                  </div>
                  <div>
                    <div class="model-card-stat-label">Wholesale Cost</div>
                    <div class="model-card-stat-value">{{ formatCost(row.cost) }}</div>
                  </div>
                  <div>
                    <div class="model-card-stat-label">Cache Hit</div>
                    <div class="model-card-stat-value">{{ formatPercent(row.cacheHitRate) }}</div>
                  </div>
                  <div>
                    <div class="model-card-stat-label">Premium Req.</div>
                    <div class="model-card-stat-value">{{ formatNumber(row.premiumRequests) }}</div>
                  </div>
                </div>
                <!-- Token share bar -->
                <div class="token-share-bar">
                  <div class="token-share-fill" :style="{ width: `${row.percentage}%`, background: row.color }" />
                </div>
                <div class="token-share-label">{{ formatPercent(row.percentage) }} of total tokens</div>
              </div>
            </div>

            <!-- Performance Matrix Table -->
            <div class="section-panel mb-4">
              <div class="section-panel-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <span>Performance Matrix</span>
                <div class="matrix-toggles">
                  <div class="cost-toggle">
                    <button :class="['toggle-btn', { active: costMode === 'wholesale' }]" @click="costMode = 'wholesale'">Wholesale</button>
                    <button :class="['toggle-btn', { active: costMode === 'copilot' }]" @click="costMode = 'copilot'">Copilot</button>
                    <button :class="['toggle-btn', { active: costMode === 'both' }]" @click="costMode = 'both'">Both</button>
                  </div>
                  <div class="norm-toggle">
                    <button :class="['toggle-btn', { active: normMode === 'raw' }]" @click="normMode = 'raw'">Raw</button>
                    <button :class="['toggle-btn', { active: normMode === 'per-10m-tokens' }]" @click="normMode = 'per-10m-tokens'">Per 10M Tokens</button>
                    <button :class="['toggle-btn', { active: normMode === 'share' }]" @click="normMode = 'share'">Share %</button>
                  </div>
                </div>
              </div>
              <div class="section-panel-body scrollable-section" style="padding: 0;">
                <table class="data-table matrix-table" aria-label="Model performance comparison matrix">
                  <colgroup>
                    <col style="width: 18%;" />
                    <col style="width: 11%;" />
                    <col style="width: 11%;" />
                    <col style="width: 9%;" />
                    <col style="width: 9%;" />
                    <col style="width: 13%;" />
                    <col style="width: 8%;" />
                    <col style="width: 8%;" />
                    <col v-if="costMode !== 'copilot'" style="width: 8%;" />
                    <col v-if="costMode !== 'wholesale'" style="width: 8%;" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th class="sort-header" @click="toggleSort('model')">
                        Model <span class="sort-arrow">{{ sortArrow('model') }}</span>
                      </th>
                      <th class="sort-header" @click="toggleSort('tokens')">
                        Total <span class="sort-arrow">{{ sortArrow('tokens') }}</span>
                      </th>
                      <th class="sort-header" @click="toggleSort('inputTokens')">
                        Input <span class="sort-arrow">{{ sortArrow('inputTokens') }}</span>
                      </th>
                      <th class="sort-header" @click="toggleSort('outputTokens')">
                        Output <span class="sort-arrow">{{ sortArrow('outputTokens') }}</span>
                      </th>
                      <th class="sort-header" @click="toggleSort('cacheReadTokens')">
                        Cached <span class="sort-arrow">{{ sortArrow('cacheReadTokens') }}</span>
                      </th>
                      <th class="sort-header" @click="toggleSort('percentage')">
                        Share <span class="sort-arrow">{{ sortArrow('percentage') }}</span>
                      </th>
                      <th class="sort-header" @click="toggleSort('premiumRequests')">
                        Prem. Req. <span class="sort-arrow">{{ sortArrow('premiumRequests') }}</span>
                      </th>
                      <th class="sort-header" @click="toggleSort('cacheHitRate')">
                        Cache Hit <span class="sort-arrow">{{ sortArrow('cacheHitRate') }}</span>
                      </th>
                      <th v-if="costMode !== 'copilot'" class="sort-header" @click="toggleSort('cost')">
                        W. Cost <span class="sort-arrow">{{ sortArrow('cost') }}</span>
                      </th>
                      <th v-if="costMode !== 'wholesale'" class="sort-header" @click="toggleSort('copilotCost')">
                        CP Cost <span class="sort-arrow">{{ sortArrow('copilotCost') }}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in displayRows" :key="row.model">
                      <td>
                        <span class="model-name-cell">
                          <span class="model-dot" :style="{ background: row.color }" />
                          {{ row.model }}
                        </span>
                      </td>
                      <td class="num-cell">{{ fmtNorm(row.tokens) }}</td>
                      <td class="num-cell">{{ fmtNorm(row.inputTokens) }}</td>
                      <td class="num-cell">{{ fmtNorm(row.outputTokens) }}</td>
                      <td class="num-cell">{{ fmtNorm(row.cacheReadTokens) }}</td>
                      <td class="num-cell">
                        <div class="inline-progress">
                          <span>{{ formatPercent(row.percentage) }}</span>
                          <div class="inline-progress-bar">
                            <div class="inline-progress-fill" :style="{ width: `${row.percentage}%`, background: row.color }" />
                          </div>
                        </div>
                      </td>
                      <td class="num-cell">
                        {{ fmtNorm(row.premiumRequests) }}
                      </td>
                      <td class="num-cell">
                        <span :class="{ 'best-cell': row.model === modelRows[bestCacheIdx]?.model }">
                          {{ formatPercent(row.cacheHitRate) }}
                        </span>
                      </td>
                      <td v-if="costMode !== 'copilot'" class="num-cell">
                        <span :class="{ 'best-cell': row.model === modelRows[bestCostIdx]?.model }">
                          {{ fmtNorm(row.cost, true) }}
                        </span>
                      </td>
                      <td v-if="costMode !== 'wholesale'" class="num-cell">
                        <span :class="{ 'best-cell': row.model === modelRows[bestCopilotCostIdx]?.model }">
                          {{ fmtNorm(row.copilotCost, true) }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Radar + Scatter -->
            <div class="grid-2 mb-4">
              <!-- Radar Chart -->
              <div class="section-panel">
                <div class="section-panel-header">Capability Radar (Top 3)</div>
                <div class="section-panel-body">
                  <div v-if="radarModels.length < 2" class="chart-placeholder">
                    Need at least 2 models for radar comparison.
                  </div>
                  <template v-else>
                    <div class="legend">
                      <span v-for="rm in radarModels" :key="rm.model">
                        <span class="legend-dot" :style="{ background: rm.color }" />&nbsp;{{ rm.model }}
                      </span>
                    </div>
                    <svg class="chart-svg" :viewBox="`0 0 300 260`" role="img" aria-label="Radar chart comparing model capabilities">
                      <!-- Grid rings -->
                      <polygon
                        v-for="ring in [0.25, 0.5, 0.75, 1]"
                        :key="`ring-${ring}`"
                        :points="Array.from({ length: 5 }, (_, i) => { const p = radarPoint(i, ring); return `${p.x},${p.y}`; }).join(' ')"
                        fill="none"
                        stroke="var(--border-default)"
                        stroke-width="0.5"
                        opacity="0.5"
                      />
                      <!-- Axis lines -->
                      <line
                        v-for="(_, ai) in radarAxes"
                        :key="`axis-${ai}`"
                        :x1="RADAR_CX"
                        :y1="RADAR_CY"
                        :x2="radarAxisEnd(ai).x"
                        :y2="radarAxisEnd(ai).y"
                        stroke="var(--border-default)"
                        stroke-width="0.5"
                        opacity="0.5"
                      />
                      <!-- Axis labels -->
                      <text
                        v-for="(label, ai) in radarAxes"
                        :key="`label-${ai}`"
                        :x="radarLabelPos(ai).x"
                        :y="radarLabelPos(ai).y"
                        :text-anchor="radarLabelPos(ai).anchor"
                        font-size="9"
                        fill="var(--text-tertiary)"
                        font-family="Inter, sans-serif"
                      >{{ label }}</text>
                      <!-- Model polygons -->
                      <polygon
                        v-for="rm in radarModels"
                        :key="`poly-${rm.model}`"
                        :points="radarPolygon(radarValues(rm))"
                        :fill="rm.color"
                        fill-opacity="0.12"
                        :stroke="rm.color"
                        stroke-width="1.5"
                      />
                      <!-- Model dots -->
                      <template v-for="rm in radarModels" :key="`dots-${rm.model}`">
                        <circle
                          v-for="(v, vi) in radarValues(rm)"
                          :key="`dot-${rm.model}-${vi}`"
                          :cx="radarPoint(vi, v).x"
                          :cy="radarPoint(vi, v).y"
                          r="3"
                          :fill="rm.color"
                        />
                      </template>
                    </svg>
                  </template>
                </div>
              </div>

              <!-- Scatter Plot -->
              <div class="section-panel">
                <div class="section-panel-header">Cost vs Token Volume</div>
                <div class="section-panel-body">
                  <div v-if="modelRows.length < 2 || modelRows.every(m => m.cost == null)" class="chart-placeholder">
                    Need at least 2 models with cost data for scatter plot.
                  </div>
                  <template v-else>
                    <div class="legend">
                      <span v-for="row in modelRows" :key="row.model">
                        <span class="legend-dot" :style="{ background: row.color }" />&nbsp;{{ row.model }}
                      </span>
                    </div>
                    <svg class="chart-svg" :viewBox="`0 0 ${SCATTER_W} ${SCATTER_H}`" role="img" aria-label="Scatter plot of cost vs token volume">
                      <!-- Grid lines -->
                      <line
                        v-for="i in 4"
                        :key="`gx-${i}`"
                        :x1="SCATTER_PAD.left"
                        :y1="SCATTER_PAD.top + (i - 1) * ((SCATTER_H - SCATTER_PAD.top - SCATTER_PAD.bottom) / 3)"
                        :x2="SCATTER_W - SCATTER_PAD.right"
                        :y2="SCATTER_PAD.top + (i - 1) * ((SCATTER_H - SCATTER_PAD.top - SCATTER_PAD.bottom) / 3)"
                        stroke="var(--border-default)"
                        stroke-width="0.5"
                        opacity="0.3"
                      />
                      <!-- Axes -->
                      <line :x1="SCATTER_PAD.left" :y1="SCATTER_H - SCATTER_PAD.bottom" :x2="SCATTER_W - SCATTER_PAD.right" :y2="SCATTER_H - SCATTER_PAD.bottom" stroke="var(--border-default)" stroke-width="1" />
                      <line :x1="SCATTER_PAD.left" :y1="SCATTER_PAD.top" :x2="SCATTER_PAD.left" :y2="SCATTER_H - SCATTER_PAD.bottom" stroke="var(--border-default)" stroke-width="1" />
                      <!-- X-axis label -->
                      <text :x="(SCATTER_PAD.left + SCATTER_W - SCATTER_PAD.right) / 2" :y="SCATTER_H - 6" text-anchor="middle" font-size="10" fill="var(--text-tertiary)" font-family="Inter, sans-serif">Total Tokens</text>
                      <!-- Y-axis label -->
                      <text :x="14" :y="(SCATTER_PAD.top + SCATTER_H - SCATTER_PAD.bottom) / 2" text-anchor="middle" font-size="10" fill="var(--text-tertiary)" font-family="Inter, sans-serif" transform="rotate(-90, 14, 135)">Wholesale Cost ($)</text>
                      <!-- Scale labels -->
                      <text :x="SCATTER_PAD.left - 8" :y="SCATTER_H - SCATTER_PAD.bottom + 4" text-anchor="end" font-size="8" fill="var(--text-tertiary)" font-family="Inter, sans-serif">$0</text>
                      <text :x="SCATTER_PAD.left - 8" :y="SCATTER_PAD.top + 4" text-anchor="end" font-size="8" fill="var(--text-tertiary)" font-family="Inter, sans-serif">{{ formatCost(scatterScale.maxC) }}</text>
                      <text :x="SCATTER_PAD.left" :y="SCATTER_H - SCATTER_PAD.bottom + 16" text-anchor="start" font-size="8" fill="var(--text-tertiary)" font-family="Inter, sans-serif">0</text>
                      <text :x="SCATTER_W - SCATTER_PAD.right" :y="SCATTER_H - SCATTER_PAD.bottom + 16" text-anchor="end" font-size="8" fill="var(--text-tertiary)" font-family="Inter, sans-serif">{{ formatNumber(scatterScale.maxT) }}</text>
                      <!-- Data points -->
                      <g v-for="row in modelRows" :key="`scatter-${row.model}`">
                        <circle
                          :cx="scatterX(row.tokens)"
                          :cy="scatterY(row.cost ?? 0)"
                          :r="scatterRadius(row.cacheHitRate)"
                          :fill="row.color"
                          fill-opacity="0.6"
                          :stroke="row.color"
                          stroke-width="1.5"
                        >
                          <title>{{ row.model }}: {{ formatNumber(row.tokens) }} tokens, {{ formatCost(row.cost) }}, {{ formatPercent(row.cacheHitRate) }} cache</title>
                        </circle>
                        <text
                          :x="scatterX(row.tokens)"
                          :y="scatterY(row.cost ?? 0) - scatterRadius(row.cacheHitRate) - 4"
                          text-anchor="middle"
                          font-size="8"
                          fill="var(--text-secondary)"
                          font-family="Inter, sans-serif"
                        >{{ row.model }}</text>
                      </g>
                    </svg>
                    <div class="scatter-hint">Bubble size = cache efficiency</div>
                  </template>
                </div>
              </div>
            </div>

            <!-- Side-by-Side Comparison -->
            <div class="section-panel mb-4">
              <div class="section-panel-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <span>Side-by-Side Comparison</span>
                <div class="norm-toggle">
                  <button :class="['toggle-btn', { active: normMode === 'raw' }]" @click="normMode = 'raw'">Raw</button>
                  <button :class="['toggle-btn', { active: normMode === 'per-10m-tokens' }]" @click="normMode = 'per-10m-tokens'">Per 10M Tokens</button>
                  <button :class="['toggle-btn', { active: normMode === 'share' }]" @click="normMode = 'share'">Share %</button>
                </div>
              </div>
              <div class="section-panel-body">
                <div v-if="modelRows.length < 2" class="chart-placeholder">
                  Need at least 2 models for side-by-side comparison.
                </div>
                <template v-else>
                  <div class="compare-selectors">
                    <select v-model="compareA" class="filter-select" aria-label="Select first model">
                      <option v-for="row in modelRows" :key="row.model" :value="row.model">{{ row.model }}</option>
                    </select>
                    <span class="compare-vs">vs</span>
                    <select v-model="compareB" class="filter-select" aria-label="Select second model">
                      <option v-for="row in modelRows" :key="row.model" :value="row.model">{{ row.model }}</option>
                    </select>
                  </div>
                  <table class="data-table compare-table" aria-label="Side-by-side model comparison">
                    <colgroup>
                      <col style="width: 25%;" />
                      <col style="width: 25%;" />
                      <col style="width: 25%;" />
                      <col style="width: 25%;" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>
                          <span class="model-name-cell">
                            <span class="model-dot" :style="{ background: compareRowA?.color }" />
                            {{ compareA }}
                          </span>
                        </th>
                        <th>Delta</th>
                        <th>
                          <span class="model-name-cell">
                            <span class="model-dot" :style="{ background: compareRowB?.color }" />
                            {{ compareB }}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="metric in compareMetrics" :key="metric.label">
                        <td style="font-weight: 500;">{{ metric.label }}</td>
                        <td class="num-cell" :class="{ 'compare-better': metric.better === 'a' }">{{ metric.valueA }}</td>
                        <td class="num-cell delta-cell">
                          <span :class="`delta-${metric.direction}`">
                            {{ metric.direction === 'up' ? '↑' : metric.direction === 'down' ? '↓' : '' }}
                            {{ metric.delta }}
                          </span>
                        </td>
                        <td class="num-cell" :class="{ 'compare-better': metric.better === 'b' }">{{ metric.valueB }}</td>
                      </tr>
                    </tbody>
                  </table>
                </template>
              </div>
            </div>
          </template>
        </template>
      </LoadingOverlay>
    </div>
  </div>
</template>

<style scoped>
/* ── Empty State ──────────────────────────────────────────── */
.empty-state {
  text-align: center;
  padding: 60px 20px;
}
.empty-state-icon {
  font-size: 3rem;
  margin-bottom: 12px;
}
.empty-state-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.empty-state-message {
  font-size: 0.875rem;
  color: var(--text-tertiary);
}

/* ── Model Cards Row ──────────────────────────────────────── */
.model-cards-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.model-card {
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg, 12px);
  padding: 16px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.model-card:hover {
  border-color: var(--border-accent, var(--chart-primary));
  box-shadow: 0 0 0 1px var(--border-accent, var(--chart-primary));
}

.model-card-name {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.model-card-name-text {
  font-weight: 600;
  font-size: 0.8125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}

.model-card-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin-bottom: 12px;
}
.model-card-stat-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-weight: 500;
}
.model-card-stat-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.token-share-bar {
  height: 6px;
  background: var(--neutral-muted, rgba(99, 102, 241, 0.08));
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 4px;
}
.token-share-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.token-share-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

/* ── Performance Matrix Table ─────────────────────────────── */
.matrix-table,
.compare-table {
  table-layout: fixed;
  width: 100%;
}
.matrix-table td,
.compare-table td {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sort-header {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.sort-header:hover {
  color: var(--accent-fg, var(--chart-primary-light));
}
.sort-arrow {
  font-size: 0.6rem;
  margin-left: 4px;
  opacity: 0.5;
}
.sort-header:hover .sort-arrow {
  opacity: 1;
}

.num-cell {
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.model-name-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.best-cell {
  background: rgba(52, 211, 153, 0.08);
  border-radius: 4px;
  padding: 2px 6px;
  margin: -2px -6px;
  display: inline-block;
  color: var(--chart-success);
  font-weight: 600;
}

.inline-progress {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.inline-progress-bar {
  flex: 1;
  height: 6px;
  background: var(--neutral-muted, rgba(99, 102, 241, 0.08));
  border-radius: 3px;
  overflow: hidden;
}
.inline-progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

/* ── Scrollable Sections ──────────────────────────────────── */
.scrollable-section {
  max-height: 500px;
  overflow-y: auto;
}

/* ── Charts ───────────────────────────────────────────────── */
.chart-svg {
  width: 100%;
  height: auto;
  display: block;
}

.legend {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 0.75rem;
  color: var(--text-secondary, #a1a1aa);
  flex-wrap: wrap;
}
.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 5px;
}

.chart-placeholder {
  text-align: center;
  padding: 40px 16px;
  color: var(--text-tertiary);
  font-size: 0.875rem;
}

.scatter-hint {
  text-align: center;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 8px;
}

/* ── Side-by-Side Comparison ──────────────────────────────── */
.compare-selectors {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.compare-vs {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.compare-table th:nth-child(3),
.compare-table td:nth-child(3) {
  text-align: center;
  width: 100px;
}

.compare-better {
  background: rgba(52, 211, 153, 0.06);
}

.delta-cell {
  text-align: center !important;
  font-size: 0.8125rem;
  font-weight: 500;
}
.delta-up {
  color: var(--chart-success);
}
.delta-down {
  color: var(--chart-danger);
}
.delta-neutral {
  color: var(--text-tertiary);
}

/* ── Toggle Controls ─────────────────────────────────────── */
.matrix-toggles {
  display: flex;
  align-items: center;
  gap: 8px;
}

.norm-toggle,
.cost-toggle {
  display: inline-flex;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  padding: 2px;
  gap: 2px;
}

.toggle-btn {
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

.toggle-btn:hover {
  color: var(--text-secondary);
}

.toggle-btn.active {
  background: var(--canvas-subtle);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}
</style>
