<script setup lang="ts">
defineProps<{
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'done' | 'neutral';
}>();

const variantClass: Record<string, string> = {
  default: 'badge-neutral',
  neutral: 'badge-neutral',
  accent: 'badge-accent',
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  done: 'badge-done',
};
</script>
<template>
  <span class="badge" :class="variantClass[variant ?? 'default']">
    <slot />
  </span>
</template>
