<script setup lang="ts">
defineProps<{
  title?: string;
  padding?: "sm" | "md";
}>();
</script>

<template>
  <div
    class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)]"
    :class="padding === 'sm' ? 'p-4' : 'p-5'"
  >
    <h3
      v-if="title"
      class="text-sm font-semibold text-[var(--color-text-primary)] mb-4 pb-2 border-b border-[var(--color-border-muted)]"
    >
      {{ title }}
    </h3>
    <slot />
  </div>
</template>
