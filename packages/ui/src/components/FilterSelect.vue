<script setup lang="ts">
const model = defineModel<string | null>({ default: null });
defineProps<{
  options: string[];
  placeholder?: string;
}>();
</script>
<template>
  <select
    :value="model ?? ''"
    class="rounded-md border border-[var(--color-border-default)] bg-[var(--color-canvas-default)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-fg)] transition-colors cursor-pointer"
    @change="model = ($event.target as HTMLSelectElement).value || null"
  >
    <option value="">{{ placeholder || 'All' }}</option>
    <option v-for="opt in options" :key="opt" :value="opt">{{ opt }}</option>
  </select>
</template>
