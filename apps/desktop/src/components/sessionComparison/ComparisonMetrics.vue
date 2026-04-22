<script setup lang="ts">
import { EmptyState, formatNumber, SectionPanel } from "@tracepilot/ui";
import { donutSegments, useSessionComparisonContext } from "@/composables/useSessionComparison";

const comp = useSessionComparisonContext();
</script>

<template>
  <!-- ═══════ Metrics Delta Table ═══════ -->
  <SectionPanel title="Metrics Comparison">
    <div class="norm-toggle">
      <button
        :class="['toggle-btn', { active: comp.normMode === 'raw' }]"
        @click="comp.normMode = 'raw'"
      >Raw</button>
      <button
        :class="['toggle-btn', { active: comp.normMode === 'per-turn' }]"
        @click="comp.normMode = 'per-turn'"
      >Per Turn</button>
      <button
        :class="['toggle-btn', { active: comp.normMode === 'per-minute' }]"
        @click="comp.normMode = 'per-minute'"
      >Per Minute</button>
    </div>
    <div class="delta-table-wrap">
      <table class="delta-table" aria-label="Metrics comparison between sessions">
        <thead>
          <tr>
            <th class="col-val-a">Session A</th>
            <th class="col-metric">Metric</th>
            <th class="col-val-b">Session B</th>
            <th class="col-delta">Delta</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in comp.metricsRows" :key="row.label">
            <td class="val-a">{{ row.valueA }}</td>
            <td class="metric-name">{{ row.label }}</td>
            <td class="val-b">{{ row.valueB }}</td>
            <td class="delta-col" :class="row.deltaClass">{{ row.delta }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </SectionPanel>

  <!-- ═══════ Token Usage Comparison ═══════ -->
  <div class="chart-grid-2">
    <div class="chart-box">
      <div class="chart-box-header">Token Usage — Session A</div>
      <div class="chart-box-body chart-body-col">
        <div v-for="bar in comp.tokenBars" :key="'a-' + bar.label" class="bar-row">
          <span class="bar-label">{{ bar.label }}</span>
          <div class="bar-track">
            <div
              :class="['bar-fill', bar.isCacheRow ? 'bar-fill-cache' : 'bar-fill-a']"
              :style="{ width: (bar.valueA / bar.maxVal * 100) + '%' }"
            >
              <span v-if="(bar.valueA / bar.maxVal * 100) >= 15" class="bar-value">{{ formatNumber(bar.valueA) }}</span>
            </div>
            <span v-if="bar.valueA > 0 && (bar.valueA / bar.maxVal * 100) < 15" class="bar-value-outside">{{ formatNumber(bar.valueA) }}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="chart-box">
      <div class="chart-box-header">Token Usage — Session B</div>
      <div class="chart-box-body chart-body-col">
        <div v-for="bar in comp.tokenBars" :key="'b-' + bar.label" class="bar-row">
          <span class="bar-label">{{ bar.label }}</span>
          <div class="bar-track">
            <div
              :class="['bar-fill', bar.isCacheRow ? 'bar-fill-cache' : 'bar-fill-b']"
              :style="{ width: (bar.valueB / bar.maxVal * 100) + '%' }"
            >
              <span v-if="(bar.valueB / bar.maxVal * 100) >= 15" class="bar-value">{{ formatNumber(bar.valueB) }}</span>
            </div>
            <span v-if="bar.valueB > 0 && (bar.valueB / bar.maxVal * 100) < 15" class="bar-value-outside">{{ formatNumber(bar.valueB) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ═══════ Model Distribution Donuts ═══════ -->
  <div class="chart-grid-2">
    <div class="chart-box">
      <div class="chart-box-header">Model Distribution — Session A</div>
      <div class="chart-box-body chart-body-center">
        <EmptyState v-if="comp.donutA.length === 0" compact message="No model data" />
        <div v-else class="donut-wrap">
          <svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="Donut chart showing model distribution for session A">
            <circle cx="80" cy="80" r="60" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="20" />
            <circle
              v-for="(seg, i) in donutSegments(comp.donutA)"
              :key="'da-' + i"
              cx="80" cy="80" r="60" fill="none"
              :stroke="seg.color"
              stroke-width="20"
              :stroke-dasharray="`${seg.length} ${2 * Math.PI * 60 - seg.length}`"
              :stroke-dashoffset="`${-(seg.offset - 2 * Math.PI * 60 * 0.25)}`"
            />
            <text v-if="comp.donutA[0]" x="80" y="76" text-anchor="middle" fill="var(--text-primary)" font-size="18" font-weight="700">{{ Math.round(comp.donutA[0].percentage * 100) }}%</text>
            <text v-if="comp.donutA[0]" x="80" y="94" text-anchor="middle" fill="var(--text-tertiary)" font-size="10">{{ comp.donutA[0].model.split('/').pop() }}</text>
          </svg>
          <div class="donut-legend">
            <div v-for="seg in comp.donutA" :key="seg.model" class="donut-legend-item">
              <div class="donut-swatch" :style="{ '--swatch-color': seg.color }"></div>
              <span>{{ seg.model }} ({{ Math.round(seg.percentage * 100) }}%)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="chart-box">
      <div class="chart-box-header">Model Distribution — Session B</div>
      <div class="chart-box-body chart-body-center">
        <EmptyState v-if="comp.donutB.length === 0" compact message="No model data" />
        <div v-else class="donut-wrap">
          <svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="Donut chart showing model distribution for session B">
            <circle cx="80" cy="80" r="60" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="20" />
            <circle
              v-for="(seg, i) in donutSegments(comp.donutB)"
              :key="'db-' + i"
              cx="80" cy="80" r="60" fill="none"
              :stroke="seg.color"
              stroke-width="20"
              :stroke-dasharray="`${seg.length} ${2 * Math.PI * 60 - seg.length}`"
              :stroke-dashoffset="`${-(seg.offset - 2 * Math.PI * 60 * 0.25)}`"
            />
            <text v-if="comp.donutB[0]" x="80" y="76" text-anchor="middle" fill="var(--text-primary)" font-size="18" font-weight="700">{{ Math.round(comp.donutB[0].percentage * 100) }}%</text>
            <text v-if="comp.donutB[0]" x="80" y="94" text-anchor="middle" fill="var(--text-tertiary)" font-size="10">{{ comp.donutB[0].model.split('/').pop() }}</text>
          </svg>
          <div class="donut-legend">
            <div v-for="seg in comp.donutB" :key="seg.model" class="donut-legend-item">
              <div class="donut-swatch" :style="{ '--swatch-color': seg.color }"></div>
              <span>{{ seg.model }} ({{ Math.round(seg.percentage * 100) }}%)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ═══════ Tool Usage Comparison ═══════ -->
  <SectionPanel title="Tool Usage Comparison">
    <EmptyState v-if="comp.toolCompRows.length === 0" compact message="No tool usage data" />
    <template v-else>
      <div class="tool-legend">
        <div class="tool-legend-item">
          <div class="tool-legend-swatch swatch-a"></div>
          <span>Session A</span>
        </div>
        <div class="tool-legend-item">
          <div class="tool-legend-swatch swatch-b"></div>
          <span>Session B</span>
        </div>
      </div>
      <div v-for="row in comp.toolCompRows" :key="row.tool" class="tool-row">
        <span class="tool-label">{{ row.tool }}</span>
        <div class="tool-bars">
          <div v-if="row.countA > 0" class="tool-bar tool-bar-a" :style="{ width: (row.countA / row.maxCount * 100) + '%' }">{{ row.countA }}</div>
          <div v-if="row.countB > 0" class="tool-bar tool-bar-b" :style="{ width: (row.countB / row.maxCount * 100) + '%' }">{{ row.countB }}</div>
        </div>
      </div>
    </template>
  </SectionPanel>
</template>
