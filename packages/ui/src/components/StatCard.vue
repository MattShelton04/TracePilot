<script setup lang="ts">
defineProps<{
  value: string | number;
  label: string;
  color?: 'accent' | 'success' | 'warning' | 'danger' | 'done';
}>();

const colorMap: Record<string, string> = {
  accent: 'text-[var(--color-accent-fg)]',
  success: 'text-[var(--color-success-fg)]',
  warning: 'text-[var(--color-warning-fg)]',
  danger: 'text-[var(--color-danger-fg)]',
  done: 'text-[var(--color-done-fg)]',
};
</script>

<template>
  <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] p-4 text-center">
    <div class="text-2xl font-bold" :class="colorMap[color ?? 'accent']">
      {{ value }}
    </div>
    <div class="mt-1 text-xs text-[var(--color-text-secondary)]">{{ label }}</div>
  </div>
</template>
