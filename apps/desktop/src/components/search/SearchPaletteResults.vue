<script setup lang="ts">
import type { SearchResult } from "@tracepilot/types";
import { formatRelativeTime } from "@tracepilot/ui";
import { nextTick, ref } from "vue";
import type { ResultGroup } from "@/composables/useSearchPaletteSearch";

defineProps<{
  groupedResults: ResultGroup[];
  flatResults: SearchResult[];
  selectedIndex: number;
  loading: boolean;
  hasQuery: boolean;
  hasResults: boolean;
  searchError: string | null;
  query: string;
}>();

const emit = defineEmits<{
  select: [result: SearchResult];
  hover: [index: number];
}>();

const containerRef = ref<HTMLElement | null>(null);

function scrollSelectedIntoView() {
  nextTick(() => {
    const container = containerRef.value;
    if (!container) return;
    const selected = container.querySelector(".palette-item.selected") as HTMLElement | null;
    if (selected) selected.scrollIntoView({ block: "nearest" });
  });
}

function resultIndex(result: SearchResult, flat: SearchResult[]): number {
  return flat.indexOf(result);
}

function badgeBackground(color: string): string {
  return `rgba(${hexToRgb(color)}, 0.12)`;
}

function hexToRgb(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

defineExpose({ scrollSelectedIntoView });
</script>

<template>
  <div ref="containerRef" class="palette-results">
    <!-- Loading shimmer -->
    <div v-if="loading" class="palette-loading" role="status" aria-label="Loading results">
      <div v-for="g in 3" :key="g" class="shimmer-group">
        <div class="shimmer-header" />
        <div v-for="r in (g === 1 ? 3 : 2)" :key="r" class="shimmer-row">
          <div class="shimmer-icon" />
          <div class="shimmer-lines">
            <div class="shimmer-line" :style="{ width: `${40 + g * 10 + r * 5}%` }" />
            <div class="shimmer-line" :style="{ width: `${25 + g * 8 + r * 6}%` }" />
          </div>
        </div>
      </div>
    </div>

    <!-- Empty: no query -->
    <div v-else-if="!hasQuery" class="palette-empty">
      <div class="palette-empty-icon">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
      </div>
      <div class="palette-empty-text">Type to search across all sessions…</div>
    </div>

    <!-- Search error -->
    <div v-else-if="searchError && !loading" class="palette-no-results">
      <div class="palette-no-results-icon" style="color: var(--danger-fg);">
        <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="8" cy="8" r="6" />
          <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" />
          <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" />
        </svg>
      </div>
      <div class="palette-no-results-text">Search failed</div>
      <div class="palette-no-results-hint">{{ searchError }}</div>
    </div>

    <!-- No results -->
    <div v-else-if="!loading && !hasResults" class="palette-no-results">
      <div class="palette-no-results-icon">
        <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
      </div>
      <div class="palette-no-results-text">No results for "{{ query }}"</div>
      <div class="palette-no-results-hint">Try a different search term</div>
    </div>

    <!-- Grouped results -->
    <div v-else id="palette-listbox" role="listbox" aria-label="Search results">
      <div
        v-for="group in groupedResults"
        :key="group.contentType"
        class="palette-group"
        role="group"
        :aria-label="group.label"
      >
        <div class="palette-group-header">
          <span class="palette-group-dot" :style="{ background: group.color }" />
          {{ group.label }}
          <span class="palette-group-count">{{ group.results.length }}</span>
        </div>
        <div
          v-for="result in group.results"
          :key="result.id"
          :id="`palette-item-${resultIndex(result, flatResults)}`"
          class="palette-item"
          role="option"
          :aria-selected="resultIndex(result, flatResults) === selectedIndex"
          :class="{ selected: resultIndex(result, flatResults) === selectedIndex }"
          @mousedown.prevent
          @click="emit('select', result)"
          @mouseenter="emit('hover', resultIndex(result, flatResults))"
        >
          <div
            class="palette-item-icon"
            :style="{
              background: badgeBackground(group.color),
              color: group.color,
            }"
          >
            <svg v-if="['user_message', 'assistant_message'].includes(result.contentType)" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M2 3h12v8H5l-3 3V3z" />
            </svg>
            <svg v-else-if="result.contentType === 'reasoning'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
              <circle cx="8" cy="8" r="5.5" />
              <path d="M6.5 6.5c0-1.1.67-1.5 1.5-1.5s1.5.6 1.5 1.5c0 .7-.5 1-1.5 1.5V9.5" />
              <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
            </svg>
            <svg v-else-if="['tool_call', 'tool_result'].includes(result.contentType)" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M9.5 2.5l4 4-7 7-4-4 7-7z" />
              <path d="M6.5 9.5L2 14" />
            </svg>
            <svg v-else-if="['tool_error', 'error'].includes(result.contentType)" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M8 1.5L14.5 13H1.5L8 1.5z" />
              <line x1="8" y1="6" x2="8" y2="9.5" />
              <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <line x1="5" y1="6" x2="11" y2="6" />
              <line x1="5" y1="9" x2="9" y2="9" />
            </svg>
          </div>

          <div class="palette-item-body">
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="palette-item-title" v-html="result.snippet" />
            <div class="palette-item-meta">
              <span v-if="result.sessionSummary" class="palette-meta-session">{{ result.sessionSummary }}</span>
              <span v-if="result.sessionSummary && result.turnNumber != null" class="sep">·</span>
              <span v-if="result.turnNumber != null">Turn {{ result.turnNumber }}</span>
              <span v-if="result.turnNumber != null && (result.sessionRepository || result.sessionUpdatedAt)" class="sep">·</span>
              <span v-if="result.sessionRepository">{{ result.sessionRepository }}</span>
              <span v-if="result.sessionRepository && result.sessionUpdatedAt" class="sep">·</span>
              <span v-if="result.sessionUpdatedAt">{{ formatRelativeTime(result.sessionUpdatedAt) }}</span>
            </div>
          </div>

          <div class="palette-item-right">
            <span
              v-if="result.toolName"
              class="palette-item-badge"
              :style="{
                background: badgeBackground(group.color),
                color: group.color,
              }"
            >
              {{ result.toolName }}
            </span>
            <span
              v-else-if="result.turnNumber != null"
              class="palette-item-badge badge-turn"
            >
              T{{ result.turnNumber }}
            </span>
            <span class="palette-item-arrow">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M6 4l4 4-4 4" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./search-palette-results.css"></style>
