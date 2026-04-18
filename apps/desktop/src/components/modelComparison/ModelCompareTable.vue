<script setup lang="ts">
import { useModelComparisonContext } from "@/composables/useModelComparison";

const ctx = useModelComparisonContext();
</script>

<template>
  <div class="section-panel mb-4">
    <div class="section-panel-header panel-header-flex">
      <span>Side-by-Side Comparison</span>
      <div class="norm-toggle">
        <button
          :class="['toggle-btn', { active: ctx.normMode === 'raw' }]"
          @click="ctx.normMode = 'raw'"
        >
          Raw
        </button>
        <button
          :class="['toggle-btn', { active: ctx.normMode === 'per-10m-tokens' }]"
          @click="ctx.normMode = 'per-10m-tokens'"
        >
          Per 10M Tokens
        </button>
        <button
          :class="['toggle-btn', { active: ctx.normMode === 'share' }]"
          @click="ctx.normMode = 'share'"
        >
          Share %
        </button>
      </div>
    </div>
    <div class="section-panel-body">
      <div v-if="ctx.modelRows.length < 2" class="chart-placeholder">
        Need at least 2 models for side-by-side comparison.
      </div>
      <template v-else>
        <div class="compare-selectors">
          <select v-model="ctx.compareA" class="filter-select" aria-label="Select first model">
            <option v-for="row in ctx.modelRows" :key="row.model" :value="row.model">
              {{ row.model }}
            </option>
          </select>
          <span class="compare-vs">vs</span>
          <select v-model="ctx.compareB" class="filter-select" aria-label="Select second model">
            <option v-for="row in ctx.modelRows" :key="row.model" :value="row.model">
              {{ row.model }}
            </option>
          </select>
        </div>
        <table class="data-table compare-table" aria-label="Side-by-side model comparison">
          <colgroup>
            <col class="col-quarter" />
            <col class="col-quarter" />
            <col class="col-quarter" />
            <col class="col-quarter" />
          </colgroup>
          <thead>
            <tr>
              <th>Metric</th>
              <th>
                <span class="model-name-cell">
                  <span class="model-dot" :style="{ background: ctx.compareRowA?.color }" />
                  {{ ctx.compareA }}
                </span>
              </th>
              <th>Delta</th>
              <th>
                <span class="model-name-cell">
                  <span class="model-dot" :style="{ background: ctx.compareRowB?.color }" />
                  {{ ctx.compareB }}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="metric in ctx.compareMetrics" :key="metric.label">
              <td class="metric-label">{{ metric.label }}</td>
              <td class="num-cell" :class="{ 'compare-better': metric.better === 'a' }">
                {{ metric.valueA }}
              </td>
              <td class="num-cell delta-cell">
                <span :class="`delta-${metric.direction}`">
                  {{ metric.direction === 'up' ? '↑' : metric.direction === 'down' ? '↓' : '' }}
                  {{ metric.delta }}
                </span>
              </td>
              <td class="num-cell" :class="{ 'compare-better': metric.better === 'b' }">
                {{ metric.valueB }}
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
  </div>
</template>
