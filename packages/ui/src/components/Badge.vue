<script setup lang="ts">
defineProps<{
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'error' | 'purple';
}>();
</script>
<template>
  <span
    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
    :class="{
      'bg-[var(--border)] text-[var(--text-muted)]': !variant || variant === 'default',
      'bg-blue-500/10 text-[var(--accent)]': variant === 'accent',
      'bg-green-500/10 text-[var(--success)]': variant === 'success',
      'bg-yellow-500/10 text-[var(--warning)]': variant === 'warning',
      'bg-red-500/10 text-[var(--error)]': variant === 'error',
      'bg-purple-500/10 text-purple-400': variant === 'purple',
    }"
  >
    <slot />
  </span>
</template>
