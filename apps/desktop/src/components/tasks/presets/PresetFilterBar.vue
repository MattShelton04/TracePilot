<script setup lang="ts">
import { SegmentedControl } from "@tracepilot/ui";
import type {
  PresetCategoryFilter,
  PresetSortBy,
  PresetViewMode,
} from "@/composables/usePresetManager";

defineProps<{
  searchQuery: string;
  filterTag: string;
  allTags: string[];
  sortBy: PresetSortBy;
  viewMode: PresetViewMode;
  categoryFilter: PresetCategoryFilter;
}>();

defineEmits<{
  (e: "update:searchQuery", v: string): void;
  (e: "update:filterTag", v: string): void;
  (e: "update:sortBy", v: PresetSortBy): void;
  (e: "update:viewMode", v: PresetViewMode): void;
  (e: "update:categoryFilter", v: PresetCategoryFilter): void;
}>();

const categoryOptions = [
  { value: "all", label: "All" },
  { value: "builtin", label: "Built-in" },
  { value: "custom", label: "Custom" },
];
</script>

<template>
  <SegmentedControl
    :model-value="categoryFilter"
    :options="categoryOptions"
    rounded="pill"
    class="category-segmented"
    @update:model-value="(v) => $emit('update:categoryFilter', v as PresetCategoryFilter)"
  />

  <div class="filter-row">
    <div class="search-box">
      <svg
        class="search-icon"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path
          d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"
        />
      </svg>
      <input
        :value="searchQuery"
        class="search-input"
        type="text"
        placeholder="Search presets…"
        aria-label="Search presets"
        @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <div class="tag-filter">
      <select
        :value="filterTag"
        class="tag-select"
        aria-label="Filter by tag"
        @change="$emit('update:filterTag', ($event.target as HTMLSelectElement).value)"
      >
        <option value="all">All Tags</option>
        <option v-for="tag in allTags" :key="tag" :value="tag">
          {{ tag }}
        </option>
      </select>
    </div>

    <div class="sort-filter">
      <select
        :value="sortBy"
        class="tag-select"
        aria-label="Sort presets"
        @change="$emit('update:sortBy', ($event.target as HTMLSelectElement).value as PresetSortBy)"
      >
        <option value="name">Sort: Name</option>
        <option value="newest">Sort: Newest</option>
        <option value="most-used">Sort: Most Used</option>
      </select>
    </div>

    <div class="filter-spacer" />

    <div class="view-toggle" role="group" aria-label="View mode">
      <button
        class="view-toggle__btn"
        :class="{ 'view-toggle__btn--active': viewMode === 'grid' }"
        title="Grid view"
        @click="$emit('update:viewMode', 'grid')"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path
            d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3Zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3ZM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3Zm8 0A1.5 1.5 0 0 1 10.5 9h3A1.5 1.5 0 0 1 15 10.5v3A1.5 1.5 0 0 1 13.5 15h-3A1.5 1.5 0 0 1 9 13.5v-3Z"
          />
        </svg>
      </button>
      <button
        class="view-toggle__btn"
        :class="{ 'view-toggle__btn--active': viewMode === 'list' }"
        title="List view"
        @click="$emit('update:viewMode', 'list')"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path
            d="M2 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm3.75-1.5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Zm0 5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Zm0 5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5ZM3 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-1 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.category-segmented {
  margin: 12px 0 0;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0 20px;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 32px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  max-width: 260px;
  flex: 1;
  transition: border-color var(--transition-fast);
  box-sizing: border-box;
}

.search-box:focus-within {
  border-color: var(--accent-fg);
}

.search-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

.tag-filter {
  flex-shrink: 0;
}

.tag-select {
  height: 32px;
  padding: 0 28px 0 12px;
  font-size: 0.8125rem;
  font-family: inherit;
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  outline: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  transition: border-color var(--transition-fast);
}

.tag-select:focus {
  border-color: var(--accent-fg);
}

.sort-filter {
  flex-shrink: 0;
}

.filter-spacer {
  flex: 1;
}

.view-toggle {
  display: flex;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  flex-shrink: 0;
}

.view-toggle__btn {
  padding: 5px 8px;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
}

.view-toggle__btn:hover {
  color: var(--text-primary);
  background: var(--canvas-subtle);
}

.view-toggle__btn--active {
  color: var(--accent-fg);
  background: var(--accent-muted);
}

.view-toggle__btn + .view-toggle__btn {
  border-left: 1px solid var(--border-default);
}
</style>
