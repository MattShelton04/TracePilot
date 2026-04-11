<script setup lang="ts">
import { PageHeader } from "@tracepilot/ui";
import { useAnalyticsStore } from "@/stores/analytics";
import TimeRangeFilter from "./TimeRangeFilter.vue";

defineProps<{
  title: string;
  subtitle: string;
}>();

const store = useAnalyticsStore();
</script>

<template>
  <PageHeader :title="title" :subtitle="subtitle">
    <template #actions>
      <select
        :value="store.selectedRepo ?? ''"
        class="filter-select"
        aria-label="Filter by repository"
        @change="store.setRepo(($event.target as HTMLSelectElement).value || null)"
      >
        <option value="">All Repositories</option>
        <option v-for="repo in store.availableRepos" :key="repo" :value="repo">{{ repo }}</option>
      </select>
    </template>
    <TimeRangeFilter />
  </PageHeader>
</template>
