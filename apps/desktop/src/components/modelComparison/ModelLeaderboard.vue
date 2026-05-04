<script setup lang="ts">
import { formatPercent } from "@tracepilot/ui";
import { useModelComparisonContext } from "@/composables/useModelComparison";

const ctx = useModelComparisonContext();
</script>

<template>
  <div class="section-panel mb-4">
    <div class="section-panel-header panel-header-flex">
      <span>Performance Matrix</span>
      <div class="matrix-toggles">
        <div class="cost-toggle">
          <button
            :class="['toggle-btn', { active: ctx.costMode === 'wholesale' }]"
           @click="ctx.costMode = 'wholesale'"
          >
            Direct API
          </button>
          <button
            :class="['toggle-btn', { active: ctx.costMode === 'copilot' }]"
            @click="ctx.costMode = 'copilot'"
          >
            Legacy Copilot
          </button>
          <button
            :class="['toggle-btn', { active: ctx.costMode === 'both' }]"
            @click="ctx.costMode = 'both'"
          >
            Both
          </button>
        </div>
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
          <col v-if="ctx.costMode !== 'copilot'" class="col-cost" />
          <col v-if="ctx.costMode !== 'wholesale'" class="col-cost" />
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
            <th
              v-if="ctx.costMode !== 'copilot'"
              class="sort-header"
              @click="ctx.toggleSort('cost')"
            >
              API $ <span class="sort-arrow">{{ ctx.sortArrow('cost') }}</span>
            </th>
            <th
              v-if="ctx.costMode !== 'wholesale'"
              class="sort-header"
              @click="ctx.toggleSort('copilotCost')"
            >
              Copilot $ <span class="sort-arrow">{{ ctx.sortArrow('copilotCost') }}</span>
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
            <td v-if="ctx.costMode !== 'copilot'" class="num-cell">
              <span :class="{ 'best-cell': row.model === ctx.modelRows[ctx.bestCostIdx]?.model }">
                {{ ctx.fmtNorm(row.cost, true) }}
              </span>
            </td>
            <td v-if="ctx.costMode !== 'wholesale'" class="num-cell">
              <span
                :class="{
                  'best-cell': row.model === ctx.modelRows[ctx.bestCopilotCostIdx]?.model,
                }"
              >
                {{ ctx.fmtNorm(row.copilotCost, true) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
