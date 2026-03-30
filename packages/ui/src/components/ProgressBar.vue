<script setup lang="ts">
const props = defineProps<{
  percent: number;
  color?: "accent" | "success" | "warning" | "danger";
  ariaLabel?: string;
}>();

const colorMap: Record<string, string> = {
  accent: "var(--accent-fg)",
  success: "var(--success-fg)",
  warning: "var(--warning-fg)",
  danger: "var(--danger-fg)",
};
</script>

<template>
  <div
    class="progress-bar"
    role="progressbar"
    :aria-valuenow="Math.round(props.percent)"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-label="ariaLabel"
  >
    <div
      class="progress-bar-fill"
      :style="{
        width: `${Math.min(100, Math.max(0, props.percent))}%`,
        background: colorMap[color ?? 'accent'],
      }"
    />
  </div>
</template>
