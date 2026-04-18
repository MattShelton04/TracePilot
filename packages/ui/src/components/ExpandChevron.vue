<script setup lang="ts">
defineProps<{
  expanded: boolean;
  size?: "sm" | "md";
}>();
</script>

<template>
  <svg
    class="flex-shrink-0"
    :width="size === 'md' ? 16 : 12"
    :height="size === 'md' ? 16 : 12"
    :style="{
      color: 'var(--text-tertiary)',
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 150ms ease',
    }"
    fill="currentColor"
    viewBox="0 0 16 16"
    aria-hidden="true"
  >
    <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
  </svg>
</template>
