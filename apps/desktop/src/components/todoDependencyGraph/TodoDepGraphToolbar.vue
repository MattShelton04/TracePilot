<script setup lang="ts">
import { useTodoDependencyGraphContext } from "@/composables/useTodoDependencyGraph";
import { STATUS_ICON, STATUS_LABEL } from "./constants";

const ctx = useTodoDependencyGraphContext();
</script>

<template>
  <div class="graph-toolbar">
    <div class="status-filters">
      <button
        v-for="status in ctx.allStatuses.value"
        :key="status"
        :class="['filter-chip', status, { active: ctx.activeStatuses.value.has(status) }]"
        :aria-pressed="ctx.activeStatuses.value.has(status)"
        @click="ctx.toggleStatus(status)"
      >
        <span class="filter-icon">{{ STATUS_ICON[status] ?? "?" }}</span>
        {{ STATUS_LABEL[status] ?? status }}
        <span class="filter-count">{{ ctx.statusCount(status) }}</span>
      </button>
    </div>
    <div class="search-box">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z"/>
      </svg>
      <input
        type="text"
        v-model="ctx.searchQuery.value"
        placeholder="Search todos…"
        class="search-input"
      />
      <button
        v-if="ctx.searchQuery.value"
        class="search-clear"
        @click="ctx.searchQuery.value = ''"
        aria-label="Clear search"
      >✕</button>
    </div>
  </div>
</template>
