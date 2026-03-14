<script setup lang="ts">
const props = defineProps<{
  percent: number;
  color?: string;
  ariaLabel?: string;
}>();
</script>

<template>
  <div
    class="h-2 overflow-hidden rounded-full bg-[var(--color-border-muted)]"
    role="progressbar"
    :aria-valuenow="Math.round(props.percent)"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-label="ariaLabel"
  >
    <div
      class="h-full rounded-full transition-all duration-300"
      :style="{
        width: `${Math.min(100, Math.max(0, props.percent))}%`,
        backgroundColor: color || 'var(--color-success-emphasis)',
      }"
    />
  </div>
</template>
