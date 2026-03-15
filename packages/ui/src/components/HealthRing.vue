<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  score: number;  // 0-1
  size?: 'sm' | 'lg';
}>(), { size: 'sm' });

const percentage = computed(() => Math.round(props.score * 100));
const color = computed(() => {
  if (props.score >= 0.8) return 'var(--success-fg)';
  if (props.score >= 0.5) return 'var(--warning-fg)';
  return 'var(--danger-fg)';
});
const ringSize = computed(() => props.size === 'lg' ? '120px' : '44px');
const fontSize = computed(() => props.size === 'lg' ? '1.5rem' : '0.75rem');
</script>

<template>
  <div 
    class="health-ring" 
    :class="[`health-ring-${size}`]"
    :style="{
      '--ring-pct': percentage,
      '--ring-color': color,
      width: ringSize,
      height: ringSize,
    }"
    :aria-label="`Health score: ${percentage}%`"
    role="meter"
    :aria-valuenow="percentage"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <span :style="{ fontSize }">{{ percentage }}</span>
  </div>
</template>

<style scoped>
.health-ring {
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: conic-gradient(
    var(--ring-color) calc(var(--ring-pct) * 1%),
    var(--border-muted) calc(var(--ring-pct) * 1%)
  );
  position: relative;
}
.health-ring::before {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: var(--canvas-default);
}
.health-ring-lg::before {
  inset: 8px;
}
.health-ring span {
  position: relative;
  z-index: 1;
  font-weight: 600;
  color: var(--text-primary);
}
</style>
