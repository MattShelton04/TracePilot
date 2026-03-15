<script setup lang="ts">
defineProps<{
  message?: string;
  icon?: string;
  title?: string;
}>();
</script>

<template>
  <div class="empty-state">
    <div v-if="icon" class="empty-state-icon">{{ icon }}</div>
    <div v-if="title" class="empty-state-title">{{ title }}</div>
    <div class="empty-state-desc">
      <slot>{{ message || "No data found." }}</slot>
    </div>
  </div>
</template>
