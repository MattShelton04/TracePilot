<script setup lang="ts">
import type { AnalyticsData } from "@tracepilot/types";
import { formatDuration, formatNumber, formatNumberFull, SectionPanel } from "@tracepilot/ui";

defineProps<{
  data: AnalyticsData;
}>();
</script>

<template>
  <div class="grid-2 mb-4" v-if="data.apiDurationStats || data.productivityMetrics">
    <SectionPanel v-if="data.apiDurationStats" title="API Duration">
      <div class="metric-grid">
        <div class="metric-item">
          <span class="metric-value">{{ formatDuration(data.apiDurationStats.avgMs) }}</span>
          <span class="metric-label">Average</span>
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ formatDuration(data.apiDurationStats.medianMs) }}</span>
          <span class="metric-label">Median</span>
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ formatDuration(data.apiDurationStats.p95Ms) }}</span>
          <span class="metric-label">P95</span>
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ formatDuration(data.apiDurationStats.minMs) }}</span>
          <span class="metric-label">Min</span>
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ formatDuration(data.apiDurationStats.maxMs) }}</span>
          <span class="metric-label">Max</span>
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ formatNumberFull(data.apiDurationStats.totalSessionsWithDuration) }}</span>
          <span class="metric-label">Sessions w/ Data</span>
        </div>
      </div>
    </SectionPanel>
    <SectionPanel v-if="data.productivityMetrics" title="Productivity Metrics">
      <div class="metric-grid">
        <div class="metric-item">
          <span class="metric-value">{{ data.productivityMetrics.avgTurnsPerSession.toFixed(1) }}</span>
          <span class="metric-label">Avg Turns / Session</span>
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ data.productivityMetrics.avgToolCallsPerTurn.toFixed(1) }}</span>
          <span class="metric-label">Avg Tool Calls / Turn</span>
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ formatNumber(data.productivityMetrics.avgTokensPerTurn) }}</span>
          <span class="metric-label">Avg Tokens / Turn</span>
        </div>
        <div class="metric-item" :title="'Average tokens processed per second of API wait time — a measure of model throughput across all sessions.'">
          <span class="metric-value">{{ formatNumber(data.productivityMetrics.avgTokensPerApiSecond) }}</span>
          <span class="metric-label">Tokens / API Second</span>
        </div>
        <div class="metric-item" :title="'Average context compactions per session — based on all sessions in the current filter. Higher values indicate sessions hitting context limits frequently.'">
          <span class="metric-value">{{ data.totalSessions > 0 ? (data.totalCompactions / data.totalSessions).toFixed(1) : '0' }}</span>
          <span class="metric-label">Avg Compactions / Session</span>
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
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
</style>
