<script setup lang="ts">
defineProps<{
  value: string | number;
  label: string;
  color?: 'accent' | 'success' | 'warning' | 'danger' | 'done';
  trend?: string;
  trendDirection?: 'up' | 'down' | 'neutral';
  gradient?: boolean;
  mini?: boolean;
}>();
</script>

<template>
  <div class="stat-card" :class="{ 'mini-stat': mini }">
    <div
      class="stat-card-value"
      :class="[
        gradient ? 'gradient-value' : (color ?? 'accent'),
      ]"
    >
      {{ value }}
    </div>
    <div class="stat-card-label">{{ label }}</div>
    <div
      v-if="trend"
      class="stat-card-trend"
      :class="trendDirection ?? 'neutral'"
    >
      <span v-if="trendDirection === 'up'" aria-hidden="true">↑</span>
      <span v-else-if="trendDirection === 'down'" aria-hidden="true">↓</span>
      {{ trend }}
    </div>
  </div>
</template>
