<script setup lang="ts">
import { computed } from "vue";
import { formatCompactNumber } from "@/utils/numberFormatting";

const props = withDefaults(
  defineProps<{
    tokens: number;
    tools?: number;
    servers?: number;
    contextSize?: number;
  }>(),
  {
    tools: 0,
    servers: 0,
    contextSize: 128_000,
  },
);

const formatted = computed(() => `~${formatCompactNumber(props.tokens)}`);

const percentage = computed(() => {
  if (props.contextSize <= 0) return 0;
  return Number(((props.tokens / props.contextSize) * 100).toFixed(1));
});

const contextLabel = computed(() => formatCompactNumber(props.contextSize));
</script>

<template>
  <div class="token-usage-summary">
    <div class="token-usage-icon">📊</div>
    <div class="token-usage-info">
      <div class="token-usage-text">
        <strong>{{ formatted }}</strong> tokens from <strong>{{ tools }}</strong> tools
        across <strong>{{ servers }}</strong> active server{{ servers !== 1 ? "s" : "" }}
      </div>
      <div class="token-usage-bar-wrap">
        <div class="token-usage-bar">
          <div class="token-usage-bar-fill" :style="{ width: `${percentage}%` }" />
        </div>
        <span class="token-usage-pct">{{ percentage }}% of {{ contextLabel }} context</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.token-usage-summary {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}

.token-usage-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--accent-muted);
  border: 1px solid var(--border-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--accent-fg);
  flex-shrink: 0;
}

.token-usage-info {
  flex: 1;
  min-width: 0;
}

.token-usage-text {
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.token-usage-text strong {
  color: var(--text-primary);
  font-weight: 600;
}

.token-usage-bar-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
}

.token-usage-bar {
  flex: 1;
  height: 4px;
  background: var(--neutral-muted);
  border-radius: var(--radius-full);
  overflow: hidden;
  max-width: 200px;
}

.token-usage-bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--gradient-accent);
  transition: width var(--transition-slow);
}

.token-usage-pct {
  font-size: 0.625rem;
  color: var(--text-placeholder);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
}
</style>