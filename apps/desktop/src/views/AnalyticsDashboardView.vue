<script setup lang="ts">
import {
  formatCost,
  formatDateMedium,
  formatDateShort,
  formatDuration,
  formatNumber,
  formatNumberFull,
} from '@tracepilot/ui';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import AnalyticsPageHeader from '@/components/AnalyticsPageHeader.vue';
import LoadingOverlay from '@/components/LoadingOverlay.vue';
import { useAnalyticsStore } from '@/stores/analytics';
import { usePreferencesStore } from '@/stores/preferences';
import { CHART_COLORS, DONUT_PALETTE } from '@/utils/chartColors';

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
  const allPrefix = store.selectedRepo ? '' : 'all ';
  const repoSuffix = store.selectedRepo ? ` in ${store.selectedRepo}` : '';
  return `Aggregate metrics across ${allPrefix}${data.value?.totalSessions ?? 0} sessions${repoSuffix}`;
});

// ── Cost computations ────────────────────────────────────────
const copilotCost = computed(() => {
  if (!data.value) return 0;
  return data.value.totalPremiumRequests * prefs.costPerPremiumRequest;
});
const totalWholesaleCost = computed(() => {
  if (!data.value) return 0;
  return data.value.modelDistribution.reduce(
    (sum, m) =>
      sum +
      (prefs.computeWholesaleCost(m.model, m.inputTokens, m.cacheReadTokens, m.outputTokens) ?? 0),
    0,
  );
});

// ── Tooltip state────────────────────────────────────────────
const tooltip = reactive({
  visible: false,
  pinned: false,
  x: 0,
  y: 0,
  content: '',
  chartId: '',
  highlightIndex: -1,
});

function positionTooltip(event: MouseEvent, container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  const style = getComputedStyle(container);
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padTop = parseFloat(style.paddingTop) || 0;
  const rawX = event.clientX - rect.left - padLeft;
  const rawY = event.clientY - rect.top - padTop;
  tooltip.x = Math.max(40, Math.min(rawX, rect.width - padLeft * 2 - 40));
  tooltip.y = Math.max(20, rawY);
}

/** Find nearest data point by X coordinate in SVG space, show tooltip */
function onChartMouseMove(
  event: MouseEvent,
  coords: { x: number; date: string }[],
  formatContent: (idx: number) => string,
  chartId: string,
) {
  if (tooltip.pinned) return;
  const svg = (event.target as SVGElement)?.closest('svg');
  const container = (event.target as SVGElement)?.closest('.chart-container') as HTMLElement;
  if (!svg || !container || coords.length === 0) return;

  // Convert mouse position to SVG coordinate space
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse());

  // Find nearest point by X distance
  let bestIdx = 0;
  let bestDist = Math.abs(svgPt.x - coords[0].x);
  for (let i = 1; i < coords.length; i++) {
    const d = Math.abs(svgPt.x - coords[i].x);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  tooltip.visible = true;
  tooltip.content = formatContent(bestIdx);
  tooltip.chartId = chartId;
  tooltip.highlightIndex = bestIdx;
  positionTooltip(event, container);
}

function onChartClick(
  event: MouseEvent,
  coords: { x: number; date: string }[],
  formatContent: (idx: number) => string,
  chartId: string,
) {
  if (tooltip.pinned && tooltip.chartId === chartId) {
    // Clicking same chart again unpins
    tooltip.pinned = false;
    return;
  }
  // Unpin first so onChartMouseMove can proceed
  tooltip.pinned = false;
  onChartMouseMove(event, coords, formatContent, chartId);
  tooltip.pinned = true;
}

function dismissTooltip() {
  tooltip.visible = false;
  tooltip.pinned = false;
  tooltip.chartId = '';
  tooltip.highlightIndex = -1;
}

// ── Chart constants ──────────────────────────────────────────
const CHART_LEFT = 55;
const CHART_RIGHT = 490;
const CHART_TOP = 20;
const CHART_BOTTOM = 175;
const CHART_W = CHART_RIGHT - CHART_LEFT;
const CHART_H = CHART_BOTTOM - CHART_TOP;
const GRID_ROWS = 4;

/** Compute stride so we show ~10 labels max. */
function labelStride(count: number): number {
  return Math.max(1, Math.ceil(count / 10));
}

const gridLines = computed(() =>
  Array.from({ length: GRID_ROWS }, (_, i) => CHART_TOP + (i * CHART_H) / GRID_ROWS),
);

// ── Dynamic aria-label based on time range ───────────────────
const timeRangeLabel = computed(() => {
  const tr = store.selectedTimeRange;
  if (tr === '7d') return 'the past 7 days';
  if (tr === '30d') return 'the past 30 days';
  if (tr === '90d') return 'the past 90 days';
  if (tr === 'custom') {
    const range = store.dateRange;
    if (range?.fromDate && range?.toDate) {
      const from = new Date(range.fromDate);
      const to = new Date(range.toDate);
      const days = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
      return `${days} days`;
    }
    return 'the selected period';
  }
  return 'all time';
});

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
    date: p.date,
    tokens: p.tokens,
  }));
  const linePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const areaPoints = `${linePoints} ${CHART_RIGHT},${CHART_BOTTOM} ${CHART_LEFT},${CHART_BOTTOM}`;
  const yLabels = Array.from({ length: 5 }, (_, i) => ({
    value: formatNumber((max / 4) * i),
    y: CHART_BOTTOM - (i * CHART_H) / 4,
  }));
  const stride = labelStride(pts.length);
  const xLabels = pts
    .map((p, i) => ({ label: formatDateShort(p.date), x: CHART_LEFT + i * step }))
    .filter((_, i) => i % stride === 0);
  return { coords, linePoints, areaPoints, yLabels, xLabels };
});

// ── Sessions Per Day Bar Chart───────────────────────────────
const sessionsChart = computed(() => {
  if (!data.value) return null;
  const pts = data.value.sessionsPerDay;
  if (pts.length === 0) return null;
  const max = Math.max(...pts.map((p) => p.count), 1);
  const spacing = CHART_W / pts.length;
  const barW = Math.max(4, Math.min(20, spacing - 2));

  const bars = pts.map((p, i) => {
    const x = CHART_LEFT + i * spacing + (spacing - barW) / 2;
    const h = (p.count / max) * CHART_H;
    return { x, y: CHART_BOTTOM - h, width: barW, height: h, date: p.date, count: p.count };
  });
  const yLabels = Array.from({ length: 5 }, (_, i) => ({
    value: String(Math.round((max / 4) * i)),
    y: CHART_BOTTOM - (i * CHART_H) / 4,
  }));
  const stride = labelStride(pts.length);
  const xLabels = pts
    .map((p, i) => ({ label: formatDateShort(p.date), x: CHART_LEFT + i * spacing + spacing / 2 }))
    .filter((_, i) => i % stride === 0);
  return { bars, yLabels, xLabels };
});

// ── Model Distribution Donut ─────────────────────────────────
const DONUT_COLORS = DONUT_PALETTE;
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
      tokens: m.inputTokens + m.outputTokens,
    };
    offset += dash;
    return seg;
  });
});

const hoveredDonut = ref<number | null>(null);

const activeDonutSegment = computed(() =>
  hoveredDonut.value !== null && hoveredDonut.value < donutSegments.value.length
    ? donutSegments.value[hoveredDonut.value]
    : null,
);

// Reset hover when underlying data changes
watch(donutSegments, () => {
  hoveredDonut.value = null;
});

// ── Cost Trend Area Chart ────────────────────────────────────
const costChart = computed(() => {
  if (!data.value) return null;
  const rate = prefs.costPerPremiumRequest;
  const pts = data.value.costByDay.map((p) => ({ date: p.date, cost: p.cost * rate }));
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((p) => p.cost), 0.01);
  const step = CHART_W / (pts.length - 1);

  const coords = pts.map((p, i) => ({
    x: CHART_LEFT + i * step,
    y: CHART_BOTTOM - (p.cost / max) * CHART_H,
    date: p.date,
    cost: p.cost,
  }));
  const linePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const areaPoints = `${linePoints} ${CHART_RIGHT},${CHART_BOTTOM} ${CHART_LEFT},${CHART_BOTTOM}`;
  const yLabels = Array.from({ length: 4 }, (_, i) => ({
    value: formatCost((max / 3) * i),
    y: CHART_BOTTOM - (i * CHART_H) / 3,
  }));
  const stride = labelStride(pts.length);
  const xLabels = pts
    .map((p, i) => ({ label: formatDateShort(p.date), x: CHART_LEFT + i * step }))
    .filter((_, i) => i % stride === 0);
  return { coords, linePoints, areaPoints, yLabels, xLabels };
});

// ── Incident trend chart ─────────────────────────────────────
const incidentNormalize = ref(false);

const incidentChart = computed(() => {
  if (!data.value?.incidentsByDay?.length) return null;
  const pts = data.value.incidentsByDay;
  const sessionsPerDay = data.value.sessionsPerDay ?? [];

  // Build a lookup for sessions count per day (for normalization)
  const sessionMap = new Map<string, number>();
  for (const s of sessionsPerDay) {
    sessionMap.set(s.date, s.count);
  }

  // Compute values per bar — split errors into rateLimits + otherErrors
  const barData = pts.map(p => {
    const otherErrors = Math.max(0, p.errors - p.rateLimits);
    const sessions = sessionMap.get(p.date) || 1;
    const norm = incidentNormalize.value ? sessions : 1;
    return {
      date: p.date,
      rateLimits: p.rateLimits / norm,
      otherErrors: otherErrors / norm,
      compactions: p.compactions / norm,
      truncations: p.truncations / norm,
      rawRateLimits: p.rateLimits,
      rawOtherErrors: otherErrors,
      rawCompactions: p.compactions,
      rawTruncations: p.truncations,
      total: (p.rateLimits + otherErrors + p.compactions + p.truncations) / norm,
    };
  });

  const maxVal = Math.max(0.5, ...barData.map(b => b.total));
  const barW = Math.max(4, Math.min(18, (CHART_W) / barData.length - 2));

  const bars = barData.map((b, i) => {
    const x = CHART_LEFT + ((i + 0.5) / barData.length) * CHART_W;
    const truncH = (b.truncations / maxVal) * CHART_H;
    const compH = (b.compactions / maxVal) * CHART_H;
    const otherH = (b.otherErrors / maxVal) * CHART_H;
    const rlH = (b.rateLimits / maxVal) * CHART_H;
    return {
      x,
      ...b,
      // Stacked from bottom: truncations, compactions, other errors, rate limits
      truncRect: { y: CHART_BOTTOM - truncH, h: truncH },
      compRect: { y: CHART_BOTTOM - truncH - compH, h: compH },
      otherRect: { y: CHART_BOTTOM - truncH - compH - otherH, h: otherH },
      rlRect: { y: CHART_BOTTOM - truncH - compH - otherH - rlH, h: rlH },
    };
  });

  // Nice Y-axis ticks
  const yTicks = 5;
  const step = maxVal <= 1 ? 0.2 : Math.ceil(maxVal / (yTicks - 1));
  const yLabels = Array.from({ length: yTicks }, (_, i) => {
    const value = maxVal <= 1 ? +(i * step).toFixed(1) : Math.round(i * step);
    return { value, y: CHART_BOTTOM - (i * CHART_H) / (yTicks - 1) };
  });

  const stride = labelStride(barData.length);
  const xLabels = barData
    .map((b, i) => ({ label: formatDateShort(b.date), x: CHART_LEFT + ((i + 0.5) / barData.length) * CHART_W }))
    .filter((_, i) => i % stride === 0);

  return { bars, yLabels, xLabels, barW, maxVal };
});

function formatIncidentTooltip(bar: { date: string; rateLimits: number; otherErrors: number; compactions: number; truncations: number; rawRateLimits: number; rawOtherErrors: number; rawCompactions: number; rawTruncations: number }): string {
  const d = formatDateMedium(bar.date);
  if (incidentNormalize.value) {
    const parts: string[] = [];
    if (bar.rateLimits > 0) parts.push(`${bar.rateLimits.toFixed(1)} rate limits/session`);
    if (bar.otherErrors > 0) parts.push(`${bar.otherErrors.toFixed(1)} errors/session`);
    if (bar.compactions > 0) parts.push(`${bar.compactions.toFixed(1)} compactions/session`);
    if (bar.truncations > 0) parts.push(`${bar.truncations.toFixed(1)} truncations/session`);
    return parts.length > 0 ? `${d} — ${parts.join(', ')}` : `${d} — no incidents`;
  }
  const parts: string[] = [];
  if (bar.rawRateLimits > 0) parts.push(`${bar.rawRateLimits} rate limit${bar.rawRateLimits !== 1 ? 's' : ''}`);
  if (bar.rawOtherErrors > 0) parts.push(`${bar.rawOtherErrors} error${bar.rawOtherErrors !== 1 ? 's' : ''}`);
  if (bar.rawCompactions > 0) parts.push(`${bar.rawCompactions} compaction${bar.rawCompactions !== 1 ? 's' : ''}`);
  if (bar.rawTruncations > 0) parts.push(`${bar.rawTruncations} truncation${bar.rawTruncations !== 1 ? 's' : ''}`);
  return parts.length > 0 ? `${d} — ${parts.join(', ')}` : `${d} — no incidents`;
}

function onIncidentChartMouseMove(event: MouseEvent) {
  if (tooltip.pinned) return;
  const chart = incidentChart.value;
  if (!chart) return;
  const svg = (event.target as SVGElement)?.closest('svg');
  const container = (event.target as SVGElement)?.closest('.chart-container') as HTMLElement;
  if (!svg || !container) return;

  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse());

  let bestIdx = 0;
  let bestDist = Math.abs(svgPt.x - chart.bars[0].x);
  for (let i = 1; i < chart.bars.length; i++) {
    const d = Math.abs(svgPt.x - chart.bars[i].x);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }

  tooltip.visible = true;
  tooltip.content = formatIncidentTooltip(chart.bars[bestIdx]);
  tooltip.chartId = 'incidents';
  tooltip.highlightIndex = bestIdx;
  positionTooltip(event, container);
}

function onIncidentChartClick(event: MouseEvent) {
  if (tooltip.pinned && tooltip.chartId === 'incidents') {
    tooltip.pinned = false;
    return;
  }
  tooltip.pinned = false;
  onIncidentChartMouseMove(event);
  tooltip.pinned = true;
}
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <AnalyticsPageHeader title="Analytics Dashboard" :subtitle="pageSubtitle" />
      <LoadingOverlay :loading="loading" message="Loading analytics…">
        <div v-if="store.analyticsError" class="error-state">
          <p>Failed to load analytics: {{ store.analyticsError }}</p>
          <button class="btn btn-primary" @click="store.fetchAnalytics({ force: true })">Retry</button>
        </div>
        <template v-else-if="data">

          <!-- Stats Row -->
          <div class="grid-5 mb-4">
            <div class="stat-card">
              <div class="stat-card-value accent">{{ data.totalSessions }}</div>
              <div class="stat-card-label">Total Sessions</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value gradient-value">{{ formatNumber(data.totalTokens) }}</div>
              <div class="stat-card-label">Total Tokens</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value warning">{{ formatCost(copilotCost) }}</div>
              <div class="stat-card-label">Copilot Cost</div>
            </div>
            <div class="stat-card" :title="'Estimated cost if this usage went through direct API access instead of GitHub Copilot, based on per-model token pricing configured in Settings.'">
              <div class="stat-card-value done">{{ formatCost(totalWholesaleCost) }}</div>
              <div class="stat-card-label">Wholesale Cost</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value warning">{{ data.averageHealthScore.toFixed(2) }}</div>
              <div class="stat-card-label">Avg Health Score</div>
            </div>
          </div>

          <!-- Incident Stats -->
          <div class="grid-4 mb-4">
            <div class="stat-card stat-card--incident-error">
              <div class="stat-card-value">{{ data.sessionsWithErrors }}</div>
              <div class="stat-card-label">Sessions with Errors</div>
            </div>
            <div class="stat-card stat-card--incident-ratelimit">
              <div class="stat-card-value">{{ data.totalRateLimits }}</div>
              <div class="stat-card-label">Total Rate Limits</div>
            </div>
            <div class="stat-card stat-card--incident-compaction">
              <div class="stat-card-value">{{ data.totalCompactions }}</div>
              <div class="stat-card-label">Total Compactions</div>
            </div>
            <div class="stat-card stat-card--incident-truncation">
              <div class="stat-card-value">{{ data.totalTruncations }}</div>
              <div class="stat-card-label">Total Truncations</div>
            </div>
          </div>

          <!-- API Duration Stats + Productivity Metrics -->
          <div class="grid-2 mb-4" v-if="data.apiDurationStats || data.productivityMetrics">
            <div class="section-panel" v-if="data.apiDurationStats">
              <div class="section-panel-header">API Duration</div>
              <div class="section-panel-body">
                <div class="metric-grid">
                  <div class="metric-item">
                    <span class="metric-value">{{ formatDuration(data.apiDurationStats.avgMs) }}</span>
                    <span class="metric-label">Average</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ formatDuration(data.apiDurationStats.medianMs) }}</span>
                    <span class="metric-label">Median</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ formatDuration(data.apiDurationStats.p95Ms) }}</span>
                    <span class="metric-label">P95</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ formatDuration(data.apiDurationStats.minMs) }}</span>
                    <span class="metric-label">Min</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ formatDuration(data.apiDurationStats.maxMs) }}</span>
                    <span class="metric-label">Max</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ data.apiDurationStats.totalSessionsWithDuration }}</span>
                    <span class="metric-label">Sessions w/ Data</span>
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
                    <span class="metric-value">{{ formatNumber(data.productivityMetrics.avgTokensPerTurn) }}</span>
                    <span class="metric-label">Avg Tokens / Turn</span>
                  </div>
                  <div class="metric-item" :title="'Average tokens processed per second of API wait time — a measure of model throughput across all sessions.'">
                    <span class="metric-value">{{ formatNumber(data.productivityMetrics.avgTokensPerApiSecond) }}</span>
                    <span class="metric-label">Tokens / API Second</span>
                  </div>
                  <div class="metric-item" :title="'Average context compactions per session — based on all sessions in the current filter. Higher values indicate sessions hitting context limits frequently.'">
                    <span class="metric-value">{{ data.totalSessions > 0 ? (data.totalCompactions / data.totalSessions).toFixed(1) : '0' }}</span>
                    <span class="metric-label">Avg Compactions / Session</span>
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
              <div class="section-panel-body chart-container" @mouseleave="dismissTooltip">
                <svg
                  v-if="tokenChart"
                  viewBox="0 0 500 200"
                  width="100%"
                  role="img"
                  :aria-label="`Line chart showing token usage over ${timeRangeLabel}`"
                  @mousemove="onChartMouseMove($event, tokenChart.coords, (i) => `${formatDateMedium(tokenChart!.coords[i].date)} — ${formatNumberFull(tokenChart!.coords[i].tokens)} tokens`, 'tokens')"
                  @click="onChartClick($event, tokenChart.coords, (i) => `${formatDateMedium(tokenChart!.coords[i].date)} — ${formatNumberFull(tokenChart!.coords[i].tokens)} tokens`, 'tokens')"
                >
                  <defs>
                    <linearGradient id="tokenAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" :stop-color="CHART_COLORS.primary" stop-opacity="0.25" />
                      <stop offset="100%" :stop-color="CHART_COLORS.primary" stop-opacity="0.02" />
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
                    :stroke="CHART_COLORS.primary"
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
                    :fill="ci === tokenChart.coords.length - 1 ? CHART_COLORS.primaryLight : CHART_COLORS.primary"
                    class="chart-dot"
                  />
                  <!-- Highlight ring on active point -->
                  <circle
                    v-if="tooltip.chartId === 'tokens' && tooltip.highlightIndex >= 0 && tooltip.highlightIndex < tokenChart.coords.length"
                    :cx="tokenChart.coords[tooltip.highlightIndex].x"
                    :cy="tokenChart.coords[tooltip.highlightIndex].y"
                    r="6"
                    fill="none"
                    :stroke="CHART_COLORS.primary"
                    stroke-width="2"
                    class="chart-highlight-ring"
                  />
                  <!-- Invisible overlay to capture mouse events across entire chart area -->
                  <rect
                    :x="CHART_LEFT"
                    :y="CHART_TOP"
                    :width="CHART_W"
                    :height="CHART_H"
                    fill="transparent"
                    class="chart-overlay"
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
                <!-- Tooltip overlay -->
                <div
                  v-if="tooltip.visible && tooltip.chartId === 'tokens'"
                  class="chart-tooltip"
                  :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
                  :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
                >{{ tooltip.content }}</div>
              </div>
            </div>

            <!-- Sessions Per Day -->
            <div class="section-panel">
              <div class="section-panel-header">Sessions Per Day</div>
              <div class="section-panel-body chart-container" @mouseleave="dismissTooltip">
                <svg
                  v-if="sessionsChart"
                  viewBox="0 0 500 200"
                  width="100%"
                  role="img"
                  :aria-label="`Bar chart showing sessions per day over ${timeRangeLabel}`"
                  @mousemove="onChartMouseMove($event, sessionsChart.bars.map(b => ({ x: b.x + b.width / 2, date: b.date })), (i) => `${formatDateMedium(sessionsChart!.bars[i].date)} — ${sessionsChart!.bars[i].count} session${sessionsChart!.bars[i].count !== 1 ? 's' : ''}`, 'sessions')"
                  @click="onChartClick($event, sessionsChart.bars.map(b => ({ x: b.x + b.width / 2, date: b.date })), (i) => `${formatDateMedium(sessionsChart!.bars[i].date)} — ${sessionsChart!.bars[i].count} session${sessionsChart!.bars[i].count !== 1 ? 's' : ''}`, 'sessions')"
                >
                  <defs>
                    <linearGradient id="sessionBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" :stop-color="CHART_COLORS.primaryLight" />
                      <stop offset="100%" :stop-color="CHART_COLORS.primary" />
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
                    class="chart-bar"
                    :class="{ 'chart-bar--active': tooltip.chartId === 'sessions' && tooltip.highlightIndex === bi }"
                  />
                  <!-- Overlay for mouse capture -->
                  <rect
                    :x="CHART_LEFT"
                    :y="CHART_TOP"
                    :width="CHART_W"
                    :height="CHART_H"
                    fill="transparent"
                    class="chart-overlay"
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
                <div
                  v-if="tooltip.visible && tooltip.chartId === 'sessions'"
                  class="chart-tooltip"
                  :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
                  :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
                >{{ tooltip.content }}</div>
              </div>
            </div>
          </div>

          <!-- Row 2: Model Distribution + Cost Trend -->
          <div class="grid-2 mb-4">
            <!-- Model Distribution (Donut) -->
            <div class="section-panel">
              <div class="section-panel-header" style="display: flex; justify-content: space-between; align-items: center;">
                Model Distribution
                <router-link :to="{ name: 'model-comparison' }" class="more-info-link">More Info →</router-link>
              </div>
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
                    :stroke-width="hoveredDonut === si ? 22 : 18"
                    :stroke-dasharray="`${seg.dash} ${seg.gap}`"
                    :stroke-dashoffset="seg.offset"
                    transform="rotate(-90 80 80)"
                    class="donut-segment"
                    @mouseenter="hoveredDonut = si"
                    @mouseleave="hoveredDonut = null"
                  />
                  <text x="80" y="76" text-anchor="middle" font-size="20" font-weight="700" fill="currentColor" class="donut-center-value">
                    {{ activeDonutSegment ? formatNumber(activeDonutSegment.tokens) : formatNumber(data.totalTokens) }}
                  </text>
                  <text x="80" y="92" text-anchor="middle" font-size="9" fill="currentColor" class="donut-center-label">
                    {{ activeDonutSegment ? activeDonutSegment.model : 'total tokens' }}
                  </text>
                </svg>
                <div class="donut-legend">
                  <div
                    v-for="(m, si) in data.modelDistribution"
                    :key="`dl-${si}`"
                    class="donut-legend-item"
                    :class="{ 'donut-legend-item--active': hoveredDonut === si }"
                    @mouseenter="hoveredDonut = si"
                    @mouseleave="hoveredDonut = null"
                  >
                    <span class="donut-legend-dot" :style="{ background: DONUT_COLORS[si % DONUT_COLORS.length] }" />
                    <span>{{ m.model }}</span>
                    <span class="donut-legend-pct">{{ m.percentage.toFixed(0) }}%</span>
                    <span class="donut-legend-requests" :title="`${m.requestCount.toLocaleString()} API requests`">{{ m.requestCount.toLocaleString() }} req</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Cost Trend -->
            <div class="section-panel">
              <div class="section-panel-header">Cost Trend</div>
              <div class="section-panel-body chart-container" @mouseleave="dismissTooltip">
                <svg
                  v-if="costChart"
                  viewBox="0 0 500 200"
                  width="100%"
                  role="img"
                  :aria-label="`Area chart showing daily cost trend over ${timeRangeLabel}`"
                  @mousemove="onChartMouseMove($event, costChart.coords, (i) => `${formatDateMedium(costChart!.coords[i].date)} — ${formatCost(costChart!.coords[i].cost)}`, 'cost')"
                  @click="onChartClick($event, costChart.coords, (i) => `${formatDateMedium(costChart!.coords[i].date)} — ${formatCost(costChart!.coords[i].cost)}`, 'cost')"
                >
                  <defs>
                    <linearGradient id="costAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" :stop-color="CHART_COLORS.primary" stop-opacity="0.35" />
                      <stop offset="100%" :stop-color="CHART_COLORS.primary" stop-opacity="0.02" />
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
                    :stroke="CHART_COLORS.primary"
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
                    :fill="ci === costChart.coords.length - 1 ? CHART_COLORS.primaryLight : CHART_COLORS.primary"
                    class="chart-dot"
                  />
                  <!-- Highlight ring on active point -->
                  <circle
                    v-if="tooltip.chartId === 'cost' && tooltip.highlightIndex >= 0 && tooltip.highlightIndex < costChart.coords.length"
                    :cx="costChart.coords[tooltip.highlightIndex].x"
                    :cy="costChart.coords[tooltip.highlightIndex].y"
                    r="6"
                    fill="none"
                    :stroke="CHART_COLORS.primary"
                    stroke-width="2"
                    class="chart-highlight-ring"
                  />
                  <!-- Overlay for mouse capture -->
                  <rect
                    :x="CHART_LEFT"
                    :y="CHART_TOP"
                    :width="CHART_W"
                    :height="CHART_H"
                    fill="transparent"
                    class="chart-overlay"
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
                <div
                  v-if="tooltip.visible && tooltip.chartId === 'cost'"
                  class="chart-tooltip"
                  :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
                  :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
                >{{ tooltip.content }}</div>
              </div>
            </div>
          </div>
          <!-- Row 3: Cache Efficiency + Session Health Distribution -->
          <div class="grid-2 mb-4" v-if="data.cacheStats || data.healthDistribution">
            <!-- Cache Efficiency -->
            <div class="section-panel" v-if="data.cacheStats">
              <div class="section-panel-header">Cache Efficiency</div>
              <div class="section-panel-body">
                <div class="cache-hit-rate" :title="`${data.cacheStats.cacheHitRate.toFixed(1)}% of input tokens were served from the prompt cache`">
                  <div class="cache-hit-rate-label">
                    <span>Cache Hit Rate</span>
                    <strong>{{ data.cacheStats.cacheHitRate.toFixed(1) }}%</strong>
                  </div>
                  <div class="cache-progress-track">
                    <div
                      class="cache-progress-fill"
                      :style="{ width: `${Math.min(data.cacheStats.cacheHitRate, 100)}%` }"
                      :class="{
                        'cache-progress-fill--high': data.cacheStats.cacheHitRate >= 50,
                        'cache-progress-fill--mid': data.cacheStats.cacheHitRate >= 20 && data.cacheStats.cacheHitRate < 50,
                        'cache-progress-fill--low': data.cacheStats.cacheHitRate < 20,
                      }"
                    />
                  </div>
                </div>
                <div class="metric-grid mt-3">
                  <div class="metric-item">
                    <span class="metric-value accent">{{ formatNumber(data.cacheStats.totalCacheReadTokens) }}</span>
                    <span class="metric-label">Cached Tokens</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ formatNumber(data.cacheStats.nonCachedInputTokens) }}</span>
                    <span class="metric-label">Fresh Input Tokens</span>
                  </div>
                  <div class="metric-item">
                    <span class="metric-value">{{ formatNumber(data.cacheStats.totalInputTokens) }}</span>
                    <span class="metric-label">Total Input Tokens</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Session Health Distribution -->
            <div class="section-panel" v-if="data.healthDistribution">
              <div class="section-panel-header">Session Health Distribution</div>
              <div class="section-panel-body">
                <div class="health-dist-grid">
                  <div class="health-dist-card health-dist-card--healthy" :title="`${data.healthDistribution.healthyCount} sessions with health score ≥ 0.8`">
                    <span class="health-dist-count">{{ data.healthDistribution.healthyCount }}</span>
                    <span class="health-dist-label">Healthy</span>
                    <span class="health-dist-sub">score ≥ 0.8</span>
                  </div>
                  <div class="health-dist-card health-dist-card--attention" :title="`${data.healthDistribution.attentionCount} sessions with health score between 0.5 and 0.8`">
                    <span class="health-dist-count">{{ data.healthDistribution.attentionCount }}</span>
                    <span class="health-dist-label">Attention</span>
                    <span class="health-dist-sub">0.5 – 0.8</span>
                  </div>
                  <div class="health-dist-card health-dist-card--critical" :title="`${data.healthDistribution.criticalCount} sessions with health score below 0.5`">
                    <span class="health-dist-count">{{ data.healthDistribution.criticalCount }}</span>
                    <span class="health-dist-label">Critical</span>
                    <span class="health-dist-sub">score &lt; 0.5</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Incidents Over Time (full-width, polished chart) -->
          <div v-if="incidentChart" class="section-panel mb-4">
            <div class="section-panel-header" style="display: flex; justify-content: space-between; align-items: center;">
              <span>Incidents Over Time</span>
              <label class="incident-normalize-toggle" title="Show incidents per session per day for a normalized view">
                <input type="checkbox" v-model="incidentNormalize" />
                <span>Per Session</span>
              </label>
            </div>
            <div class="section-panel-body chart-container" @mouseleave="dismissTooltip">
              <svg
                viewBox="0 0 500 200"
                width="100%"
                role="img"
                :aria-label="`Stacked bar chart showing incidents over time${incidentNormalize ? ' (normalized per session)' : ''}`"
                @mousemove="onIncidentChartMouseMove($event)"
                @click="onIncidentChartClick($event)"
              >
                <!-- Grid lines -->
                <line
                  v-for="(yl, yi) in incidentChart.yLabels"
                  :key="`ig-${yi}`"
                  :x1="CHART_LEFT"
                  :y1="yl.y"
                  :x2="CHART_RIGHT"
                  :y2="yl.y"
                  class="chart-grid-line"
                  stroke-dasharray="4,3"
                />
                <!-- Axes -->
                <line :x1="CHART_LEFT" :y1="CHART_TOP" :x2="CHART_LEFT" :y2="CHART_BOTTOM" class="chart-axis" />
                <line :x1="CHART_LEFT" :y1="CHART_BOTTOM" :x2="CHART_RIGHT" :y2="CHART_BOTTOM" class="chart-axis" />
                <!-- Y labels -->
                <text
                  v-for="(yl, yi) in incidentChart.yLabels"
                  :key="`iy-${yi}`"
                  :x="CHART_LEFT - 7"
                  :y="yl.y + 3"
                  text-anchor="end"
                  font-size="9"
                  class="chart-label"
                >{{ yl.value }}</text>
                <!-- Stacked bars -->
                <g v-for="(bar, i) in incidentChart.bars" :key="`ib-${i}`">
                  <!-- Truncations (bottom) -->
                  <rect
                    v-if="bar.truncRect.h > 0.5"
                    :x="bar.x - incidentChart.barW / 2"
                    :y="bar.truncRect.y"
                    :width="incidentChart.barW"
                    :height="bar.truncRect.h"
                    fill="var(--text-tertiary, #9ca3af)"
                    rx="1"
                    class="chart-bar"
                    :class="{ 'chart-bar--active': tooltip.chartId === 'incidents' && tooltip.highlightIndex === i }"
                  />
                  <!-- Compactions -->
                  <rect
                    v-if="bar.compRect.h > 0.5"
                    :x="bar.x - incidentChart.barW / 2"
                    :y="bar.compRect.y"
                    :width="incidentChart.barW"
                    :height="bar.compRect.h"
                    fill="var(--chart-secondary, #6366f1)"
                    rx="1"
                    class="chart-bar"
                    :class="{ 'chart-bar--active': tooltip.chartId === 'incidents' && tooltip.highlightIndex === i }"
                  />
                  <!-- Other Errors -->
                  <rect
                    v-if="bar.otherRect.h > 0.5"
                    :x="bar.x - incidentChart.barW / 2"
                    :y="bar.otherRect.y"
                    :width="incidentChart.barW"
                    :height="bar.otherRect.h"
                    fill="var(--color-danger, #ef4444)"
                    rx="1"
                    class="chart-bar"
                    :class="{ 'chart-bar--active': tooltip.chartId === 'incidents' && tooltip.highlightIndex === i }"
                  />
                  <!-- Rate Limits (top) -->
                  <rect
                    v-if="bar.rlRect.h > 0.5"
                    :x="bar.x - incidentChart.barW / 2"
                    :y="bar.rlRect.y"
                    :width="incidentChart.barW"
                    :height="bar.rlRect.h"
                    fill="var(--color-warning, #f59e0b)"
                    rx="1"
                    class="chart-bar"
                    :class="{ 'chart-bar--active': tooltip.chartId === 'incidents' && tooltip.highlightIndex === i }"
                  />
                </g>
                <!-- Invisible overlay for mouse capture -->
                <rect
                  :x="CHART_LEFT"
                  :y="CHART_TOP"
                  :width="CHART_W"
                  :height="CHART_H"
                  fill="transparent"
                  class="chart-overlay"
                />
                <!-- X labels -->
                <text
                  v-for="(xl, xi) in incidentChart.xLabels"
                  :key="`ix-${xi}`"
                  :x="xl.x"
                  y="192"
                  text-anchor="middle"
                  font-size="8"
                  class="chart-label"
                >{{ xl.label }}</text>
              </svg>
              <!-- Tooltip -->
              <div
                v-if="tooltip.visible && tooltip.chartId === 'incidents'"
                class="chart-tooltip"
                :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
                :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
              >{{ tooltip.content }}</div>
              <!-- Legend -->
              <div class="incident-chart-legend">
                <span class="legend-item"><span class="legend-dot" style="background: var(--color-warning, #f59e0b);"></span> Rate Limits</span>
                <span class="legend-item"><span class="legend-dot" style="background: var(--color-danger, #ef4444);"></span> Other Errors</span>
                <span class="legend-item"><span class="legend-dot" style="background: var(--chart-secondary, #6366f1);"></span> Compactions</span>
                <span class="legend-item"><span class="legend-dot" style="background: var(--text-tertiary, #9ca3af);"></span> Truncations</span>
              </div>
            </div>
          </div>

        </template>
      </LoadingOverlay>
    </div>
  </div>
</template>

<style scoped>
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
  background: linear-gradient(135deg, var(--chart-primary), var(--chart-secondary));
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
  cursor: default;
  transition: color var(--transition-fast, 0.15s);
}

.donut-legend-item--active {
  color: var(--text-primary);
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

.donut-segment {
  cursor: default;
  transition: stroke-width 0.15s ease;
}

/* ── Chart interaction styles ─────────────────────────────────── */
.chart-container {
  position: relative;
}

.chart-overlay {
  cursor: pointer;
}

.chart-bar {
  transition: opacity 0.15s ease;
  pointer-events: none;
}

.chart-bar--active {
  opacity: 0.7;
}

.chart-dot {
  pointer-events: none;
}

.chart-highlight-ring {
  pointer-events: none;
  opacity: 0.6;
}

.chart-tooltip {
  position: absolute;
  pointer-events: none;
  background: var(--canvas-overlay, rgba(0, 0, 0, 0.85));
  color: var(--text-on-emphasis, #fff);
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  white-space: nowrap;
  z-index: 10;
  transform: translateX(-50%);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.chart-tooltip--pinned {
  border: 1px solid var(--border-default, rgba(255, 255, 255, 0.2));
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

.more-info-link {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  cursor: pointer;
  transition: color 0.15s;
}
.more-info-link:hover {
  color: var(--accent-primary);
}

/* ── Model distribution legend request count ──────────────────── */
.donut-legend-requests {
  font-size: 0.7rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 52px;
  text-align: right;
}

/* ── Cache Efficiency ─────────────────────────────────────────── */
.cache-hit-rate {
  padding: 18px 18px 0;
}

.cache-hit-rate-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.stat-card--incident-error {
  border-left: 3px solid var(--color-danger, #ef4444);
  background: color-mix(in srgb, var(--color-danger, #ef4444) 6%, var(--surface-secondary));
}

.stat-card--incident-ratelimit {
  border-left: 3px solid var(--color-warning, #f59e0b);
  background: color-mix(in srgb, var(--color-warning, #f59e0b) 6%, var(--surface-secondary));
}

.stat-card--incident-compaction {
  border-left: 3px solid var(--chart-secondary, #6366f1);
  background: color-mix(in srgb, var(--chart-secondary, #6366f1) 6%, var(--surface-secondary));
}

.stat-card--incident-truncation {
  border-left: 3px solid var(--text-tertiary, #9ca3af);
  background: color-mix(in srgb, var(--text-tertiary, #9ca3af) 6%, var(--surface-secondary));
}

.incident-chart-legend {
  display: flex;
  gap: 20px;
  justify-content: center;
  padding: 10px 0 6px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.incident-normalize-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.incident-normalize-toggle input {
  accent-color: var(--accent-primary);
  cursor: pointer;
}

.cache-hit-rate-label strong {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.cache-progress-track {
  height: 8px;
  border-radius: 4px;
  background: var(--border-subtle, rgba(255,255,255,0.12));
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.2);
  overflow: hidden;
}

.cache-progress-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}

.cache-progress-fill--high  { background: linear-gradient(90deg, var(--chart-success), var(--chart-success-light)); }
.cache-progress-fill--mid   { background: linear-gradient(90deg, var(--chart-warning), #fde68a); }
.cache-progress-fill--low   { background: linear-gradient(90deg, var(--chart-danger), var(--chart-danger-light)); }

.mt-3 {
  margin-top: 0;
}

/* ── Session Health Distribution ─────────────────────────────── */
.health-dist-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 18px;
}

.health-dist-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px 8px;
  border-radius: 10px;
  border: 1px solid transparent;
}

.health-dist-card--healthy {
  background: rgba(52, 211, 153, 0.08);
  border-color: rgba(52, 211, 153, 0.2);
}

.health-dist-card--attention {
  background: rgba(251, 191, 36, 0.08);
  border-color: rgba(251, 191, 36, 0.2);
}

.health-dist-card--critical {
  background: rgba(251, 113, 133, 0.08);
  border-color: rgba(251, 113, 133, 0.2);
}

.health-dist-count {
  font-size: 1.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.health-dist-card--healthy .health-dist-count  { color: var(--chart-success); }
.health-dist-card--attention .health-dist-count { color: var(--chart-warning); }
.health-dist-card--critical .health-dist-count  { color: var(--chart-danger); }

.health-dist-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.health-dist-sub {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
</style>
