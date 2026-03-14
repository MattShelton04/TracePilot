<script setup lang="ts">
defineProps<{
  message?: string;
}>();
</script>

<template>
  <div class="rounded-lg border border-[var(--color-danger-fg)]/20 bg-[var(--color-danger-muted)] p-4 text-sm text-[var(--color-danger-fg)]">
    <slot>{{ message }}</slot>
  </div>
</template>
