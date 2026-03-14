<script setup lang="ts">
defineProps<{
  disabled?: boolean;
  size?: "sm" | "md";
}>();
</script>

<template>
  <button
    class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-sidebar-hover)] disabled:opacity-50 disabled:pointer-events-none"
    :class="size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>
