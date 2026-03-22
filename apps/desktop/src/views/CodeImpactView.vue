<script setup lang="ts">
import { ErrorState, formatDateShort, formatNumberFull, LoadingOverlay } from '@tracepilot/ui';
import { computed, onMounted, reactive, watch } from 'vue';
import AnalyticsPageHeader from '@/components/AnalyticsPageHeader.vue';
import { useAnalyticsStore } from '@/stores/analytics';
import { CHART_COLORS } from '@/utils/chartColors';

const store = useAnalyticsStore();

onMounted(() => {
  store.fetchAvailableRepos();
  store.fetchCodeImpact();
});

watch(
  [() => store.selectedRepo, () => store.dateRange],
  () => {
    store.fetchCodeImpact({ force: true });
  },
  { deep: true },
);

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

// ── Tooltip state ────────────────────────────────────────────
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

function onChartMouseMove(
  event: MouseEvent,
  coords: { x: number; date: string }[],
  formatContent: (idx: number) => string,
  chartId: string,
) {
  if (tooltip.pinned) return;
  const svg = (event.target as SVGElement)?.closest('svg');
  const container = (event.target as SVGElement)?.closest('.tooltip-area') as HTMLElement;
  if (!svg || !container || coords.length === 0) return;
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse());
  let bestIdx = 0;
  let bestDist = Math.abs(svgPt.x - coords[0].x);
  for (let i = 1; i < coords.length; i++) {
    const d = Math.abs(svgPt.x - coords[i].x);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
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
    tooltip.pinned = false;
    return;
  }
  tooltip.pinned = false;
  onChartMouseMove(event, coords, formatContent, chartId);
  tooltip.pinned = true;
}

function onBarMouseEnter(event: MouseEvent, content: string, chartId: string) {
  if (tooltip.pinned) return;
  const container = (event.target as HTMLElement)?.closest('.tooltip-area') as HTMLElement;
  if (!container) return;
  tooltip.visible = true;
  tooltip.content = content;
  tooltip.chartId = chartId;
  tooltip.highlightIndex = -1;
  positionTooltip(event, container);
}

function dismissTooltip() {
  tooltip.visible = false;
  tooltip.pinned = false;
  tooltip.chartId = '';
  tooltip.highlightIndex = -1;
}

// ── Changes Over Time Area Chart ─────────────────────────────
const CHART_LEFT = 50;
const CHART_RIGHT = 680;
const CHART_TOP = 30;
const CHART_BOTTOM = 200;
const CHART_W = CHART_RIGHT - CHART_LEFT;
const CHART_H = CHART_BOTTOM - CHART_TOP;

const GRID_ROWS = 4;
const gridYPositions = computed(() =>
  Array.from({ length: GRID_ROWS + 1 }, (_, i) => CHART_TOP + (i * CHART_H) / GRID_ROWS),
);

const timelineChart = computed(() => {
  if (!data.value) return null;
  const pts = data.value.changesByDay;
  const maxVal = Math.max(...pts.map((p) => Math.max(p.additions, p.deletions)), 1);
  const step = pts.length > 1 ? CHART_W / (pts.length - 1) : CHART_W;

  const addCoords = pts.map((p, i) => ({
    x: CHART_LEFT + i * step,
    y: CHART_BOTTOM - (p.additions / maxVal) * CHART_H,
    date: p.date,
    additions: p.additions,
    deletions: p.deletions,
  }));

  const delCoords = pts.map((p, i) => ({
    x: CHART_LEFT + i * step,
    y: CHART_BOTTOM - (p.deletions / maxVal) * CHART_H,
    date: p.date,
    additions: p.additions,
    deletions: p.deletions,
  }));

  const addLine = addCoords.map((c) => `${c.x},${c.y}`).join(' ');
  const delLine = delCoords.map((c) => `${c.x},${c.y}`).join(' ');

  const addArea = `${CHART_LEFT},${CHART_BOTTOM} ${addLine} ${CHART_RIGHT},${CHART_BOTTOM}`;
  const delArea = `${CHART_LEFT},${CHART_BOTTOM} ${delLine} ${CHART_RIGHT},${CHART_BOTTOM}`;

  const yLabels = Array.from({ length: 5 }, (_, i) => ({
    value: formatNumberFull(Math.round((maxVal / 4) * i)),
    y: CHART_BOTTOM - (i * CHART_H) / 4,
  }));

  const xLabels = pts.map((p, i) => ({
    label: formatDateShort(p.date),
    x: CHART_LEFT + i * step,
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

/* Chart */
.tooltip-area {
  position: relative;
}
.tooltip-area svg {
  display: block;
  width: 100%;
  height: auto;
}
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

/* ── Tooltip & hover enrichments ───────────────────────────── */
.chart-overlay {
  cursor: pointer;
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
</style>
