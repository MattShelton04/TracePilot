<script setup lang="ts">
import type { AnalyticsData } from "@tracepilot/types";
import { formatNumber, SectionPanel } from "@tracepilot/ui";
import { formatPercent } from "@/utils/percentageFormatting";

defineProps<{
  data: AnalyticsData;
}>();
</script>

<template>
  <div class="grid-2 mb-4" v-if="data.cacheStats">
    <!-- Cache Efficiency -->
    <SectionPanel v-if="data.cacheStats" title="Cache Efficiency">
      <div class="cache-hit-rate" :title="`${formatPercent(data.cacheStats.cacheHitRate)} of input tokens were served from the prompt cache`">
        <div class="cache-hit-rate-label">
          <span>Cache Hit Rate</span>
          <strong>{{ formatPercent(data.cacheStats.cacheHitRate) }}</strong>
        </div>
        <div class="cache-progress-track">
          <div
            class="cache-progress-fill"
            :style="{ width: `${Math.min(data.cacheStats.cacheHitRate, 100)}%` }"
            :class="{
              'cache-progress-fill--high': data.cacheStats.cacheHitRate >= 50,
              'cache-progress-fill--mid': data.cacheStats.cacheHitRate >= 20 && data.cacheStats.cacheHitRate < 50,
              'cache-progress-fill--low': data.cacheStats.cacheHitRate < 20,
            }"
          />
        </div>
      </div>
      <div class="metric-grid mt-3">
        <div class="metric-item">
          <span class="metric-value accent">{{ formatNumber(data.cacheStats.totalCacheReadTokens) }}</span>
          <span class="metric-label">Cached Tokens</span>
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ formatNumber(data.cacheStats.nonCachedInputTokens) }}</span>
          <span class="metric-label">Fresh Input Tokens</span>
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ formatNumber(data.cacheStats.totalInputTokens) }}</span>
          <span class="metric-label">Total Input Tokens</span>
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.cache-hit-rate {
  padding: 18px 18px 0;
}

.cache-hit-rate-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.cache-hit-rate-label strong {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.cache-progress-track {
  height: 8px;
  border-radius: 4px;
  background: var(--border-subtle);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
  overflow: hidden;
}

.cache-progress-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}

.cache-progress-fill--high  { background: linear-gradient(90deg, var(--chart-success), var(--chart-success-light)); }
.cache-progress-fill--mid   { background: linear-gradient(90deg, var(--chart-warning), var(--chart-warning-light)); }
.cache-progress-fill--low   { background: linear-gradient(90deg, var(--chart-danger), var(--chart-danger-light)); }

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  padding: 18px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.metric-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.metric-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-align: center;
}

.mt-3 {
  margin-top: 0;
}

</style>
