<script setup lang="ts">
defineProps<{
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'done' | 'neutral';
}>();
</script>
<template>
  <span
    class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium leading-tight"
    :class="{
      'bg-[var(--color-neutral-muted)] text-[var(--color-neutral-fg)]': !variant || variant === 'default' || variant === 'neutral',
      'bg-[var(--color-accent-muted)] text-[var(--color-accent-fg)]': variant === 'accent',
      'bg-[var(--color-success-muted)] text-[var(--color-success-fg)]': variant === 'success',
      'bg-[var(--color-warning-muted)] text-[var(--color-warning-fg)]': variant === 'warning',
      'bg-[var(--color-danger-muted)] text-[var(--color-danger-fg)]': variant === 'danger',
      'bg-[var(--color-done-muted)] text-[var(--color-done-fg)]': variant === 'done',
    }"
  >
    <slot />
  </span>
</template>
