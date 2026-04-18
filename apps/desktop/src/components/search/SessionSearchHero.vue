<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  query: string;
  filtersOpen: boolean;
  activeFilterCount: number;
  sortBy: string;
  isBrowseMode: boolean;
}>();

const emit = defineEmits<{
  (e: "update:query", v: string): void;
  (e: "update:filtersOpen", v: boolean): void;
  (e: "update:sortBy", v: string): void;
  (e: "show-syntax-help"): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
defineExpose({ inputRef });
</script>

<template>
  <div class="search-hero">
    <div class="search-hero-container">
      <svg class="search-hero-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="7" cy="7" r="4.5" />
        <line x1="10.5" y1="10.5" x2="14" y2="14" />
      </svg>
      <input
        ref="inputRef"
        :value="query"
        type="text"
        class="search-hero-input"
        placeholder="Search across all sessions…"
        aria-label="Search sessions"
        data-testid="search-input"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
      />
      <kbd class="search-hero-kbd">Ctrl+K</kbd>
    </div>
    <div class="search-hints">
      <span class="search-hint"><code>"phrase"</code> exact match</span>
      <span class="search-hint"><code>prefix*</code> prefix search</span>
      <span class="search-hint"><code>type:error</code> filter by type</span>
      <span class="search-hint"><code>repo:name</code> filter by repo</span>
      <span class="search-hint"><code>tool:grep</code> filter by tool</span>
      <button class="search-hint syntax-help-btn" @click="emit('show-syntax-help')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
          <circle cx="8" cy="8" r="6" /><path d="M6 6a2 2 0 1 1 2 2v1" /><circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
        </svg>
        More syntax
      </button>
    </div>

    <div class="search-controls">
      <button
        class="filter-toggle-btn"
        :class="{ active: filtersOpen }"
        aria-label="Toggle filters"
        @click="emit('update:filtersOpen', !filtersOpen)"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2 4h12M4 8h8M6 12h4" />
        </svg>
        Filters
        <span v-if="activeFilterCount > 0" class="filter-count-badge">{{ activeFilterCount }}</span>
      </button>
      <div style="flex: 1" />
      <select
        :value="sortBy"
        class="sort-select"
        aria-label="Sort results"
        @change="emit('update:sortBy', ($event.target as HTMLSelectElement).value)"
      >
        <option value="relevance" :disabled="isBrowseMode">Sort: Relevance</option>
        <option value="newest">Sort: Newest</option>
        <option value="oldest">Sort: Oldest</option>
      </select>
    </div>
  </div>
</template>
