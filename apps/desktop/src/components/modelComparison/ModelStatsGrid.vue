<script setup lang="ts">
import {
  formatAiCredits,
  formatCost,
  formatNumber,
  formatPercent,
  sourceLabel,
} from "@tracepilot/types";
import { StatCard } from "@tracepilot/ui";
import { computed } from "vue";
import { formatRowCost, rowCostSource } from "@/composables/modelComparison/metrics";
import { useModelComparisonContext } from "@/composables/useModelComparison";

const ctx = useModelComparisonContext();

/** False only when every model is priced in USD (one non-AIC source). */
const showAiCredits = computed(
  () => ctx.modelRows.length === 0 || ctx.usdRows.length < ctx.modelRows.length,
);
const pricedUsdModels = computed(() => ctx.usdRows.filter((row) => row.costUsd != null).length);
</script>

<template>
  <!-- Stat Cards -->
  <div class="grid-4 mb-4">
    <StatCard :value="ctx.modelCount" label="Models Used" />
    <StatCard :value="formatNumber(ctx.totalTokens)" label="Total Tokens" color="done" />
    <StatCard
      v-if="showAiCredits"
      :value="formatAiCredits(ctx.totalAiCredits)"
      label="AI Credits"
      color="success"
    />
    <StatCard
      v-if="ctx.usdSource"
      :value="ctx.totalCostUsd == null ? '—' : formatCost(ctx.totalCostUsd)"
      :label="`${sourceLabel(ctx.usdSource)} Est. Cost`"
      color="success"
      tooltip="API-equivalent USD estimate for models not billed in AI Credits. Not a bill."
    />
    <StatCard
      v-if="!showAiCredits"
      :value="`${pricedUsdModels} of ${ctx.usdRows.length}`"
      label="Priced Models"
      color="done"
    />
    <StatCard
      v-else-if="!ctx.usdSource"
      :value="ctx.data?.sessionsWithObservedAiCredits ?? 0"
      label="Sessions with Observed AIC"
      color="done"
    />
  </div>

  <!-- Model Cards Row -->
  <div class="model-cards-row mb-4">
    <div v-for="row in ctx.modelRows" :key="row.id" class="model-card">
      <div class="model-card-name">
        <span class="model-dot" :style="{ '--model-color': row.color }" />
        <span class="model-card-name-text" :title="row.model">{{ row.label }}</span>
      </div>
      <div class="model-card-stats">
        <div>
          <div class="model-card-stat-label">Tokens</div>
          <div class="model-card-stat-value">{{ formatNumber(row.tokens) }}</div>
        </div>
        <div>
          <div class="model-card-stat-label">{{ row.billedInAiCredits ? 'AI Credits' : 'Est. Cost' }}</div>
          <div class="model-card-stat-value">{{ formatRowCost(row) }}</div>
        </div>
        <div>
          <div class="model-card-stat-label">Cache Hit</div>
          <div class="model-card-stat-value">{{ formatPercent(row.cacheHitRate) }}</div>
        </div>
        <div>
          <div class="model-card-stat-label">{{ row.billedInAiCredits ? 'AIC Source' : 'Cost Source' }}</div>
          <div class="model-card-stat-value">{{ rowCostSource(row) }}</div>
        </div>
      </div>
      <!-- Token share bar -->
      <div class="token-share-bar">
        <div
          class="token-share-fill"
          data-reveal="grow-x"
          :style="{ '--fill-width': `${row.percentage}%`, '--model-color': row.color }"
        />
      </div>
      <div class="token-share-label">{{ formatPercent(row.percentage) }} of total tokens</div>
    </div>
  </div>
</template>
