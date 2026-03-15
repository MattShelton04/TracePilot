<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
  percentage: number;  // 0-100
  color?: string;
}>();
</script>

<template>
  <div class="token-bar">
    <div class="token-bar-label">{{ label }}</div>
    <div class="token-bar-track">
      <div 
        class="token-bar-fill" 
        :style="{ 
          width: `${Math.min(percentage, 100)}%`,
          background: color || 'var(--accent-emphasis)',
        }"
      />
    </div>
    <div class="token-bar-value">{{ value }}</div>
    <div class="token-bar-pct" v-if="percentage !== undefined">{{ percentage.toFixed(1) }}%</div>
  </div>
</template>

<style scoped>
.token-bar-pct {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  min-width: 48px;
  text-align: right;
}
</style>
