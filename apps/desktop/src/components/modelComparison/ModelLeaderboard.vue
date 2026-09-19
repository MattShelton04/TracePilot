<script setup lang="ts">
import { formatAiCredits, formatPercent } from "@tracepilot/types";
import { type SortKey, useModelComparisonContext } from "@/composables/useModelComparison";
import { formatIdle } from "@/utils/promptCache";

const ctx = useModelComparisonContext();
const sortColumns: { key: SortKey; label: string }[] = [
  { key: "model", label: "Model" },
  { key: "tokens", label: "Total" },
  { key: "inputTokens", label: "Input" },
  { key: "outputTokens", label: "Output" },
  { key: "cacheReadTokens", label: "Cache" },
  { key: "percentage", label: "Share" },
  { key: "aiCredits", label: "AI Credits" },
];
</script>

<template>
  <div class="section-panel mb-4">
    <div class="section-panel-header panel-header-flex">
      <span>Performance Matrix</span>
      <div class="matrix-toggles">
        <div class="norm-toggle" role="group" aria-label="Matrix normalization">
          <button
            :class="['toggle-btn', { active: ctx.normMode === 'raw' }]"
            :aria-pressed="ctx.normMode === 'raw'"
            @click="ctx.normMode = 'raw'"
          >
            Raw
          </button>
          <button
            :class="['toggle-btn', { active: ctx.normMode === 'per-10m-tokens' }]"
            :aria-pressed="ctx.normMode === 'per-10m-tokens'"
            @click="ctx.normMode = 'per-10m-tokens'"
          >
            Per 10M Tokens
          </button>
          <button
            :class="['toggle-btn', { active: ctx.normMode === 'share' }]"
            :aria-pressed="ctx.normMode === 'share'"
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
          <col v-if="ctx.showCacheTtl" class="col-ttl" />
          <col class="col-share" />
          <col class="col-cost" />
        </colgroup>
        <thead>
          <tr>
            <template v-for="column in sortColumns" :key="column.key">
              <th
                class="sort-header"
                scope="col"
                :aria-sort="ctx.sortKey === column.key ? (ctx.sortDir === 'asc' ? 'ascending' : 'descending') : undefined"
              >
                <button
                  type="button"
                  class="matrix-sort-button"
                  :aria-label="`Sort by ${column.label}`"
                  @click="ctx.toggleSort(column.key)"
                >
                  {{ column.label }} <span class="sort-arrow" aria-hidden="true">{{ ctx.sortArrow(column.key) }}</span>
                </button>
              </th>
              <th
                v-if="column.key === 'cacheReadTokens' && ctx.showCacheTtl"
                scope="col"
                class="num-cell"
                title="Prompt-cache TTL most often reported by Copilot CLI for this model"
              >
                Cache TTL
              </th>
            </template>
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
            <td v-if="ctx.showCacheTtl" class="num-cell">{{ ctx.cacheTtlByModel.has(row.model) ? formatIdle(ctx.cacheTtlByModel.get(row.model)) : '—' }}</td>
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
                {{ ctx.normMode === 'raw' ? formatAiCredits(row.aiCredits) : ctx.fmtNorm(row.aiCredits) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
