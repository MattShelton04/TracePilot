<script setup lang="ts">
import type { SessionSource } from "@tracepilot/types";
import { Info } from "lucide-vue-next";
import { computed, nextTick, ref } from "vue";
import SourceSwitch from "@/components/sources/SourceSwitch.vue";
import { effectiveSortMode, type SortMode } from "@/stores/search/query";

const props = defineProps<{
  query: string;
  filtersOpen: boolean;
  filtersId?: string;
  activeFilterCount: number;
  sortBy: string;
  isBrowseMode: boolean;
  /** One source, or `null` for every source. */
  source?: SessionSource | null;
  /** Sources to offer; the switch shows only when `showSource` is set. */
  sources?: readonly SessionSource[];
  showSource?: boolean;
  /** The query opens with NOT, which FTS can't search on its own. */
  startsWithNot?: boolean;
  /** `type:` values that name no content type and so filter nothing. */
  unknownTypes?: readonly string[];
}>();

const emit = defineEmits<{
  (e: "update:query", v: string): void;
  (e: "update:filtersOpen", v: boolean): void;
  (e: "update:sortBy", v: string): void;
  (e: "update:source", v: SessionSource | null): void;
  (e: "show-syntax-help"): void;
}>();

// Browse results are newest first while "Relevance" stays picked for the next
// query, so the select shows the sort the results really use.
const shownSort = computed(() => effectiveSortMode(props.sortBy as SortMode, props.isBrowseMode));

function pickSort(e: Event) {
  const select = e.target as HTMLSelectElement;
  emit("update:sortBy", select.value);
  // A pick that changes nothing shown (Relevance with no query) re-renders
  // nothing, so put the sort the results use back in the select.
  void nextTick(() => {
    select.value = shownSort.value;
  });
}

// On a short, narrow window only the examples show; each label stays in its
// tooltip and for screen readers (see session-search.css).
const SYNTAX_HINTS = [
  { code: '"phrase"', label: "exact match" },
  { code: "prefix*", label: "prefix search" },
  { code: "type:error", label: "filter by type" },
  { code: "repo:name", label: "filter by repo" },
  { code: "tool:grep", label: "filter by tool" },
] as const;

const inputRef = ref<HTMLInputElement | null>(null);
const filterToggleRef = ref<HTMLButtonElement | null>(null);
function focusFilterToggle() {
  filterToggleRef.value?.focus();
}
defineExpose({ inputRef, focusFilterToggle });
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
    <p v-if="startsWithNot" class="search-query-hint" role="status" data-testid="search-not-hint">
      <Info :size="14" aria-hidden="true" />
      <span>
        <code>NOT</code> needs a term before it, like <code>error NOT timeout</code>.
        A leading <code>NOT</code> and the term after it are left out of the search.
      </span>
    </p>
    <p v-if="unknownTypes?.length" class="search-query-hint" role="status" data-testid="search-type-hint">
      <Info :size="14" aria-hidden="true" />
      <span>
        Unknown {{ unknownTypes.length === 1 ? "type" : "types" }}<template v-for="(type, i) in unknownTypes" :key="type">{{ i === 0 ? " " : ", " }}<code>{{ type }}</code></template>
        {{ unknownTypes.length === 1 ? "isn't used as a filter" : "aren't used as filters" }}.
        More syntax lists the types.
      </span>
    </p>
    <div class="search-hints">
      <span v-for="hint in SYNTAX_HINTS" :key="hint.code" class="search-hint" :title="hint.label">
        <code>{{ hint.code }}</code> <span class="search-hint-label">{{ hint.label }}</span>
      </span>
      <button class="search-hint syntax-help-btn" @click="emit('show-syntax-help')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
          <circle cx="8" cy="8" r="6" /><path d="M6 6a2 2 0 1 1 2 2v1" /><circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
        </svg>
        More syntax
      </button>
    </div>

    <div class="search-controls">
      <button
        ref="filterToggleRef"
        class="filter-toggle-btn"
        :class="{ active: filtersOpen }"
        aria-label="Toggle filters"
        :aria-expanded="filtersOpen"
        :aria-controls="filtersId"
        @click="emit('update:filtersOpen', !filtersOpen)"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2 4h12M4 8h8M6 12h4" />
        </svg>
        Filters
        <span v-if="activeFilterCount > 0" class="filter-count-badge">{{ activeFilterCount }}</span>
      </button>
      <div style="flex: 1" />
      <SourceSwitch
        v-if="showSource"
        :model-value="source ?? null"
        :sources="sources ?? []"
        label="Filter results by source"
        data-testid="search-source-filter"
        @update:model-value="emit('update:source', $event)"
      />
      <select
        :value="shownSort"
        class="sort-select"
        aria-label="Sort results"
        @change="pickSort"
      >
        <option value="relevance" :disabled="isBrowseMode">Sort: Relevance</option>
        <option value="newest">Sort: Newest</option>
        <option value="oldest">Sort: Oldest</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.search-query-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 8px 0 0;
  font-size: 0.75rem;
  color: var(--attention-fg);
}
.search-query-hint svg {
  flex-shrink: 0;
  margin-top: 1px;
}
.search-query-hint code {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.6875rem;
  background: var(--attention-subtle);
  padding: 0 4px;
  border-radius: var(--radius-sm);
}
</style>
