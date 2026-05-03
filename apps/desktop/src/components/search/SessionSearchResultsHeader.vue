<script setup lang="ts">
import { formatDuration, formatNumberFull } from "@tracepilot/types";

defineProps<{
  hasResults: boolean;
  isBrowseMode: boolean;
  totalCount: number;
  groupedCount: number;
  latencyMs: number;
  resultViewMode: "flat" | "grouped";
  totalPages: number;
  page: number;
}>();

const emit = defineEmits<{
  (e: "update:resultViewMode", v: "flat" | "grouped"): void;
  (e: "clear-all"): void;
  (e: "copy-all"): void;
}>();
</script>

<template>
  <div class="results-summary">
    <span v-if="hasResults" class="results-summary-text">
      {{ isBrowseMode ? 'Browsing' : 'Found' }} <strong>{{ formatNumberFull(totalCount) }}</strong>
      result{{ totalCount !== 1 ? 's' : '' }}
      <span v-if="resultViewMode === 'grouped'"> across <strong>{{ groupedCount }}</strong> session{{ groupedCount !== 1 ? 's' : '' }}</span>
      <span class="summary-speed">({{ formatDuration(latencyMs) }})</span>
      <template v-if="resultViewMode === 'flat' && totalPages > 1">
        — page {{ page }} of {{ totalPages }}
      </template>
    </span>
    <span v-else class="results-summary-text">
      No results found
    </span>
    <div class="view-mode-toggle">
      <button
        class="view-mode-btn"
        title="Clear search"
        @click="emit('clear-all')"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
          <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      </button>
      <button
        v-if="hasResults"
        class="view-mode-btn"
        title="Copy all results"
        @click="emit('copy-all')"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
          <rect x="5" y="5" width="9" height="9" rx="1" /><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
        </svg>
      </button>
      <button
        class="view-mode-btn"
        :class="{ active: resultViewMode === 'flat' }"
        title="Flat list"
        @click="emit('update:resultViewMode', 'flat')"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
          <line x1="2" y1="4" x2="14" y2="4" /><line x1="2" y1="8" x2="14" y2="8" /><line x1="2" y1="12" x2="14" y2="12" />
        </svg>
      </button>
      <button
        class="view-mode-btn"
        :class="{ active: resultViewMode === 'grouped' }"
        title="Grouped by session"
        @click="emit('update:resultViewMode', 'grouped')"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
          <rect x="2" y="2" width="12" height="4" rx="1" /><rect x="2" y="10" width="12" height="4" rx="1" />
        </svg>
      </button>
    </div>
  </div>
</template>
