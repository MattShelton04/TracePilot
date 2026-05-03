<script setup lang="ts">
import { formatNumber, SectionPanel } from "@tracepilot/ui";
import { computed } from "vue";
import { formatPercent } from "@/utils/percentageFormatting";

const props = defineProps<{
  cacheHitRatio: number;
  totalCacheReadTokens: number;
  totalInputTokens: number;
}>();

const cachePercent = computed(() => Math.round(props.cacheHitRatio * 100));
</script>

<template>
  <SectionPanel v-if="totalCacheReadTokens > 0" title="Cache Breakdown" class="mb-6">
    <div class="cache-section">
      <div class="cache-ratio" role="meter" :aria-valuenow="cachePercent" aria-valuemin="0" aria-valuemax="100">
        <strong>{{ cachePercent }}</strong><span>%</span>
      </div>
      <div class="cache-info">
        <div class="text-sm text-[var(--text-secondary)] mb-3">
          {{ formatNumber(totalCacheReadTokens) }} of {{ formatNumber(totalInputTokens) }} input tokens served from cache
        </div>
        <div class="cache-bar">
          <div class="cache-bar-fill" :style="{ width: `${cacheHitRatio * 100}%` }" />
        </div>
        <div class="cache-bar-legend">
          <span class="legend-cached">{{ formatPercent(cacheHitRatio, { isRatio: true }) }} cached</span>
          <span class="legend-uncached">{{ formatPercent(1 - cacheHitRatio, { isRatio: true }) }} uncached</span>
        </div>
      </div>
    </div>
  </SectionPanel>
</template>

<style scoped>
.cache-section {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 12px 0;
}

.cache-info {
  flex: 1;
  max-width: 400px;
}

.cache-ratio {
  width: 112px;
  height: 112px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at center, var(--canvas-overlay) 0 58%, transparent 59%),
    conic-gradient(var(--success-fg) 0 calc(v-bind(cachePercent) * 1%), var(--canvas-inset) 0 100%);
  box-shadow:
    inset 0 0 0 1px var(--border-emphasis, var(--border-default)),
    0 0 0 1px var(--canvas-default);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.cache-ratio strong {
  font-size: 1.5rem;
  line-height: 1;
}

.cache-ratio span {
  margin-left: 2px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.cache-bar {
  height: 6px;
  width: 100%;
  background: var(--neutral-muted);
  border-radius: 3px;
  overflow: hidden;
}

.cache-bar-fill {
  height: 100%;
  background: var(--success-fg);
  border-radius: 3px;
  opacity: 0.8;
  transition: width 0.5s ease;
}

.cache-bar-legend {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 0.6875rem;
}

.legend-cached {
  color: var(--success-fg);
  font-weight: 600;
}

.legend-uncached {
  color: var(--text-placeholder);
}
</style>
