<script setup lang="ts">
import { type SessionSource, sourceLabel } from "@tracepilot/types";
import { PageHeader } from "@tracepilot/ui";
import { computed } from "vue";
import { useAnalyticsStore } from "@/stores/analytics";
import TimeRangeFilter from "./TimeRangeFilter.vue";

defineProps<{
  title: string;
  subtitle: string;
}>();

const store = useAnalyticsStore();
// Like the session list, the source filter appears only once more than one
// source has sessions, so Copilot-only users see no change.
const showSourceFilter = computed(
  () => store.availableSources.length > 1 || store.selectedSource !== null,
);
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
      <select
        v-if="showSourceFilter"
        :value="store.selectedSource ?? ''"
        class="filter-select"
        aria-label="Filter by source"
        data-testid="analytics-source-filter"
        @change="store.setSource((($event.target as HTMLSelectElement).value || null) as SessionSource | null)"
      >
        <option value="">All Sources</option>
        <option v-for="source in store.availableSources" :key="source" :value="source">
          {{ sourceLabel(source) }}
        </option>
      </select>
    </template>
    <TimeRangeFilter />
  </PageHeader>
</template>
