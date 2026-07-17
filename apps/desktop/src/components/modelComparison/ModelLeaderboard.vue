<script setup lang="ts">
import { formatPercent } from "@tracepilot/types";
import { useModelComparisonContext } from "@/composables/useModelComparison";

const ctx = useModelComparisonContext();
</script>

<template>
  <div class="section-panel mb-4">
    <div class="section-panel-header panel-header-flex">
      <span>Performance Matrix</span>
      <div class="matrix-toggles">
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
    </div>
    <div class="section-panel-body scrollable-section panel-body-flush">
      <table class="data-table matrix-table" aria-label="Model performance comparison matrix">
        <colgroup>
          <col class="col-model" />
          <col class="col-total" />
          <col class="col-input" />
          <col class="col-output" />
          <col class="col-cached" />
          <col class="col-share" />
          <col class="col-cost" />
        </colgroup>
        <thead>
          <tr>
            <th class="sort-header" @click="ctx.toggleSort('model')">
              Model <span class="sort-arrow">{{ ctx.sortArrow('model') }}</span>
            </th>
            <th class="sort-header" @click="ctx.toggleSort('tokens')">
              Total <span class="sort-arrow">{{ ctx.sortArrow('tokens') }}</span>
            </th>
            <th class="sort-header" @click="ctx.toggleSort('inputTokens')">
              Input <span class="sort-arrow">{{ ctx.sortArrow('inputTokens') }}</span>
            </th>
            <th class="sort-header" @click="ctx.toggleSort('outputTokens')">
              Output <span class="sort-arrow">{{ ctx.sortArrow('outputTokens') }}</span>
            </th>
            <th class="sort-header" @click="ctx.toggleSort('cacheReadTokens')">
              Cache <span class="sort-arrow">{{ ctx.sortArrow('cacheReadTokens') }}</span>
            </th>
            <th class="sort-header" @click="ctx.toggleSort('percentage')">
              Share <span class="sort-arrow">{{ ctx.sortArrow('percentage') }}</span>
            </th>
            <th class="sort-header" @click="ctx.toggleSort('aiCredits')">
              AI Credits <span class="sort-arrow">{{ ctx.sortArrow('aiCredits') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ctx.displayRows" :key="row.model">
            <td>
              <span class="model-name-cell">
                <span class="model-dot" :style="{ '--model-color': row.color }" />
                {{ row.model }}
              </span>
            </td>
            <td class="num-cell">{{ ctx.fmtNorm(row.tokens) }}</td>
            <td class="num-cell">{{ ctx.fmtNorm(row.inputTokens) }}</td>
            <td class="num-cell">{{ ctx.fmtNorm(row.outputTokens) }}</td>
            <td class="num-cell">{{ ctx.fmtNorm(row.cacheReadTokens) }} ({{ formatPercent(row.cacheHitRate) }})</td>
            <td class="num-cell">
              <div class="inline-progress">
                <span>{{ formatPercent(row.percentage) }}</span>
                <div class="inline-progress-bar">
                  <div
                    class="inline-progress-fill"
                    :style="{ '--fill-width': `${row.percentage}%`, '--model-color': row.color }"
                  />
                </div>
              </div>
            </td>
            <td class="num-cell matrix-cost-cell">
              <span class="matrix-cost-value">
                {{ ctx.normMode === 'raw' ? `${row.aiCredits?.toFixed(3) ?? '—'} AIC` : ctx.fmtNorm(row.aiCredits) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
