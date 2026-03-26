<script setup lang="ts">
import type { ToolUsageEntry } from '@tracepilot/types';
import { ErrorState, formatDuration, formatNumberFull, formatRate, LoadingOverlay, useChartTooltip } from '@tracepilot/ui';
import { computed } from 'vue';
import AnalyticsPageHeader from '@/components/AnalyticsPageHeader.vue';
import { useAnalyticsPage } from '@/composables/useAnalyticsPage';
import { CHART_COLORS } from '@/utils/chartColors';

const { tooltip, positionTooltip, dismissTooltip, onBarMouseEnter, findNearestIndex } = useChartTooltip();
const { store } = useAnalyticsPage('fetchToolAnalysis');

const loading = computed(() => store.toolAnalysisLoading);
const data = computed(() => store.toolAnalysis);

const pageSubtitle = computed(() => {
  const repoSuffix = store.selectedRepo ? ` in ${store.selectedRepo}` : '';
  return `Performance and usage metrics across all tool invocations${repoSuffix}`;
});

// ── Computed values ──────────────────────────────────────────
const uniqueToolCount = computed(() => data.value?.tools.length ?? 0);

// ── Custom chart handlers (Y-axis nearest-point) ─────────────
function onSuccessFailureMouseMove(event: MouseEvent) {
  if (tooltip.pinned) return;
  const chart = successFailureChart.value;
  if (!chart) return;
  const svg = (event.target as SVGElement)?.closest('svg');
  const container = (event.target as SVGElement)?.closest('.tooltip-area') as HTMLElement;
  if (!svg || !container) return;
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const svgPt = pt.matrixTransform(ctm.inverse());
  const bestIdx = findNearestIndex(chart.rows.map(r => r.y + BAR_HEIGHT / 2), svgPt.y);
  if (bestIdx < 0) return;
  const row = chart.rows[bestIdx];
  const total = row.successCount + row.failureCount;
  const rate = total > 0 ? ((row.successCount / total) * 100).toFixed(1) : '0.0';
  tooltip.visible = true;
  tooltip.content = `${row.tool.name} — ${formatNumberFull(row.successCount)} success / ${formatNumberFull(row.failureCount)} failure (${rate}%)`;
  tooltip.chartId = 'success-failure';
  tooltip.highlightIndex = bestIdx;
  positionTooltip(event, container);
}

function onSuccessFailureClick(event: MouseEvent) {
  if (tooltip.pinned && tooltip.chartId === 'success-failure') {
    tooltip.pinned = false;
    return;
  }
  tooltip.pinned = false;
  onSuccessFailureMouseMove(event);
  if (tooltip.visible) {
    tooltip.pinned = true;
  }
}

const sortedTools = computed<ToolUsageEntry[]>(() => {
  if (!data.value) return [];
  return [...data.value.tools].sort((a, b) => b.callCount - a.callCount);
});

const maxInvocations = computed(() => {
  if (!sortedTools.value.length) return 1;
  return sortedTools.value[0].callCount;
});

// ── Heatmap ──────────────────────────────────────────────────
const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hourLabels = Array.from({ length: 24 }, (_, i) => {
  if (i % 3 === 0) return `${i}:00`;
  return '';
});

const heatmapData = computed<number[][]>(() => {
  if (!data.value) return [];
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  // Backend stores heatmap in UTC; convert to local timezone
  const localOffsetMinutes = -new Date().getTimezoneOffset(); // e.g. +330 for UTC+5:30
  for (const entry of data.value.activityHeatmap) {
    if (entry.day >= 0 && entry.day < 7 && entry.hour >= 0 && entry.hour < 24) {
      const utcMinutes = entry.hour * 60;
      const localMinutes = utcMinutes + localOffsetMinutes;
      let localHour = Math.floor(localMinutes / 60);
      let localDay = entry.day;
      if (localHour >= 24) {
        localHour -= 24;
        localDay = (localDay + 1) % 7;
      } else if (localHour < 0) {
        localHour += 24;
        localDay = (localDay + 6) % 7;
      }
      grid[localDay][localHour] += entry.count;
    }
  }
  return grid;
});

const heatmapMax = computed(() => {
  let max = 1;
  for (const row of heatmapData.value) {
    for (const val of row) {
      if (val > max) max = val;
    }
  }
  return max;
});

function getHeatmapColor(val: number): string {
  if (val === 0) return 'var(--heatmap-empty, rgba(99, 102, 241, 0.04))';
  const intensity = Math.min(val / heatmapMax.value, 1);
  const opacity = 0.1 + intensity * 0.8;
  return `rgba(99, 102, 241, ${opacity.toFixed(2)})`;
}

function getHeatmapLegendColor(level: number): string {
  const opacity = 0.1 + (level / 5) * 0.8;
  return `rgba(99, 102, 241, ${opacity.toFixed(2)})`;
}

// ── Success/Failure Chart ────────────────────────────────────
const CHART_LEFT = 100;
const CHART_WIDTH = 396;
const BAR_HEIGHT = 22;
const ROW_SPACING = 28;

const successFailureChart = computed(() => {
  if (!sortedTools.value.length) return null;
  const maxCalls = maxInvocations.value;
  const rows = sortedTools.value.map((tool, i) => {
    const successCount = Math.round(tool.callCount * tool.successRate);
    const failureCount = tool.callCount - successCount;
    const successWidth = (successCount / maxCalls) * CHART_WIDTH;
    const failureWidth = (failureCount / maxCalls) * CHART_WIDTH;
    const y = 18 + i * ROW_SPACING;
    return { tool, successCount, failureCount, successWidth, failureWidth, y };
  });
  const svgHeight = 18 + rows.length * ROW_SPACING + 10;
  return { rows, svgHeight };
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <AnalyticsPageHeader title="Tool Analysis" :subtitle="pageSubtitle" />
      <LoadingOverlay :loading="loading" message="Loading tool analysis…">
        <ErrorState v-if="store.toolAnalysisError" heading="Failed to load tool analysis" :message="store.toolAnalysisError" @retry="store.fetchToolAnalysis({ force: true })" />
        <template v-else-if="data">

          <!-- Stat Cards -->
          <div class="grid-4 mb-4">
            <div class="stat-card">
              <div class="stat-card-value accent">{{ formatNumberFull(data.totalCalls) }}</div>
              <div class="stat-card-label">Total Tool Calls</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value done">{{ uniqueToolCount }}</div>
              <div class="stat-card-label">Unique Tools</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value success">{{ formatRate(data.successRate) }}</div>
              <div class="stat-card-label">Success Rate</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value warning">{{ formatDuration(data.avgDurationMs) }}</div>
              <div class="stat-card-label">Avg Duration</div>
            </div>
          </div>

          <!-- Tool Usage Table -->
          <div class="section-panel mb-4">
            <div class="section-panel-header">Tool Usage Breakdown</div>
            <div class="section-panel-body scrollable-section" style="padding: 0;">
              <table class="data-table" aria-label="Tool usage breakdown">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Invocations</th>
                    <th>Success Rate</th>
                    <th>Avg Duration</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="tool in sortedTools" :key="tool.name">
                    <td style="font-weight: 600;">{{ tool.name }}</td>
                    <td style="font-variant-numeric: tabular-nums;">{{ formatNumberFull(tool.callCount) }}</td>
                    <td>
                      <div style="font-variant-numeric: tabular-nums;">{{ formatRate(tool.successRate) }}</div>
                      <div class="progress-bar" style="margin-top: 4px; width: 120px;">
                        <div class="progress-bar-fill" :style="{ width: formatRate(tool.successRate) }" />
                      </div>
                    </td>
                    <td style="font-variant-numeric: tabular-nums;">{{ formatDuration(tool.avgDurationMs) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Tool Success/Failure Chart & Tool Frequency -->
          <div class="grid-2 mb-4">
            <!-- Success/Failure Chart -->
            <div class="section-panel">
              <div class="section-panel-header">Success / Failure Breakdown</div>
              <div class="section-panel-body scrollable-section tooltip-area" @mouseleave="dismissTooltip">
                <div class="legend">
                  <span><span class="legend-dot" :style="{ background: CHART_COLORS.success }" />&nbsp;Success</span>
                  <span><span class="legend-dot" :style="{ background: CHART_COLORS.danger }" />&nbsp;Failure</span>
                </div>
                <svg
                  v-if="successFailureChart"
                  class="chart-svg"
                  :viewBox="`0 0 600 ${successFailureChart.svgHeight}`"
                  role="img"
                  aria-label="Stacked horizontal bar chart showing success and failure counts per tool"
                  @mousemove="onSuccessFailureMouseMove($event)"
                  @click="onSuccessFailureClick($event)"
                >
                  <template v-for="(row, ri) in successFailureChart.rows" :key="`sf-${ri}`">
                    <text
                      :x="CHART_LEFT - 12"
                      :y="row.y + BAR_HEIGHT / 2 + 4"
                      font-family="Inter, sans-serif"
                      font-size="12"
                      fill="var(--text-placeholder)"
                      text-anchor="end"
                    >{{ row.tool.name }}</text>
                    <!-- Success bar -->
                    <rect
                      :x="CHART_LEFT"
                      :y="row.y"
                      :width="Math.max(row.successWidth, 0)"
                      :height="BAR_HEIGHT"
                      rx="3"
                      :fill="CHART_COLORS.success"
                      class="chart-bar"
                      :class="{ 'chart-bar--active': tooltip.chartId === 'success-failure' && tooltip.highlightIndex === ri }"
                    />
                    <!-- Failure bar -->
                    <rect
                      v-if="row.failureWidth > 0"
                      :x="CHART_LEFT + row.successWidth"
                      :y="row.y"
                      :width="row.failureWidth"
                      :height="BAR_HEIGHT"
                      rx="3"
                      :fill="CHART_COLORS.danger"
                      class="chart-bar"
                      :class="{ 'chart-bar--active': tooltip.chartId === 'success-failure' && tooltip.highlightIndex === ri }"
                    />
                    <!-- Label -->
                    <text
                      :x="CHART_LEFT + row.successWidth + row.failureWidth + 8"
                      :y="row.y + BAR_HEIGHT / 2 + 4"
                      font-family="Inter, sans-serif"
                      font-size="10"
                      fill="var(--text-placeholder)"
                    >{{ row.successCount }} / {{ row.failureCount }}</text>
                  </template>
                  <!-- Invisible overlay for mouse capture -->
                  <rect
                    :x="0"
                    :y="0"
                    width="600"
                    :height="successFailureChart.svgHeight"
                    fill="transparent"
                    class="chart-overlay"
                  />
                </svg>
                <!-- Tooltip -->
                <div
                  v-if="tooltip.visible && tooltip.chartId === 'success-failure'"
                  class="chart-tooltip"
                  :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
                  :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
                >{{ tooltip.content }}</div>
              </div>
            </div>

            <!-- Tool Frequency -->
            <div class="section-panel">
              <div class="section-panel-header">Tool Frequency</div>
              <div class="section-panel-body scrollable-section tooltip-area" @mouseleave="dismissTooltip">
                <div class="frequency-chart">
                  <div
                    class="freq-row"
                    v-for="tool in sortedTools"
                    :key="tool.name"
                    @mouseenter="onBarMouseEnter($event, `${tool.name} — ${formatNumberFull(tool.callCount)} invocation${tool.callCount !== 1 ? 's' : ''}`, 'frequency')"
                  >
                    <span class="freq-label">{{ tool.name }}</span>
                    <div class="freq-bar-track">
                      <div class="freq-bar" :style="{ width: (tool.callCount / maxInvocations * 100) + '%' }" />
                    </div>
                    <span class="freq-count">{{ formatNumberFull(tool.callCount) }}</span>
                  </div>
                </div>
                <div
                  v-if="tooltip.visible && tooltip.chartId === 'frequency'"
                  class="chart-tooltip"
                  :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
                  :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
                >{{ tooltip.content }}</div>
              </div>
            </div>
          </div>

          <!-- Activity Heatmap -->
          <div class="section-panel mb-4">
            <div class="section-panel-header">Activity Heatmap</div>
            <div class="section-panel-body tooltip-area" @mouseleave="dismissTooltip">
              <div class="heatmap">
                <!-- Hour labels row -->
                <div class="heatmap-row heatmap-hour-labels">
                  <span class="heatmap-label" />
                  <span
                    class="heatmap-hour"
                    v-for="(label, hourIdx) in hourLabels"
                    :key="`h-${hourIdx}`"
                  >{{ label }}</span>
                </div>
                <!-- Day rows -->
                <div class="heatmap-row" v-for="(row, dayIdx) in heatmapData" :key="dayIdx">
                  <span class="heatmap-label">{{ dayLabels[dayIdx] }}</span>
                  <div
                    class="heatmap-cell"
                    v-for="(val, hourIdx) in row"
                    :key="hourIdx"
                    :style="{ backgroundColor: getHeatmapColor(val) }"
                    @mouseenter="onBarMouseEnter($event, `${dayLabels[dayIdx]} ${String(hourIdx).padStart(2, '0')}:00 — ${val} tool call${val !== 1 ? 's' : ''}`, 'heatmap')"
                  >
                    <span v-if="val > 0" class="heatmap-count">{{ val }}</span>
                  </div>
                </div>
                <div class="heatmap-legend">
                  <span>Less</span>
                  <div
                    class="heatmap-cell heatmap-legend-cell"
                    v-for="level in 5"
                    :key="level"
                    :style="{ backgroundColor: getHeatmapLegendColor(level) }"
                  />
                  <span>More</span>
                </div>
              </div>
              <div
                v-if="tooltip.visible && tooltip.chartId === 'heatmap'"
                class="chart-tooltip"
                :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
                :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
              >{{ tooltip.content }}</div>
            </div>
          </div>
        </template>
      </LoadingOverlay>
    </div>
  </div>
</template>

<style scoped>
/* ── Legend ─────────────────────────────────────────────────── */
.legend {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 0.75rem;
  color: var(--text-placeholder);
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 5px;
}

/* Shared chart styles (tooltip, overlay, bar, svg, etc.)
   are in styles/chart-shared.css — imported globally via main.ts. */

/* ── Table row hover ──────────────────────────────────────── */
.data-table tbody tr:hover {
  background: var(--neutral-muted, rgba(99, 102, 241, 0.06));
}

/* ── Heatmap ───────────────────────────────────────────────── */
.heatmap {
  overflow-x: auto;
}

.heatmap-row {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-bottom: 3px;
}

.heatmap-hour-labels {
  margin-bottom: 6px;
}

.heatmap-hour {
  width: 28px;
  flex-shrink: 0;
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-align: center;
}

.heatmap-label {
  width: 40px;
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-align: right;
  padding-right: 8px;
  font-weight: 500;
}

.heatmap-cell {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  flex-shrink: 0;
  transition: outline 0.1s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.heatmap-cell:hover {
  outline: 2px solid var(--accent-fg);
  outline-offset: -1px;
  z-index: 1;
}

.heatmap-count {
  font-size: 0.5625rem;
  font-weight: 600;
  color: var(--text-on-emphasis);
  pointer-events: none;
}

.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  padding-left: 48px;
}

.heatmap-legend-cell {
  width: 20px;
  height: 20px;
  cursor: default;
}

.heatmap-legend-cell:hover {
  outline: none;
}

/* ── Scrollable Sections ──────────────────────────────────── */
.scrollable-section {
  max-height: 400px;
  overflow-y: auto;
}

/* ── Tool Frequency ────────────────────────────────────────── */
.frequency-chart {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.freq-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.freq-row:last-child {
  border-bottom: none;
}

.freq-label {
  width: 80px;
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.freq-bar-track {
  flex: 1;
  height: 8px;
  background: var(--neutral-muted);
  border-radius: 4px;
  overflow: hidden;
}

.freq-bar {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--chart-primary), var(--chart-primary-light));
  transition: width 0.3s ease;
}

.freq-count {
  width: 36px;
  text-align: right;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
</style>
