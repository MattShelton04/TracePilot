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
    :aria-label="placeholder || 'Filter'"
    class="filter-select"
    @change="model = ($event.target as HTMLSelectElement).value || null"
  >
    <option value="">{{ placeholder || 'All' }}</option>
    <option v-for="opt in options" :key="opt" :value="opt">{{ opt }}</option>
  </select>
</template>
<style scoped>
.filter-select {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
