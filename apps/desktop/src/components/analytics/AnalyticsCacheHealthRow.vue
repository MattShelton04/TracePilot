<script setup lang="ts">
import type { AnalyticsData } from "@tracepilot/types";
import { formatNumber, SectionPanel } from "@tracepilot/ui";

defineProps<{
  data: AnalyticsData;
}>();
</script>

<template>
  <div class="grid-2 mb-4" v-if="data.cacheStats || data.healthDistribution">
    <!-- Cache Efficiency -->
    <SectionPanel v-if="data.cacheStats" title="Cache Efficiency">
      <div class="cache-hit-rate" :title="`${data.cacheStats.cacheHitRate.toFixed(1)}% of input tokens were served from the prompt cache`">
        <div class="cache-hit-rate-label">
          <span>Cache Hit Rate</span>
          <strong>{{ data.cacheStats.cacheHitRate.toFixed(1) }}%</strong>
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

    <!-- Session Health Distribution -->
    <SectionPanel v-if="data.healthDistribution" title="Session Health Distribution">
      <div class="health-dist-grid">
        <div class="health-dist-card health-dist-card--healthy" :title="`${data.healthDistribution.healthyCount} sessions with health score ≥ 0.8`">
          <span class="health-dist-count">{{ data.healthDistribution.healthyCount }}</span>
          <span class="health-dist-label">Healthy</span>
          <span class="health-dist-sub">score ≥ 0.8</span>
        </div>
        <div class="health-dist-card health-dist-card--attention" :title="`${data.healthDistribution.attentionCount} sessions with health score between 0.5 and 0.8`">
          <span class="health-dist-count">{{ data.healthDistribution.attentionCount }}</span>
          <span class="health-dist-label">Attention</span>
          <span class="health-dist-sub">0.5 – 0.8</span>
        </div>
        <div class="health-dist-card health-dist-card--critical" :title="`${data.healthDistribution.criticalCount} sessions with health score below 0.5`">
          <span class="health-dist-count">{{ data.healthDistribution.criticalCount }}</span>
          <span class="health-dist-label">Critical</span>
          <span class="health-dist-sub">score &lt; 0.5</span>
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

.health-dist-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 18px;
}

.health-dist-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px 8px;
  border-radius: 10px;
  border: 1px solid transparent;
}

.health-dist-card--healthy {
  background: var(--success-subtle);
  border-color: var(--success-muted);
}

.health-dist-card--attention {
  background: var(--warning-subtle);
  border-color: var(--warning-muted);
}

.health-dist-card--critical {
  background: var(--danger-subtle);
  border-color: var(--danger-muted);
}

.health-dist-count {
  font-size: 1.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.health-dist-card--healthy .health-dist-count  { color: var(--chart-success); }
.health-dist-card--attention .health-dist-count { color: var(--chart-warning); }
.health-dist-card--critical .health-dist-count  { color: var(--chart-danger); }

.health-dist-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.health-dist-sub {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
</style>
