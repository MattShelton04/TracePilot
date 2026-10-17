<script setup lang="ts">
import { PageHeader } from "@tracepilot/ui";
import { computed } from "vue";
import { useAnalyticsStore } from "@/stores/analytics";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";
import {
  groupRepositoryFilterOptions,
  repositoryFilterOptionsFor,
} from "@/stores/sessions/filtering";
import SourceSwitch from "./sources/SourceSwitch.vue";
import TimeRangeFilter from "./TimeRangeFilter.vue";

defineProps<{
  title: string;
  subtitle: string;
}>();

const store = useAnalyticsStore();
const sessions = useSessionsStore();
const prefs = usePreferencesStore();
// The session list's options for the same source: repositories, then
// folder-only projects (most Claude Code sessions), so a pick here selects
// the sessions the list shows for it.
const repositoryGroups = computed(() =>
  groupRepositoryFilterOptions(
    repositoryFilterOptionsFor(sessions.sessions, {
      source: store.selectedSource,
      hideEmptySessions: prefs.hideEmptySessions,
      selected: store.selectedRepo,
    }),
  ),
);
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
        <optgroup v-for="group in repositoryGroups" :key="group.label" :label="group.label">
          <option
            v-for="opt in group.options"
            :key="opt.value"
            :value="opt.value"
            :title="opt.title"
          >
            {{ opt.label }}
          </option>
        </optgroup>
      </select>
      <SourceSwitch
        v-if="showSourceFilter"
        :model-value="store.selectedSource"
        :sources="store.availableSources"
        data-testid="analytics-source-filter"
        @update:model-value="store.setSource"
      />
    </template>
    <TimeRangeFilter />
  </PageHeader>
</template>
