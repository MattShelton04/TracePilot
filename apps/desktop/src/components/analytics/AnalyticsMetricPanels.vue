<script setup lang="ts">
import type { AnalyticsData } from "@tracepilot/types";
import { formatDuration, formatNumber, formatNumberFull, SectionPanel } from "@tracepilot/ui";

defineProps<{
  data: AnalyticsData;
}>();

function formatAverage(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Number(value.toFixed(1));
  return Math.abs(rounded) >= 1_000 ? formatNumber(rounded) : rounded.toFixed(1);
}
</script>

<template>
  <div class="metric-panels grid-2 mb-4" v-if="data.apiDurationStats || data.productivityMetrics">
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
          <span class="metric-value">{{ formatAverage(data.productivityMetrics.avgTurnsPerSession) }}</span>
          <span class="metric-label">Avg Turns / Session</span>
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ formatAverage(data.productivityMetrics.avgToolCallsPerTurn) }}</span>
          <span class="metric-label">Avg Tool Calls / Turn</span>
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ formatAverage(data.productivityMetrics.avgTokensPerTurn) }}</span>
          <span class="metric-label">Avg Tokens / Turn</span>
        </div>
        <div class="metric-item" :title="'Average tokens processed per second of API wait time — a measure of model throughput across all sessions.'">
          <span class="metric-value">{{ formatAverage(data.productivityMetrics.avgTokensPerApiSecond) }}</span>
          <span class="metric-label">Tokens / API Second</span>
        </div>
        <div class="metric-item" :title="'Average context compactions per session — based on all sessions in the current filter. Higher values indicate sessions hitting context limits frequently.'">
          <span class="metric-value">{{ data.totalSessions > 0 ? formatAverage(data.totalCompactions / data.totalSessions) : '0' }}</span>
          <span class="metric-label">Avg Compactions / Session</span>
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.metric-panels > * {
  min-width: 0;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 7rem), 1fr));
  gap: 16px;
  padding: 18px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.metric-value {
  max-width: 100%;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  text-align: center;
  overflow-wrap: anywhere;
}

.metric-label {
  max-width: 100%;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-align: center;
  overflow-wrap: anywhere;
}
</style>
