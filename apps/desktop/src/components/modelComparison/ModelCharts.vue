<script setup lang="ts">
import { formatCost, formatNumber, formatPercent } from "@tracepilot/ui";
import {
  RADAR_AXES,
  RADAR_CX,
  RADAR_CY,
  SCATTER_H,
  SCATTER_PAD,
  SCATTER_W,
  useModelComparisonContext,
} from "@/composables/useModelComparison";

const ctx = useModelComparisonContext();
</script>

<template>
  <div class="grid-2 mb-4">
    <!-- Radar Chart -->
    <div class="section-panel">
      <div class="section-panel-header">Capability Radar (Top 3)</div>
      <div class="section-panel-body">
        <div v-if="ctx.radarModels.length < 2" class="chart-placeholder">
          Need at least 2 models for radar comparison.
        </div>
        <template v-else>
          <div class="legend">
            <span v-for="rm in ctx.radarModels" :key="rm.model">
              <span class="legend-dot" :style="{ '--model-color': rm.color }" />&nbsp;{{ rm.model }}
            </span>
          </div>
          <svg
            class="chart-svg"
            :viewBox="`0 0 300 260`"
            role="img"
            aria-label="Radar chart comparing model capabilities"
          >
            <!-- Grid rings -->
            <polygon
              v-for="ring in [0.25, 0.5, 0.75, 1]"
              :key="`ring-${ring}`"
              :points="Array.from({ length: 5 }, (_, i) => { const p = ctx.radarPoint(i, ring); return `${p.x},${p.y}`; }).join(' ')"
              fill="none"
              stroke="var(--border-default)"
              stroke-width="0.5"
              opacity="0.5"
            />
            <!-- Axis lines -->
            <line
              v-for="(_, ai) in RADAR_AXES"
              :key="`axis-${ai}`"
              :x1="RADAR_CX"
              :y1="RADAR_CY"
              :x2="ctx.radarAxisEnd(ai).x"
              :y2="ctx.radarAxisEnd(ai).y"
              stroke="var(--border-default)"
              stroke-width="0.5"
              opacity="0.5"
            />
            <!-- Axis labels -->
            <text
              v-for="(label, ai) in RADAR_AXES"
              :key="`label-${ai}`"
              :x="ctx.radarLabelPos(ai).x"
              :y="ctx.radarLabelPos(ai).y"
              :text-anchor="ctx.radarLabelPos(ai).anchor"
              font-size="9"
              fill="var(--text-tertiary)"
              font-family="Inter, sans-serif"
            >{{ label }}</text>
            <!-- Model polygons -->
            <polygon
              v-for="rm in ctx.radarModels"
              :key="`poly-${rm.model}`"
              :points="ctx.radarPolygon(ctx.radarValues(rm))"
              :fill="rm.color"
              fill-opacity="0.12"
              :stroke="rm.color"
              stroke-width="1.5"
            />
            <!-- Model dots -->
            <template v-for="rm in ctx.radarModels" :key="`dots-${rm.model}`">
              <circle
                v-for="(v, vi) in ctx.radarValues(rm)"
                :key="`dot-${rm.model}-${vi}`"
                :cx="ctx.radarPoint(vi, v).x"
                :cy="ctx.radarPoint(vi, v).y"
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
        <div
          v-if="ctx.modelRows.length < 2 || ctx.modelRows.every(m => m.cost == null)"
          class="chart-placeholder"
        >
          Need at least 2 models with cost data for scatter plot.
        </div>
        <template v-else>
          <div class="legend">
            <span v-for="row in ctx.modelRows" :key="row.model">
              <span class="legend-dot" :style="{ '--model-color': row.color }" />&nbsp;{{ row.model }}
            </span>
          </div>
          <svg
            class="chart-svg"
            :viewBox="`0 0 ${SCATTER_W} ${SCATTER_H}`"
            role="img"
            aria-label="Scatter plot of cost vs token volume"
          >
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
            <line
              :x1="SCATTER_PAD.left"
              :y1="SCATTER_H - SCATTER_PAD.bottom"
              :x2="SCATTER_W - SCATTER_PAD.right"
              :y2="SCATTER_H - SCATTER_PAD.bottom"
              stroke="var(--border-default)"
              stroke-width="1"
            />
            <line
              :x1="SCATTER_PAD.left"
              :y1="SCATTER_PAD.top"
              :x2="SCATTER_PAD.left"
              :y2="SCATTER_H - SCATTER_PAD.bottom"
              stroke="var(--border-default)"
              stroke-width="1"
            />
            <!-- X-axis label -->
            <text
              :x="(SCATTER_PAD.left + SCATTER_W - SCATTER_PAD.right) / 2"
              :y="SCATTER_H - 6"
              text-anchor="middle"
              font-size="10"
              fill="var(--text-tertiary)"
              font-family="Inter, sans-serif"
            >Total Tokens</text>
            <!-- Y-axis label -->
            <text
              :x="14"
              :y="(SCATTER_PAD.top + SCATTER_H - SCATTER_PAD.bottom) / 2"
              text-anchor="middle"
              font-size="10"
              fill="var(--text-tertiary)"
              font-family="Inter, sans-serif"
              transform="rotate(-90, 14, 135)"
            >Wholesale Cost ($)</text>
            <!-- Scale labels -->
            <text
              :x="SCATTER_PAD.left - 8"
              :y="SCATTER_H - SCATTER_PAD.bottom + 4"
              text-anchor="end"
              font-size="8"
              fill="var(--text-tertiary)"
              font-family="Inter, sans-serif"
            >$0</text>
            <text
              :x="SCATTER_PAD.left - 8"
              :y="SCATTER_PAD.top + 4"
              text-anchor="end"
              font-size="8"
              fill="var(--text-tertiary)"
              font-family="Inter, sans-serif"
            >{{ formatCost(ctx.scatterScale.maxC) }}</text>
            <text
              :x="SCATTER_PAD.left"
              :y="SCATTER_H - SCATTER_PAD.bottom + 16"
              text-anchor="start"
              font-size="8"
              fill="var(--text-tertiary)"
              font-family="Inter, sans-serif"
            >0</text>
            <text
              :x="SCATTER_W - SCATTER_PAD.right"
              :y="SCATTER_H - SCATTER_PAD.bottom + 16"
              text-anchor="end"
              font-size="8"
              fill="var(--text-tertiary)"
              font-family="Inter, sans-serif"
            >{{ formatNumber(ctx.scatterScale.maxT) }}</text>
            <!-- Data points -->
            <g v-for="row in ctx.modelRows" :key="`scatter-${row.model}`">
              <circle
                :cx="ctx.scatterX(row.tokens)"
                :cy="ctx.scatterY(row.cost ?? 0)"
                :r="ctx.scatterRadius(row.cacheHitRate)"
                :fill="row.color"
                fill-opacity="0.6"
                :stroke="row.color"
                stroke-width="1.5"
              >
                <title>{{ row.model }}: {{ formatNumber(row.tokens) }} tokens, {{ formatCost(row.cost) }}, {{ formatPercent(row.cacheHitRate) }} cache</title>
              </circle>
              <text
                :x="ctx.scatterX(row.tokens)"
                :y="ctx.scatterY(row.cost ?? 0) - ctx.scatterRadius(row.cacheHitRate) - 4"
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
</template>
