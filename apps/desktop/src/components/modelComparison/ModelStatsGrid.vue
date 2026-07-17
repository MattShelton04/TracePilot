<script setup lang="ts">
import { formatAiCredits, formatNumber, formatPercent } from "@tracepilot/types";
import { StatCard } from "@tracepilot/ui";
import { useModelComparisonContext } from "@/composables/useModelComparison";

const ctx = useModelComparisonContext();
</script>

<template>
  <!-- Stat Cards -->
  <div class="grid-4 mb-4">
    <StatCard :value="ctx.modelCount" label="Models Used" />
    <StatCard :value="formatNumber(ctx.totalTokens)" label="Total Tokens" color="done" />
    <StatCard :value="formatAiCredits(ctx.totalAiCredits)" label="AI Credits" color="success" />
    <StatCard
      :value="ctx.data?.sessionsWithObservedAiCredits ?? 0"
      label="Sessions with Observed AIC"
      color="done"
    />
  </div>

  <!-- Model Cards Row -->
  <div class="model-cards-row mb-4">
    <div v-for="row in ctx.modelRows" :key="row.model" class="model-card">
      <div class="model-card-name">
        <span class="model-dot" :style="{ '--model-color': row.color }" />
        <span class="model-card-name-text" :title="row.model">{{ row.model }}</span>
      </div>
      <div class="model-card-stats">
        <div>
          <div class="model-card-stat-label">Tokens</div>
          <div class="model-card-stat-value">{{ formatNumber(row.tokens) }}</div>
        </div>
        <div>
          <div class="model-card-stat-label">AI Credits</div>
          <div class="model-card-stat-value">{{ formatAiCredits(row.aiCredits) }}</div>
        </div>
        <div>
          <div class="model-card-stat-label">Cache Hit</div>
          <div class="model-card-stat-value">{{ formatPercent(row.cacheHitRate) }}</div>
        </div>
        <div>
          <div class="model-card-stat-label">AIC Source</div>
          <div class="model-card-stat-value">{{ row.aiCreditSource === 'observed' ? 'Observed' : 'Estimated' }}</div>
        </div>
      </div>
      <!-- Token share bar -->
      <div class="token-share-bar">
        <div
          class="token-share-fill"
          :style="{ '--fill-width': `${row.percentage}%`, '--model-color': row.color }"
        />
      </div>
      <div class="token-share-label">{{ formatPercent(row.percentage) }} of total tokens</div>
    </div>
  </div>
</template>
