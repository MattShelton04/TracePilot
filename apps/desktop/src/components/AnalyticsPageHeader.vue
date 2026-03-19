<script setup lang="ts">
import { useAnalyticsStore } from '@/stores/analytics';
import TimeRangeFilter from './TimeRangeFilter.vue';

defineProps<{
  title: string;
  subtitle: string;
}>();

const store = useAnalyticsStore();
</script>

<template>
  <div class="analytics-page-header">
    <div>
      <h1 class="page-title">{{ title }}</h1>
      <p class="page-subtitle">{{ subtitle }}</p>
    </div>
    <div class="analytics-page-header__controls">
      <TimeRangeFilter />
      <select
        :value="store.selectedRepo ?? ''"
        class="filter-select"
        aria-label="Filter by repository"
        @change="store.setRepo(($event.target as HTMLSelectElement).value || null)"
      >
        <option value="">All Repositories</option>
        <option v-for="repo in store.availableRepos" :key="repo" :value="repo">{{ repo }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.analytics-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.analytics-page-header__controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
