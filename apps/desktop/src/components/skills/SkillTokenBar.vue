<script setup lang="ts">
import { computed } from "vue";
import { formatCompactNumber } from "@/utils/numberFormatting";

const props = defineProps<{
  tokens: number;
  maxTokens?: number;
}>();

const budget = computed(() => props.maxTokens ?? 30_000);
const pct = computed(() => Math.min(100, (props.tokens / budget.value) * 100));

const barClass = computed(() => {
  if (pct.value >= 90) return "danger";
  if (pct.value >= 70) return "warning";
  return "ok";
});

function formatTokens(n: number): string {
  return formatCompactNumber(n);
}
</script>

<template>
  <div class="token-bar">
    <div class="token-bar__header">
      <span class="token-bar__label">{{ formatTokens(tokens) }} tokens</span>
      <span class="token-bar__pct">{{ pct.toFixed(0) }}%</span>
    </div>
    <div class="token-bar__track">
      <div
        class="token-bar__fill"
        :class="barClass"
        :style="{ width: pct + '%' }"
      />
    </div>
  </div>
</template>

<style scoped>
.token-bar {
  width: 100%;
}

.token-bar__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.token-bar__label {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.token-bar__pct {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.token-bar__track {
  height: 6px;
  background: var(--canvas-inset);
  border-radius: 3px;
  overflow: hidden;
}

.token-bar__fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.token-bar__fill.ok {
  background: var(--success-fg);
}

.token-bar__fill.warning {
  background: var(--warning-fg);
}

.token-bar__fill.danger {
  background: var(--danger-fg);
}
</style>
