<script setup lang="ts">
defineProps<{
  title?: string;
  padding?: "sm" | "md";
}>();
</script>

<template>
  <div class="section-panel">
    <div v-if="title" class="section-panel-header">
      {{ title }}
    </div>
    <div class="section-panel-body">
      <slot />
    </div>
  </div>
</template>
