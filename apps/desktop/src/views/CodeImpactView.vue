<script setup lang="ts">
import {
  ErrorState,
  computeGridLines,
  createChartLayout,
  formatDateShort,
  formatNumberFull,
  generateYLabels,
  LoadingOverlay,
  mapToLineCoords,
  toPolylinePoints,
  useChartTooltip,
} from '@tracepilot/ui';
import { computed } from 'vue';
import AnalyticsPageHeader from '@/components/AnalyticsPageHeader.vue';
import { useAnalyticsPage } from '@/composables/useAnalyticsPage';
import { CHART_COLORS } from '@/utils/chartColors';

const { tooltip, dismissTooltip, onChartMouseMove, onChartClick, onBarMouseEnter } = useChartTooltip();
const { store } = useAnalyticsPage('fetchCodeImpact');

const loading = computed(() => store.codeImpactLoading);
const data = computed(() => store.codeImpact);

const pageSubtitle = computed(() => {
  const allPrefix = store.selectedRepo ? '' : 'all ';
  const repoSuffix = store.selectedRepo ? ` in ${store.selectedRepo}` : '';
  return `Code changes and file modifications across ${allPrefix}sessions${repoSuffix}`;
});

// ── File Type Bar Chart ──────────────────────────────────────
const maxFileTypeCount = computed(() => {
  if (!data.value) return 1;
  return Math.max(...data.value.fileTypeBreakdown.map((f) => f.count), 1);
});

// ── Most Modified Files ──────────────────────────────────────
const maxChurn = computed(() => {
  if (!data.value) return 1;
  return Math.max(...data.value.mostModifiedFiles.map((f) => f.additions + f.deletions), 1);
});

function churnBarWidth(adds: number, dels: number): number {
  return Math.round(((adds + dels) / maxChurn.value) * 100);
}

function addPct(adds: number, dels: number): number {
  const total = adds + dels;
  return total > 0 ? Math.round((adds / total) * 100) : 0;
}

// ── Changes Over Time Area Chart ─────────────────────────────
const chartLayout = createChartLayout(50, 680, 30, 200);
const { left: CHART_LEFT, right: CHART_RIGHT, top: CHART_TOP, bottom: CHART_BOTTOM, width: CHART_W, height: CHART_H } = chartLayout;

const GRID_ROWS = 4;
const gridYPositions = computed(() => computeGridLines(chartLayout, GRID_ROWS + 1, GRID_ROWS));

const timelineChart = computed(() => {
  if (!data.value) return null;
  const pts = data.value.changesByDay;
  const maxVal = Math.max(...pts.map((p) => Math.max(p.additions, p.deletions)), 1);

  const addCoords = mapToLineCoords(pts, chartLayout, (p) => p.additions, maxVal);
  const delCoords = mapToLineCoords(pts, chartLayout, (p) => p.deletions, maxVal);

  const addLine = toPolylinePoints(addCoords);
  const delLine = toPolylinePoints(delCoords);

  const addArea = `${CHART_LEFT},${CHART_BOTTOM} ${addLine} ${CHART_RIGHT},${CHART_BOTTOM}`;
  const delArea = `${CHART_LEFT},${CHART_BOTTOM} ${delLine} ${CHART_RIGHT},${CHART_BOTTOM}`;

  const yLabels = generateYLabels(maxVal, chartLayout, 5, (v) => formatNumberFull(Math.round(v)));

  // Show all labels (no stride filtering) — this chart has fewer data points
  const xLabels = addCoords.map((c) => ({
    label: formatDateShort(c.date),
    x: c.x,
  }));

  return { addLine, delLine, addArea, delArea, yLabels, xLabels, addCoords, delCoords };
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <AnalyticsPageHeader title="Code Impact" :subtitle="pageSubtitle" />
      <LoadingOverlay :loading="loading" message="Loading code impact data…">
        <ErrorState v-if="store.codeImpactError" heading="Failed to load code impact data" :message="store.codeImpactError" @retry="store.fetchCodeImpact({ force: true })" />
        <template v-else-if="data">

          <!-- Stats Row -->
          <div class="grid-4 mb-4">
            <div class="stat-card">
              <div class="stat-card-value accent">{{ formatNumberFull(data.filesModified) }}</div>
              <div class="stat-card-label">Files Modified</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value lines-added-value">+{{ formatNumberFull(data.linesAdded) }}</div>
              <div class="stat-card-label">Lines Added</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value danger">-{{ formatNumberFull(data.linesRemoved) }}</div>
              <div class="stat-card-label">Lines Removed</div>
            </div>
            <div class="stat-card">
              <div :class="['stat-card-value', data.netChange >= 0 ? 'done' : 'danger']">{{ data.netChange >= 0 ? '+' : '' }}{{ formatNumberFull(data.netChange) }}</div>
              <div class="stat-card-label">Net Change</div>
              <div class="stat-card-trend">{{ data.netChange > 0 ? 'Net positive' : data.netChange < 0 ? 'Net negative' : 'Net neutral' }}</div>
            </div>
          </div>

          <!-- Two-Column Layout -->
          <div class="grid-2 mb-4">
            <!-- File Type Breakdown (bar chart) -->
            <div class="section-panel">
              <div class="section-panel-header">File Type Breakdown</div>
              <div class="section-panel-body tooltip-area" @mouseleave="dismissTooltip">
                <div
                  v-for="ft in data.fileTypeBreakdown"
                  :key="ft.extension"
                  class="token-bar"
                  @mouseenter="onBarMouseEnter($event, `${ft.extension} — ${ft.count} file${ft.count !== 1 ? 's' : ''}`, 'file-types')"
                >
                  <span class="token-bar-label font-mono">{{ ft.extension }}</span>
                  <div class="token-bar-track">
                    <div
                      class="token-bar-fill"
                      :style="{ width: (ft.count / maxFileTypeCount * 100) + '%' }"
                    />
                  </div>
                  <span class="token-bar-value">{{ ft.count }} files</span>
                </div>
                <div
                  v-if="tooltip.visible && tooltip.chartId === 'file-types'"
                  class="chart-tooltip"
                  :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
                  :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
                >{{ tooltip.content }}</div>
              </div>
            </div>

            <!-- Most Modified Files -->
            <div class="section-panel">
              <div class="section-panel-header">Most Modified Files</div>
              <div class="section-panel-body tooltip-area" @mouseleave="dismissTooltip">
                <div
                  v-for="file in data.mostModifiedFiles"
                  :key="file.path"
                  class="file-row"
                  @mouseenter="onBarMouseEnter($event, `${file.path} — modified in ${file.additions} session${file.additions !== 1 ? 's' : ''}`, 'modified-files')"
                >
                  <span class="file-path font-mono">{{ file.path }}</span>
                  <span class="file-freq">{{ file.additions }} session{{ file.additions !== 1 ? 's' : '' }}</span>
                  <div
                    class="churn-bar"
                    :style="{ width: churnBarWidth(file.additions, 0) + 'px' }"
                  >
                    <div class="churn-bar-add" style="width: 100%" />
                  </div>
                </div>
                <div
                  v-if="tooltip.visible && tooltip.chartId === 'modified-files'"
                  class="chart-tooltip"
                  :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
                  :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
                >{{ tooltip.content }}</div>
              </div>
            </div>
          </div>

          <!-- Changes Over Time -->
          <div class="section-panel mb-4">
            <div class="section-panel-header">Changes Over Time</div>
            <div class="section-panel-body">
              <div class="chart-legend">
                <span><span class="chart-legend-dot" :style="{ background: CHART_COLORS.success }" />Additions</span>
                <span><span class="chart-legend-dot" :style="{ background: CHART_COLORS.danger }" />Deletions</span>
              </div>
              <div class="chart-container tooltip-area" @mouseleave="dismissTooltip">
                <svg
                  v-if="timelineChart"
                  viewBox="0 0 700 220"
                  role="img"
                  aria-label="Area chart showing lines added and removed over 14 days"
                  font-family="Inter"
                  @mousemove="onChartMouseMove($event, timelineChart.addCoords, (i) => `${formatDateShort(timelineChart!.addCoords[i].date)} — +${formatNumberFull(timelineChart!.addCoords[i].additions)} / -${formatNumberFull(timelineChart!.addCoords[i].deletions)}`, 'timeline')"
                  @click="onChartClick($event, timelineChart.addCoords, (i) => `${formatDateShort(timelineChart!.addCoords[i].date)} — +${formatNumberFull(timelineChart!.addCoords[i].additions)} / -${formatNumberFull(timelineChart!.addCoords[i].deletions)}`, 'timeline')"
                >
                  <!-- Grid lines -->
                  <line
                    v-for="(gy, gi) in gridYPositions"
                    :key="`g-${gi}`"
                    :x1="CHART_LEFT"
                    :y1="gy"
                    :x2="CHART_RIGHT"
                    :y2="gy"
                    class="chart-grid-line"
                    stroke-dasharray="4,3"
                  />
                  <!-- Y-axis labels -->
                  <text
                    v-for="(yl, yi) in timelineChart.yLabels"
                    :key="`y-${yi}`"
                    :x="CHART_LEFT - 6"
                    :y="yl.y + 4"
                    text-anchor="end"
                    font-size="9"
                    class="chart-label"
                  >{{ yl.value }}</text>
                  <!-- Additions area -->
                  <polygon :points="timelineChart.addArea" :fill="CHART_COLORS.success" fill-opacity="0.15" />
                  <!-- Deletions area -->
                  <polygon :points="timelineChart.delArea" :fill="CHART_COLORS.danger" fill-opacity="0.15" />
                  <!-- Additions line -->
                  <polyline
                    :points="timelineChart.addLine"
                    fill="none"
                    :stroke="CHART_COLORS.success"
                    stroke-width="2"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                  <!-- Deletions line -->
                  <polyline
                    :points="timelineChart.delLine"
                    fill="none"
                    :stroke="CHART_COLORS.danger"
                    stroke-width="2"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                  <!-- Axes -->
                  <line :x1="CHART_LEFT" :y1="CHART_TOP" :x2="CHART_LEFT" :y2="CHART_BOTTOM" class="chart-axis" stroke-width="1" />
                  <line :x1="CHART_LEFT" :y1="CHART_BOTTOM" :x2="CHART_RIGHT" :y2="CHART_BOTTOM" class="chart-axis" stroke-width="1" />
                  <!-- Highlight rings -->
                  <circle
                    v-if="tooltip.chartId === 'timeline' && tooltip.highlightIndex >= 0 && tooltip.highlightIndex < timelineChart.addCoords.length"
                    :cx="timelineChart.addCoords[tooltip.highlightIndex].x"
                    :cy="timelineChart.addCoords[tooltip.highlightIndex].y"
                    r="6"
                    fill="none"
                    :stroke="CHART_COLORS.success"
                    stroke-width="2"
                    class="chart-highlight-ring"
                  />
                  <circle
                    v-if="tooltip.chartId === 'timeline' && tooltip.highlightIndex >= 0 && tooltip.highlightIndex < timelineChart.delCoords.length"
                    :cx="timelineChart.delCoords[tooltip.highlightIndex].x"
                    :cy="timelineChart.delCoords[tooltip.highlightIndex].y"
                    r="6"
                    fill="none"
                    :stroke="CHART_COLORS.danger"
                    stroke-width="2"
                    class="chart-highlight-ring"
                  />
                  <!-- Invisible overlay for mouse capture -->
                  <rect
                    :x="CHART_LEFT"
                    :y="CHART_TOP"
                    :width="CHART_W"
                    :height="CHART_H"
                    fill="transparent"
                    class="chart-overlay"
                  />
                  <!-- X-axis labels -->
                  <text
                    v-for="(xl, xi) in timelineChart.xLabels"
                    :key="`x-${xi}`"
                    :x="xl.x"
                    y="215"
                    text-anchor="middle"
                    font-size="8"
                    class="chart-label"
                  >{{ xl.label }}</text>
                </svg>
                <!-- Tooltip -->
                <div
                  v-if="tooltip.visible && tooltip.chartId === 'timeline'"
                  class="chart-tooltip"
                  :class="{ 'chart-tooltip--pinned': tooltip.pinned }"
                  :style="{ left: tooltip.x + 'px', top: (tooltip.y - 36) + 'px' }"
                >{{ tooltip.content }}</div>
              </div>
            </div>
          </div>
        </template>
      </LoadingOverlay>
    </div>
  </div>
</template>

<style scoped>
.lines-added-value {
  background: linear-gradient(135deg, var(--chart-success), var(--chart-success-light));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* File churn rows */
.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.75rem;
}
.file-row:last-child { border-bottom: none; }
.file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}
.file-adds {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--chart-success);
  white-space: nowrap;
}
.file-dels {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--chart-danger);
  white-space: nowrap;
}
.churn-bar {
  width: 80px;
  height: 6px;
  border-radius: 3px;
  background: var(--neutral-muted);
  overflow: hidden;
  display: flex;
  flex-shrink: 0;
}
.churn-bar-add {
  height: 100%;
  background: var(--chart-success);
}
.churn-bar-del {
  height: 100%;
  background: var(--chart-danger);
}

/* Chart — shared chart styles (tooltip, overlay, grid, axis, etc.)
   are in styles/chart-shared.css — imported globally via main.ts. */
.chart-legend {
  display: flex;
  gap: 16px;
  justify-content: flex-end;
  margin-bottom: 8px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.chart-legend-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}
</style>
