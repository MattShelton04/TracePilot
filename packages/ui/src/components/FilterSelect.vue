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
    class="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
    @change="model = ($event.target as HTMLSelectElement).value || null"
  >
    <option value="">{{ placeholder || 'All' }}</option>
    <option v-for="opt in options" :key="opt" :value="opt">{{ opt }}</option>
  </select>
</template>
