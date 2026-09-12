<script setup lang="ts">
import { formatNumber, SectionPanel, Tooltip } from "@tracepilot/ui";
import { Info } from "lucide-vue-next";
import { computed } from "vue";
import type { MetricsTokenBreakdown } from "@/utils/metricsTokenBreakdown";

const props = withDefaults(defineProps<{ breakdown: MetricsTokenBreakdown; scope?: string }>(), {
  scope: "All models",
});
const parts = computed(() => [
  { label: "Read from cache", value: props.breakdown.cacheRead, color: "var(--success-fg)" },
  {
    label: "Not served from cache",
    value: props.breakdown.notCached,
    color: "var(--text-secondary)",
  },
]);
const cachePercent = computed(() => (props.breakdown.cacheRatio ?? 0) * 100);
const format = (value: number | null) => (value == null ? "—" : formatNumber(value));
</script>

<template>
  <SectionPanel title="Cache Breakdown" class="mb-6" data-testid="cache-breakdown">
    <template #actions>
      <span class="text-xs text-[var(--text-tertiary)]">{{ scope }}</span>
      <Tooltip text="The percentage of input tokens served from the prompt cache, weighted by token count. The remainder was not served from cache. This measures reuse, not a percentage of money or time saved."><button type="button" aria-label="About cache metrics" class="text-[var(--text-tertiary)]"><Info :size="14" /></button></Tooltip>
    </template>
    <div class="cache-section">
      <div class="cache-gauge" :role="breakdown.cacheRatio != null ? 'meter' : undefined" aria-label="Input served from cache" :aria-valuenow="breakdown.cacheRatio != null ? cachePercent : undefined" :aria-valuemin="0" :aria-valuemax="100">
        <strong>{{ breakdown.cacheRatio != null ? `${cachePercent.toFixed(1)}%` : '—' }}</strong>
        <span>cache read</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="grid grid-cols-2 gap-4">
          <div v-for="part in parts" :key="part.label">
            <div class="text-xs text-[var(--text-tertiary)]">{{ part.label }}</div>
            <div class="text-lg font-semibold" :style="{ color: part.color }">{{ format(part.value) }}</div>
          </div>
        </div>
        <div v-if="breakdown.cacheRatio != null" class="cache-track mt-4" aria-hidden="true">
          <div :style="{ width: `${cachePercent}%` }" />
        </div>
        <div class="text-xs text-[var(--text-tertiary)] mt-2">{{ format(breakdown.input) }} input tokens</div>
      </div>
    </div>
    <p v-if="breakdown.inconsistent" class="text-xs text-[var(--attention-fg)] mt-3">Recorded categories do not reconcile.</p>
  </SectionPanel>
</template>

<style scoped>
.cache-section { display: flex; align-items: center; gap: 24px; }
.cache-gauge {
  width: 104px; height: 104px; flex-shrink: 0; border-radius: 50%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(circle at center, var(--canvas-overlay) 0 62%, transparent 63%),
    conic-gradient(var(--success-fg) 0 calc(v-bind(cachePercent) * 1%), var(--canvas-inset) 0 100%);
  font-variant-numeric: tabular-nums;
}
.cache-gauge strong { font-size: 1.25rem; color: var(--text-primary); }
.cache-gauge span { font-size: 0.6875rem; color: var(--text-tertiary); }
.cache-track { height: 8px; border-radius: 4px; overflow: hidden; background: var(--neutral-muted); }
.cache-track div { height: 100%; background: var(--success-fg); }
@media (max-width: 480px) {
  .cache-section { flex-direction: column; align-items: stretch; gap: 16px; }
  .cache-gauge { align-self: center; }
}
</style>