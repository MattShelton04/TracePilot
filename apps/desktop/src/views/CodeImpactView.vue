<script setup lang="ts">
import { ErrorState, formatDateShort, formatNumberFull, LoadingOverlay } from '@tracepilot/ui';
import { computed, onMounted, watch } from 'vue';
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
  }));

  const delCoords = pts.map((p, i) => ({
    x: CHART_LEFT + i * step,
    y: CHART_BOTTOM - (p.deletions / maxVal) * CHART_H,
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

  return { addLine, delLine, addArea, delArea, yLabels, xLabels };
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
              <div class="section-panel-body">
                <div
                  v-for="ft in data.fileTypeBreakdown"
                  :key="ft.extension"
                  class="token-bar"
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
              </div>
            </div>

            <!-- Most Modified Files -->
            <div class="section-panel">
              <div class="section-panel-header">Most Modified Files</div>
              <div class="section-panel-body">
                <div
                  v-for="file in data.mostModifiedFiles"
                  :key="file.path"
                  class="file-row"
                >
                  <span class="file-path font-mono">{{ file.path }}</span>
                  <span class="file-freq">{{ file.additions }} session{{ file.additions !== 1 ? 's' : '' }}</span>
                  <div
                    class="churn-bar"
                    :style="{ width: churnBarWidth(file.additions, 0) + 'px' }"
                    :title="`Modified in ${file.additions} session(s)`"
                  >
                    <div class="churn-bar-add" style="width: 100%" />
                  </div>
                </div>
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
              <div class="chart-container">
                <svg
                  v-if="timelineChart"
                  viewBox="0 0 700 220"
                  role="img"
                  aria-label="Area chart showing lines added and removed over 14 days"
                  font-family="Inter"
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
                    stroke-width="1"
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
.chart-container {
  width: 100%;
  overflow-x: auto;
}
.chart-container svg {
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
</style>
