<script setup lang="ts">
defineProps<{
  message?: string;
}>();
</script>

<template>
  <div class="py-12 text-center text-sm text-[var(--color-text-secondary)]">
    <slot>{{ message || "No data found." }}</slot>
  </div>
</template>
