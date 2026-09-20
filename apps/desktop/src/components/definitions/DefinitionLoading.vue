<script setup lang="ts">
defineProps<{ noun: string }>();
</script>

<template>
  <div class="definition-loading" role="status" :aria-label="`Loading ${noun} and usage`">
    <div class="skeleton definition-loading__stats" />
    <div class="skeleton definition-loading__filters" />
    <div class="definition-grid" aria-hidden="true">
      <div v-for="index in 6" :key="index" class="skeleton definition-loading__card" />
    </div>
  </div>
</template>

<style scoped>
.definition-loading { display: grid; gap: 16px; }
.definition-loading__stats { width: 65%; height: 18px; }
.definition-loading__filters { height: 74px; }
.definition-loading__card { height: 220px; }
</style>
