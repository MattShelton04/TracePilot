<script setup lang="ts">
import { useAnalyticsStore } from "@/stores/analytics";
import TimeRangeFilter from "./TimeRangeFilter.vue";

defineProps<{
  title: string;
  subtitle: string;
}>();

const store = useAnalyticsStore();
</script>

<template>
  <div class="analytics-page-header">
    <div class="analytics-page-header__top">
      <div>
        <h1 class="page-title">{{ title }}</h1>
        <p class="page-subtitle">{{ subtitle }}</p>
      </div>
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
    <TimeRangeFilter />
  </div>
</template>

<style scoped>
.analytics-page-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 24px;
}

.analytics-page-header__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
</style>
