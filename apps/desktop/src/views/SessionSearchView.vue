<script setup lang="ts">
import { formatNumberFull } from "@tracepilot/types";
import { formatBytes } from "@tracepilot/ui";
import { computed, ref } from "vue";
import {
  SearchActiveFilters,
  SearchBrowsePresets,
  SearchFilterSidebar,
  SearchGroupedResults,
  SearchResultCard,
  SearchSyntaxHelpModal,
  SessionSearchHero,
  SessionSearchIndexingBanner,
  SessionSearchPagination,
  SessionSearchResultsHeader,
} from "@/components/search";
import { useSessionSearch } from "@/composables/useSessionSearch";
import "@/styles/features/session-search.css";

const heroRef = ref<InstanceType<typeof SessionSearchHero> | null>(null);
const searchInputRef = computed<HTMLInputElement | null>(() => heroRef.value?.inputRef ?? null);

const {
  store,
  indexingProgress,
  isIndexing,
  expandedResults,
  toggleExpand,
  collapsedGroups,
  toggleGroupCollapse,
  filteredSessionNameOverride,
  sessionDisplayName,
  filterBySession,
  focusedResultIndex,
  resultIndexMap,
  pageStart,
  pageEnd,
  visiblePages,
  filtersOpen,
  activeDatePreset,
  showSyntaxHelp,
  handleCopyResult,
  handleCopyAllResults,
  contentTypeConfig,
  activeFilterCount,
  activeContentTypeChips,
  removeContentTypeFilter,
  friendlyError,
  handleClearFilters,
  sessionLink,
} = useSessionSearch({ searchInputRef });
</script>

<template>
  <div class="search-view">

    <SessionSearchHero
      ref="heroRef"
      :query="store.query"
      :filters-open="filtersOpen"
      :active-filter-count="activeFilterCount"
      :sort-by="store.sortBy"
      :is-browse-mode="store.isBrowseMode"
      @update:query="store.query = $event"
      @update:filters-open="filtersOpen = $event"
      @update:sort-by="(v) => store.sortBy = v as typeof store.sortBy"
      @show-syntax-help="showSyntaxHelp = true"
    />

    <SearchActiveFilters
      :active-content-type-chips="activeContentTypeChips"
      :repository="store.repository"
      :tool-name="store.toolName"
      :session-id="store.sessionId"
      :session-display-name="sessionDisplayName"
      :active-filter-count="activeFilterCount"
      :content-type-config="contentTypeConfig"
      @remove-content-type="removeContentTypeFilter"
      @clear-repository="store.repository = null"
      @clear-tool-name="store.toolName = null"
      @clear-session-id="store.sessionId = null; filteredSessionNameOverride = null"
      @clear-all="handleClearFilters"
    />

    <SessionSearchIndexingBanner
      :is-indexing="isIndexing"
      :search-indexing="store.searchIndexing"
      :rebuilding="store.rebuilding"
      :indexing-progress="indexingProgress"
      :search-indexing-progress="store.searchIndexingProgress"
    />

    <div class="search-page-layout">

      <SearchFilterSidebar
        :collapsed="!filtersOpen"
        v-model:active-date-preset="activeDatePreset"
        @clear-filters="handleClearFilters"
      />

      <div class="search-main">

        <div v-if="store.error" class="search-error">
          <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 3.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5zM8 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
          </svg>
          <span>{{ friendlyError }}</span>
          <button class="filter-clear-btn" @click="store.clearError()">Dismiss</button>
        </div>

        <div v-if="store.loading" class="search-main-scroll">
          <div class="results-summary">
            <span class="results-summary-text">Searching…</span>
          </div>
          <div class="results-list">
            <div v-for="n in 5" :key="n" class="result-card skeleton-card">
              <div class="skeleton-header">
                <div class="skeleton skeleton-badge" />
                <div class="skeleton skeleton-badge-sm" />
                <div class="skeleton skeleton-badge-sm" style="margin-left: auto" />
              </div>
              <div class="skeleton skeleton-text" />
              <div class="skeleton skeleton-text short" />
              <div class="skeleton-meta">
                <div class="skeleton skeleton-badge-sm" />
                <div class="skeleton skeleton-badge-sm" />
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="!store.hasQuery && !store.hasResults && !store.hasActiveFilters" class="search-main-scroll">

          <div v-if="store.healthInfo" class="search-health-bar">
            <span class="health-stat">
              <span class="health-dot" :class="store.healthInfo.inSync ? 'synced' : 'pending'" />
              {{ store.healthInfo.indexedSessions }}/{{ store.healthInfo.totalSessions }} sessions indexed
            </span>
            <span class="health-separator">·</span>
            <span class="health-stat">{{ formatNumberFull(store.healthInfo.totalContentRows) }} rows</span>
            <span class="health-separator">·</span>
            <span class="health-stat">{{ formatBytes(store.healthInfo.dbSizeBytes) }}</span>
            <span v-if="store.healthInfo.pendingSessions > 0" class="health-stat health-pending">
              · {{ store.healthInfo.pendingSessions }} pending
            </span>
          </div>

          <div v-if="store.stats && store.stats.totalSessions === 0" class="first-run-state">
            <svg class="first-run-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="20" cy="20" r="14" /><line x1="30" y1="30" x2="44" y2="44" />
              <circle cx="20" cy="20" r="4" stroke-dasharray="3 2" />
            </svg>
            <div class="first-run-title">No sessions indexed yet</div>
            <div class="first-run-subtitle">
              Open a coding session and TracePilot will automatically index it for search.
              You can also rebuild the index manually to pick up existing sessions.
            </div>
            <button class="first-run-rebuild-btn" @click="store.rebuild()">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
                <path d="M2 8a6 6 0 0 1 10.47-4M14 8a6 6 0 0 1-10.47 4" />
                <polyline points="12.5 1 12.5 4 9.5 4" /><polyline points="3.5 15 3.5 12 6.5 12" />
              </svg>
              Build Search Index
            </button>
          </div>

          <SearchBrowsePresets v-else />
        </div>

        <div v-else class="search-main-scroll">

          <SessionSearchResultsHeader
            :has-results="store.hasResults"
            :is-browse-mode="store.isBrowseMode"
            :total-count="store.totalCount"
            :grouped-count="store.groupedResults.length"
            :latency-ms="store.latencyMs"
            :result-view-mode="store.resultViewMode"
            :total-pages="store.totalPages"
            :page="store.page"
            @update:result-view-mode="store.resultViewMode = $event"
            @clear-all="store.clearAll()"
            @copy-all="handleCopyAllResults()"
          />

          <div v-if="!store.hasResults" class="search-empty-state">
            <svg class="search-empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="20" cy="20" r="14" />
              <line x1="30" y1="30" x2="44" y2="44" />
              <line x1="15" y1="15" x2="25" y2="25" stroke-width="2" />
              <line x1="25" y1="15" x2="15" y2="25" stroke-width="2" />
            </svg>
            <div class="empty-title">No results found</div>
            <div class="empty-subtitle">
              Try adjusting your search query or filters. Use quotes for exact phrases or * for prefix matching.
            </div>
            <button class="clear-search-btn" @click="store.clearAll()">Clear search</button>
          </div>

          <div v-else-if="store.resultViewMode === 'flat'" class="results-list">
            <SearchResultCard
              v-for="(result, idx) in store.results"
              :key="result.id"
              :result="result"
              :index="idx"
              :expanded="expandedResults.has(result.id)"
              :focused="focusedResultIndex === idx"
              :session-link="sessionLink(result.sessionId, result.turnNumber, result.eventIndex)"
              @toggle="toggleExpand(result.id)"
              @copy="handleCopyResult(result)"
            />
          </div>

          <SearchGroupedResults
            v-else
            :grouped-results="store.groupedResults"
            :collapsed-groups="collapsedGroups"
            :expanded-results="expandedResults"
            :result-index-map="resultIndexMap"
            :focused-result-index="focusedResultIndex"
            :has-more="store.hasMore"
            :content-type-config="contentTypeConfig"
            @toggle-group-collapse="toggleGroupCollapse"
            @filter-by-session="filterBySession"
            @toggle-expand="toggleExpand"
            :session-link="sessionLink"
          />

          <SessionSearchPagination
            :page="store.page"
            :total-pages="store.totalPages"
            :total-count="store.totalCount"
            :has-more="store.hasMore"
            :visible-pages="visiblePages"
            :page-start="pageStart"
            :page-end="pageEnd"
            @prev="store.prevPage()"
            @next="store.nextPage()"
            @go="store.setPage($event)"
          />

        </div>
      </div>

    </div>

    <div v-if="store.hasResults && !store.loading" class="keyboard-hints">
      <kbd>↑↓</kbd> navigate
      <kbd>Enter</kbd> expand
      <kbd>Esc</kbd> back to search
    </div>

    <SearchSyntaxHelpModal :visible="showSyntaxHelp" @close="showSyntaxHelp = false" />
  </div>
</template>
