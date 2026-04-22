<script setup lang="ts">
import { formatNumber, HealthRing, SectionPanel } from "@tracepilot/ui";

defineProps<{
  cacheHitRatio: number;
  totalCacheReadTokens: number;
  totalInputTokens: number;
}>();
</script>

<template>
  <SectionPanel v-if="totalCacheReadTokens > 0" title="Cache Breakdown" class="mb-6">
    <div class="cache-section">
      <HealthRing :score="cacheHitRatio" size="lg" />
      <div class="cache-info">
        <div class="text-sm text-[var(--text-secondary)] mb-3">
          {{ formatNumber(totalCacheReadTokens) }} of {{ formatNumber(totalInputTokens) }} input tokens served from cache
        </div>
        <div class="cache-bar">
          <div class="cache-bar-fill" :style="{ width: `${cacheHitRatio * 100}%` }" />
        </div>
        <div class="cache-bar-legend">
          <span class="legend-cached">{{ (cacheHitRatio * 100).toFixed(1) }}% cached</span>
          <span class="legend-uncached">{{ ((1 - cacheHitRatio) * 100).toFixed(1) }}% uncached</span>
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
