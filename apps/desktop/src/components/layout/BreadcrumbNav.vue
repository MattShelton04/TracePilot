<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";

interface BreadcrumbItem {
  label: string;
  to?: RouteLocationRaw;
}

defineProps<{
  items: BreadcrumbItem[];
}>();
</script>

<template>
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <template v-for="(item, index) in items" :key="index">
      <router-link v-if="item.to && index < items.length - 1" :to="item.to">
        {{ item.label }}
      </router-link>
      <span v-else class="breadcrumb-current" aria-current="page">{{ item.label }}</span>
      <svg v-if="index < items.length - 1" class="breadcrumb-separator" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </template>
  </nav>
</template>

<style scoped>
.breadcrumb-separator {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
</style>
