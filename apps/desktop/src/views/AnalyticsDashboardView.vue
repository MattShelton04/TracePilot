<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { formatDuration } from '@tracepilot/ui';
import { useAnalyticsStore } from '@/stores/analytics';
import LoadingOverlay from '@/components/LoadingOverlay.vue';

const store = useAnalyticsStore();

onMounted(() => {
  store.fetchAvailableRepos();
  store.fetchAnalytics();
});

watch(() => store.selectedRepo, () => {
  store.fetchAnalytics({ force: true });
});

const loading = computed(() => store.analyticsLoading);
const data = computed(() => store.analytics);

// ── Formatters ───────────────────────────────────────────────
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Chart constants ──────────────────────────────────────────
const CHART_LEFT = 45;
const CHART_RIGHT = 490;
const CHART_TOP = 20;
const CHART_BOTTOM = 175;
const CHART_W = CHART_RIGHT - CHART_LEFT;
const CHART_H = CHART_BOTTOM - CHART_TOP;
const GRID_ROWS = 4;

const gridLines = computed(() =>
  Array.from({ length: GRID_ROWS }, (_, i) => CHART_TOP + (i * CHART_H) / GRID_ROWS),
);

// ── Token Usage Line/Area Chart ──────────────────────────────
const tokenChart = computed(() => {
  if (!data.value) return null;
  const pts = data.value.tokenUsageByDay;
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((p) => p.tokens), 1);
  const step = CHART_W / (pts.length - 1);

  const coords = pts.map((p, i) => ({
    x: CHART_LEFT + i * step,
    y: CHART_BOTTOM - (p.tokens / max) * CHART_H,
  }));
  const linePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const areaPoints = `${linePoints} ${CHART_RIGHT},${CHART_BOTTOM} ${CHART_LEFT},${CHART_BOTTOM}`;
  const yLabels = Array.from({ length: 5 }, (_, i) => ({
    value: fmtTokens((max / 4) * i),
    y: CHART_BOTTOM - (i * CHART_H) / 4,
  }));
  const xLabels = pts.map((p, i) => ({ label: fmtDate(p.date), x: CHART_LEFT + i * step }));
  return { coords, linePoints, areaPoints, yLabels, xLabels };
});

// ── Sessions Per Day Bar Chart ───────────────────────────────
const sessionsChart = computed(() => {
  if (!data.value) return null;
  const pts = data.value.sessionsPerDay;
  const max = Math.max(...pts.map((p) => p.count), 1);
  const barW = 20;
  const spacing = CHART_W / pts.length;

  const bars = pts.map((p, i) => {
    const x = CHART_LEFT + i * spacing + (spacing - barW) / 2;
    const h = (p.count / max) * CHART_H;
    return { x, y: CHART_BOTTOM - h, width: barW, height: h };
  });
  const yLabels = Array.from({ length: 5 }, (_, i) => ({
    value: String(Math.round((max / 4) * i)),
    y: CHART_BOTTOM - (i * CHART_H) / 4,
  }));
  const xLabels = pts
    .filter((_, i) => i % 2 === 0)
    .map((p, idx) => ({ label: fmtDate(p.date), x: CHART_LEFT + idx * 2 * spacing + spacing / 2 }));
  return { bars, yLabels, xLabels };
});

// ── Model Distribution Donut ─────────────────────────────────
const DONUT_COLORS = ['#6366f1', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#38bdf8'];
const DONUT_R = 56;
const DONUT_C = 2 * Math.PI * DONUT_R; // ~351.86

const donutSegments = computed(() => {
  if (!data.value) return [];
  let offset = 0;
  return data.value.modelDistribution.map((m, i) => {
    const dash = (m.percentage / 100) * DONUT_C;
    const seg = {
      dash,
      gap: DONUT_C - dash,
      offset: -offset,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      model: m.model,
      pct: m.percentage,
    };
    offset += dash;
    return seg;
  });
});

// ── Cost Trend Area Chart ────────────────────────────────────
const costChart = computed(() => {
  if (!data.value) return null;
  const pts = data.value.costByDay;
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((p) => p.cost), 0.01);
  const step = CHART_W / (pts.length - 1);

  const coords = pts.map((p, i) => ({
    x: CHART_LEFT + i * step,
    y: CHART_BOTTOM - (p.cost / max) * CHART_H,
  }));
  const linePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const areaPoints = `${linePoints} ${CHART_RIGHT},${CHART_BOTTOM} ${CHART_LEFT},${CHART_BOTTOM}`;
  const yLabels = Array.from({ length: 4 }, (_, i) => ({
    value: fmtCost((max / 3) * i),
    y: CHART_BOTTOM - (i * CHART_H) / 3,
  }));
  const xLabels = pts.map((p, i) => ({ label: fmtDate(p.date), x: CHART_LEFT + i * step }));
  return { coords, linePoints, areaPoints, yLabels, xLabels };
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <LoadingOverlay :loading="loading" message="Loading analytics…">
        <div v-if="store.analyticsError" class="error-state">
          <p>Failed to load analytics: {{ store.analyticsError }}</p>
          <button class="btn btn-primary" @click="store.fetchAnalytics({ force: true })">Retry</button>
        </div>
        <template v-else-if="data">
          <!-- Title + Repo Filter -->
          <div class="mb-4" style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h1 class="page-title">Analytics Dashboard</h1>
              <p class="page-subtitle">
                Aggregate metrics across {{ store.selectedRepo ? '' : 'all ' }}{{ data.totalSessions }} sessions{{ store.selectedRepo ? ` in ${store.selectedRepo}` : '' }}
              </p>
            </div>
            <select
              :value="store.selectedRepo ?? ''"
              class="filter-select"
              aria-label="Filter by repository"
              @change="store.setRepo(($event.target as HTMLSelectElement).value || null)"
            >
              <option value="">All Repositories</option>
              <option v-for="repo in store.availableRepos" :key="repo" :value="repo">{{ repo }}</option>
            </select>
          </div>

          <!-- Stats Row -->
          <div class="grid-4 mb-4">
            <div class="stat-card">
              <div class="stat-card-value accent">{{ data.totalSessions }}</div>
              <div class="stat-card-label">Total Sessions</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value gradient-value">{{ fmtTokens(data.totalTokens) }}</div>
              <div class="stat-card-label">Total Tokens</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value success">{{ fmtCost(data.totalCost) }}</div>
              <div class="stat-card-label">Total Cost</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value warning">{{ data.averageHealthScore.toFixed(2) }}</div>
              <div class="stat-card-label">Avg Health Score</div>
            </div>
          </div>

          <!-- Duration Stats + Productivity Metrics -->
          <div class="grid-2 mb-4" v-if="data.sessionDurationStats || data.productivityMetrics">
            <div class="section-panel" v-if="data.sessionDurationStats">
              <div class="section-panel-header">Session Duration</div>
              <div class="section-panel-body">
                <div class="metric-grid">
                  <div class="metric-item">
                    <span class="metric-value">{{ formatDuration(data.sessionDurationStats.avgMs) }}</span>
                    <span class="metric-label">Average</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ formatDuration(data.sessionDurationStats.medianMs) }}</span>
                    <span class="metric-label">Median</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ formatDuration(data.sessionDurationStats.p95Ms) }}</span>
                    <span class="metric-label">P95</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ formatDuration(data.sessionDurationStats.minMs) }}</span>
                    <span class="metric-label">Min</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ formatDuration(data.sessionDurationStats.maxMs) }}</span>
                    <span class="metric-label">Max</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ data.sessionDurationStats.totalSessionsWithDuration }}</span>
                    <span class="metric-label">Sessions w/ Duration</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="section-panel" v-if="data.productivityMetrics">
              <div class="section-panel-header">Productivity Metrics</div>
              <div class="section-panel-body">
                <div class="metric-grid">
                  <div class="metric-item">
                    <span class="metric-value">{{ data.productivityMetrics.avgTurnsPerSession.toFixed(1) }}</span>
                    <span class="metric-label">Avg Turns / Session</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ data.productivityMetrics.avgToolCallsPerTurn.toFixed(1) }}</span>
                    <span class="metric-label">Avg Tool Calls / Turn</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ fmtTokens(data.productivityMetrics.avgTokensPerTurn) }}</span>
                    <span class="metric-label">Avg Tokens / Turn</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Row 1: Token Usage + Sessions Per Day -->
          <div class="grid-2 mb-4">
            <!-- Token Usage Over Time -->
            <div class="section-panel">
              <div class="section-panel-header">Token Usage Over Time</div>
              <div class="section-panel-body">
                <svg
                  v-if="tokenChart"
                  viewBox="0 0 500 200"
                  width="100%"
                  role="img"
                  aria-label="Line chart showing token usage over the past 14 days"
                >
                  <defs>
                    <linearGradient id="tokenAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.25" />
                      <stop offset="100%" stop-color="#6366f1" stop-opacity="0.02" />
                    </linearGradient>
                  </defs>
                  <!-- Grid lines -->
                  <line
                    v-for="(gy, gi) in gridLines"
                    :key="`tg-${gi}`"
                    :x1="CHART_LEFT"
                    :y1="gy"
                    :x2="CHART_RIGHT"
                    :y2="gy"
                    class="chart-grid-line"
                    stroke-dasharray="4,3"
                  />
                  <!-- Axes -->
                  <line :x1="CHART_LEFT" :y1="CHART_TOP" :x2="CHART_LEFT" :y2="CHART_BOTTOM" class="chart-axis" />
                  <line :x1="CHART_LEFT" :y1="CHART_BOTTOM" :x2="CHART_RIGHT" :y2="CHART_BOTTOM" class="chart-axis" />
                  <!-- Y labels -->
                  <text
                    v-for="(yl, yi) in tokenChart.yLabels"
                    :key="`ty-${yi}`"
                    :x="CHART_LEFT - 7"
                    :y="yl.y + 3"
                    text-anchor="end"
                    font-size="9"
                    class="chart-label"
                  >{{ yl.value }}</text>
                  <!-- Area -->
                  <polygon :points="tokenChart.areaPoints" fill="url(#tokenAreaGrad)" />
                  <!-- Line -->
                  <polyline
                    :points="tokenChart.linePoints"
                    fill="none"
                    stroke="#6366f1"
                    stroke-width="2"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                  <!-- Dots -->
                  <circle
                    v-for="(c, ci) in tokenChart.coords"
                    :key="`td-${ci}`"
                    :cx="c.x"
                    :cy="c.y"
                    :r="ci === tokenChart.coords.length - 1 ? 3.5 : 3"
                    :fill="ci === tokenChart.coords.length - 1 ? '#818cf8' : '#6366f1'"
                  />
                  <!-- X labels -->
                  <text
                    v-for="(xl, xi) in tokenChart.xLabels"
                    :key="`tx-${xi}`"
                    :x="xl.x"
                    y="192"
                    text-anchor="middle"
                    font-size="8"
                    class="chart-label"
                  >{{ xl.label }}</text>
                </svg>
              </div>
            </div>

            <!-- Sessions Per Day -->
            <div class="section-panel">
              <div class="section-panel-header">Sessions Per Day</div>
              <div class="section-panel-body">
                <svg
                  v-if="sessionsChart"
                  viewBox="0 0 500 200"
                  width="100%"
                  role="img"
                  aria-label="Bar chart showing sessions per day over the past 14 days"
                >
                  <defs>
                    <linearGradient id="sessionBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#818cf8" />
                      <stop offset="100%" stop-color="#6366f1" />
                    </linearGradient>
                  </defs>
                  <!-- Grid lines -->
                  <line
                    v-for="(gy, gi) in gridLines"
                    :key="`sg-${gi}`"
                    :x1="CHART_LEFT"
                    :y1="gy"
                    :x2="CHART_RIGHT"
                    :y2="gy"
                    class="chart-grid-line"
                    stroke-dasharray="4,3"
                  />
                  <!-- Axes -->
                  <line :x1="CHART_LEFT" :y1="CHART_TOP" :x2="CHART_LEFT" :y2="CHART_BOTTOM" class="chart-axis" />
                  <line :x1="CHART_LEFT" :y1="CHART_BOTTOM" :x2="CHART_RIGHT" :y2="CHART_BOTTOM" class="chart-axis" />
                  <!-- Y labels -->
                  <text
                    v-for="(yl, yi) in sessionsChart.yLabels"
                    :key="`sy-${yi}`"
                    :x="CHART_LEFT - 7"
                    :y="yl.y + 3"
                    text-anchor="end"
                    font-size="9"
                    class="chart-label"
                  >{{ yl.value }}</text>
                  <!-- Bars -->
                  <rect
                    v-for="(bar, bi) in sessionsChart.bars"
                    :key="`sb-${bi}`"
                    :x="bar.x"
                    :y="bar.y"
                    :width="bar.width"
                    :height="bar.height"
                    rx="3"
                    fill="url(#sessionBarGrad)"
                  />
                  <!-- X labels -->
                  <text
                    v-for="(xl, xi) in sessionsChart.xLabels"
                    :key="`sx-${xi}`"
                    :x="xl.x"
                    y="192"
                    text-anchor="middle"
                    font-size="8"
                    class="chart-label"
                  >{{ xl.label }}</text>
                </svg>
              </div>
            </div>
          </div>

          <!-- Row 2: Model Distribution + Cost Trend -->
          <div class="grid-2 mb-4">
            <!-- Model Distribution (Donut) -->
            <div class="section-panel">
              <div class="section-panel-header">Model Distribution</div>
              <div class="donut-panel-body">
                <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Donut chart showing token distribution by model">
                  <circle
                    v-for="(seg, si) in donutSegments"
                    :key="`ds-${si}`"
                    cx="80"
                    cy="80"
                    :r="DONUT_R"
                    fill="none"
                    :stroke="seg.color"
                    stroke-width="18"
                    :stroke-dasharray="`${seg.dash} ${seg.gap}`"
                    :stroke-dashoffset="seg.offset"
                    transform="rotate(-90 80 80)"
                  />
                  <text x="80" y="76" text-anchor="middle" font-size="20" font-weight="700" fill="currentColor" class="donut-center-value">
                    {{ fmtTokens(data.totalTokens) }}
                  </text>
                  <text x="80" y="92" text-anchor="middle" font-size="9" fill="currentColor" class="donut-center-label">total tokens</text>
                </svg>
                <div class="donut-legend">
                  <div v-for="(seg, si) in donutSegments" :key="`dl-${si}`" class="donut-legend-item">
                    <span class="donut-legend-dot" :style="{ background: seg.color }" />
                    <span>{{ seg.model }}</span>
                    <span class="donut-legend-pct">{{ seg.pct.toFixed(0) }}%</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Cost Trend -->
            <div class="section-panel">
              <div class="section-panel-header">Cost Trend</div>
              <div class="section-panel-body">
                <svg
                  v-if="costChart"
                  viewBox="0 0 500 200"
                  width="100%"
                  role="img"
                  aria-label="Area chart showing daily cost trend over the past 14 days"
                >
                  <defs>
                    <linearGradient id="costAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.35" />
                      <stop offset="100%" stop-color="#6366f1" stop-opacity="0.02" />
                    </linearGradient>
                  </defs>
                  <!-- Grid lines -->
                  <line
                    v-for="(gy, gi) in gridLines"
                    :key="`cg-${gi}`"
                    :x1="CHART_LEFT"
                    :y1="gy"
                    :x2="CHART_RIGHT"
                    :y2="gy"
                    class="chart-grid-line"
                    stroke-dasharray="4,3"
                  />
                  <!-- Axes -->
                  <line :x1="CHART_LEFT" :y1="CHART_TOP" :x2="CHART_LEFT" :y2="CHART_BOTTOM" class="chart-axis" />
                  <line :x1="CHART_LEFT" :y1="CHART_BOTTOM" :x2="CHART_RIGHT" :y2="CHART_BOTTOM" class="chart-axis" />
                  <!-- Y labels -->
                  <text
                    v-for="(yl, yi) in costChart.yLabels"
                    :key="`cy-${yi}`"
                    :x="CHART_LEFT - 7"
                    :y="yl.y + 3"
                    text-anchor="end"
                    font-size="9"
                    class="chart-label"
                  >{{ yl.value }}</text>
                  <!-- Area -->
                  <polygon :points="costChart.areaPoints" fill="url(#costAreaGrad)" />
                  <!-- Line -->
                  <polyline
                    :points="costChart.linePoints"
                    fill="none"
                    stroke="#6366f1"
                    stroke-width="2"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                  <!-- Dots -->
                  <circle
                    v-for="(c, ci) in costChart.coords"
                    :key="`cd-${ci}`"
                    :cx="c.x"
                    :cy="c.y"
                    :r="ci === costChart.coords.length - 1 ? 3.5 : 3"
                    :fill="ci === costChart.coords.length - 1 ? '#818cf8' : '#6366f1'"
                  />
                  <!-- X labels -->
                  <text
                    v-for="(xl, xi) in costChart.xLabels"
                    :key="`cx-${xi}`"
                    :x="xl.x"
                    y="192"
                    text-anchor="middle"
                    font-size="8"
                    class="chart-label"
                  >{{ xl.label }}</text>
                </svg>
              </div>
            </div>
          </div>
        </template>
      </LoadingOverlay>
    </div>
  </div>
</template>

<style scoped>
.mb-4 {
  margin-bottom: 20px;
}

.error-state {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-secondary);
}

.error-state .btn {
  margin-top: 12px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  padding: 18px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.metric-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.metric-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-align: center;
}

.gradient-value {
  background: linear-gradient(135deg, #6366f1, #a78bfa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.donut-panel-body {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 18px;
}

.donut-legend {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.donut-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.donut-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.donut-legend-pct {
  margin-left: auto;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
  min-width: 36px;
  text-align: right;
}

.donut-center-value {
  fill: var(--text-primary);
}

.donut-center-label {
  fill: var(--text-tertiary);
}

/* ── Theme-aware SVG chart styles ──────────────────────────── */
.chart-grid-line {
  stroke: var(--border-subtle);
}

.chart-axis {
  stroke: var(--border-default);
}

.chart-label {
  fill: var(--text-tertiary);
}
</style>
