<script setup lang="ts">
// STUB: Currently loads mock data from getToolAnalysis().
// STUB: Replace with real tool analytics API when backend is implemented.
// STUB: Activity heatmap uses generated mock data — wire to real session timestamps.
// STUB: Tool frequency derived from mock tool usage entries.

import { ref, computed, onMounted } from 'vue';
import { getToolAnalysis } from '@tracepilot/client';
import type { ToolAnalysisData, ToolUsageEntry } from '@tracepilot/types';
import LoadingOverlay from '@/components/LoadingOverlay.vue';
import StubBanner from '@/components/StubBanner.vue';

const loading = ref(true);
const data = ref<ToolAnalysisData | null>(null);

onMounted(async () => {
  try {
    data.value = await getToolAnalysis();
  } finally {
    loading.value = false;
  }
});

// ── Formatters ───────────────────────────────────────────────
function fmtDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

// ── Computed values ──────────────────────────────────────────
const uniqueToolCount = computed(() => data.value?.tools.length ?? 0);

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

const heatmapData = computed<number[][]>(() => {
  if (!data.value) return [];
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const entry of data.value.activityHeatmap) {
    if (entry.day >= 0 && entry.day < 7 && entry.hour >= 0 && entry.hour < 24) {
      grid[entry.day][entry.hour] = entry.count;
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
  if (val === 0) return 'rgba(99, 102, 241, 0.04)';
  const intensity = Math.min(val / heatmapMax.value, 1);
  const opacity = 0.1 + intensity * 0.8;
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
      <StubBanner />
      <LoadingOverlay :loading="loading" message="Loading tool analysis…">
        <template v-if="data">
          <!-- Title -->
          <div class="mb-4">
            <h1 class="page-title">Tool Analysis</h1>
            <p class="page-subtitle">
              Performance and usage metrics across all tool invocations
            </p>
          </div>

          <!-- Stat Cards -->
          <div class="grid-4 mb-4">
            <div class="stat-card">
              <div class="stat-card-value accent">{{ data.totalCalls }}</div>
              <div class="stat-card-label">Total Tool Calls</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value done">{{ uniqueToolCount }}</div>
              <div class="stat-card-label">Unique Tools</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value success">{{ fmtRate(data.successRate) }}</div>
              <div class="stat-card-label">Success Rate</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value warning">{{ fmtDuration(data.avgDurationMs) }}</div>
              <div class="stat-card-label">Avg Duration</div>
            </div>
          </div>

          <!-- Tool Usage Table -->
          <div class="section-panel mb-4">
            <div class="section-panel-header">Tool Usage Breakdown</div>
            <div class="section-panel-body" style="padding: 0;">
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
                    <td style="font-variant-numeric: tabular-nums;">{{ tool.callCount }}</td>
                    <td>
                      <div style="font-variant-numeric: tabular-nums;">{{ fmtRate(tool.successRate) }}</div>
                      <div class="progress-bar" style="margin-top: 4px; width: 120px;">
                        <div class="progress-bar-fill" :style="{ width: fmtRate(tool.successRate) }" />
                      </div>
                    </td>
                    <td style="font-variant-numeric: tabular-nums;">{{ fmtDuration(tool.avgDurationMs) }}</td>
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
              <div class="section-panel-body">
                <div class="legend">
                  <span><span class="legend-dot" style="background: #34d399;" />&nbsp;Success</span>
                  <span><span class="legend-dot" style="background: #fb7185;" />&nbsp;Failure</span>
                </div>
                <svg
                  v-if="successFailureChart"
                  class="chart-svg"
                  :viewBox="`0 0 600 ${successFailureChart.svgHeight}`"
                  role="img"
                  aria-label="Stacked horizontal bar chart showing success and failure counts per tool"
                >
                  <template v-for="(row, ri) in successFailureChart.rows" :key="`sf-${ri}`">
                    <text
                      :x="CHART_LEFT - 12"
                      :y="row.y + BAR_HEIGHT / 2 + 4"
                      font-family="Inter, sans-serif"
                      font-size="12"
                      fill="#a1a1aa"
                      text-anchor="end"
                    >{{ row.tool.name }}</text>
                    <!-- Success bar -->
                    <rect
                      :x="CHART_LEFT"
                      :y="row.y"
                      :width="Math.max(row.successWidth, 0)"
                      :height="BAR_HEIGHT"
                      rx="3"
                      fill="#34d399"
                    />
                    <!-- Failure bar -->
                    <rect
                      v-if="row.failureWidth > 0"
                      :x="CHART_LEFT + row.successWidth"
                      :y="row.y"
                      :width="row.failureWidth"
                      :height="BAR_HEIGHT"
                      rx="3"
                      fill="#fb7185"
                    />
                    <!-- Label -->
                    <text
                      :x="CHART_LEFT + row.successWidth + row.failureWidth + 8"
                      :y="row.y + BAR_HEIGHT / 2 + 4"
                      font-family="Inter, sans-serif"
                      font-size="10"
                      fill="#a1a1aa"
                    >{{ row.successCount }} / {{ row.failureCount }}</text>
                  </template>
                </svg>
              </div>
            </div>

            <!-- Tool Frequency -->
            <div class="section-panel">
              <div class="section-panel-header">Tool Frequency</div>
              <div class="section-panel-body">
                <div class="frequency-chart">
                  <div class="freq-row" v-for="tool in sortedTools" :key="tool.name">
                    <span class="freq-label">{{ tool.name }}</span>
                    <div class="freq-bar-track">
                      <div class="freq-bar" :style="{ width: (tool.callCount / maxInvocations * 100) + '%' }" />
                    </div>
                    <span class="freq-count">{{ tool.callCount }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Activity Heatmap -->
          <div class="section-panel mb-4">
            <div class="section-panel-header">Activity Heatmap</div>
            <div class="section-panel-body">
              <div class="heatmap">
                <div class="heatmap-row" v-for="(row, dayIdx) in heatmapData" :key="dayIdx">
                  <span class="heatmap-label">{{ dayLabels[dayIdx] }}</span>
                  <div
                    class="heatmap-cell"
                    v-for="(val, hourIdx) in row"
                    :key="hourIdx"
                    :style="{ backgroundColor: getHeatmapColor(val) }"
                    :title="`${dayLabels[dayIdx]} ${hourIdx}:00 — ${val} calls`"
                  />
                </div>
                <div class="heatmap-legend">
                  <span>Less</span>
                  <div
                    class="heatmap-cell"
                    v-for="level in 5"
                    :key="level"
                    :style="{ backgroundColor: getHeatmapColor(level * 2) }"
                  />
                  <span>More</span>
                </div>
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

/* ── Legend ─────────────────────────────────────────────────── */
.legend {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 0.75rem;
  color: #a1a1aa;
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 5px;
}

.chart-svg {
  width: 100%;
  height: auto;
  display: block;
}

/* ── Heatmap ───────────────────────────────────────────────── */
.heatmap {
  overflow-x: auto;
}

.heatmap-row {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 2px;
}

.heatmap-label {
  width: 36px;
  flex-shrink: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  text-align: right;
  padding-right: 6px;
  font-weight: 500;
}

.heatmap-cell {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  flex-shrink: 0;
  transition: outline 0.1s ease;
}

.heatmap-cell:hover {
  outline: 1px solid var(--accent-fg);
  outline-offset: -1px;
}

.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  padding-left: 36px;
}

.heatmap-legend .heatmap-cell {
  width: 14px;
  height: 14px;
  cursor: default;
}

.heatmap-legend .heatmap-cell:hover {
  outline: none;
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
  background: linear-gradient(90deg, #6366f1, #818cf8);
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
