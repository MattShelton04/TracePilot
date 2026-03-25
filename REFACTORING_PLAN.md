# SessionSearchView Refactoring Plan

## Executive Summary

**Problem**: SessionSearchView.vue is a monolithic 2,376-line component that violates single responsibility principle and makes maintenance difficult.

**Solution**: Decompose into focused sub-components and extract shared logic into composables.

**Impact**:
- Improved maintainability (smaller, focused components)
- Better performance (more granular re-rendering)
- Code reusability (composables can be used elsewhere)
- Easier testing (isolated components)
- Enhanced developer experience (easier to understand and modify)

---

## Current Analysis

### File Structure
```
SessionSearchView.vue (2,376 lines)
├── Script (284 lines)
│   ├── State management (local UI state)
│   ├── Filter logic (content types, dates)
│   ├── Computed properties (15+)
│   └── Event handlers (12+)
├── Template (1,467 lines)
│   ├── Search Hero (~45 lines)
│   ├── Active Filter Chips (~35 lines)
│   ├── Indexing Banner (~30 lines)
│   ├── Filter Sidebar (~110 lines)
│   ├── Results Area (~1,247 lines)
│   │   ├── Error state (~8 lines)
│   │   ├── Loading state (~20 lines)
│   │   ├── Empty state (~40 lines)
│   │   ├── Browse presets (~30 lines)
│   │   ├── Stats bar (~35 lines)
│   │   ├── Flat results (~100 lines per result card)
│   │   ├── Grouped results (~120 lines per group)
│   │   └── Pagination (~30 lines)
└── Styles (625 lines)
```

### Identified Issues

1. **Mixed Concerns**: Search UI, filter management, results rendering, state management all in one file
2. **Local State Sprawl**: 10+ local ref/computed values for UI state
3. **Deep Template Nesting**: 7+ levels in some areas
4. **Duplicated Logic**: Date preset logic exists in multiple stores
5. **Large CSS**: 625 lines of styles could be scoped to sub-components
6. **Testing Difficulty**: Hard to test individual features in isolation
7. **Poor Reusability**: Filter logic can't be used elsewhere without duplication

---

## Proposed Architecture

### Component Hierarchy
```
SessionSearchView.vue (coordinator, ~200 lines)
├── SearchHero.vue (~150 lines)
│   ├── Search input with icon
│   ├── Search hints
│   └── Controls row (filters toggle, sort)
├── ActiveFilterChips.vue (~80 lines)
│   └── Display active filter chips with remove buttons
├── SearchIndexingBanner.vue (~70 lines)
│   └── Progress indicator for indexing operations
├── SearchFilters.vue (~250 lines)
│   ├── Content type filters (tri-state)
│   ├── Repository filter
│   ├── Tool name filter
│   ├── Date range presets
│   └── Clear filters button
├── SearchResults.vue (~300 lines)
│   ├── Error state
│   ├── Loading state (skeletons)
│   ├── Empty state (with browse presets)
│   ├── Results summary bar
│   ├── SearchResultsList.vue (~150 lines)
│   │   └── SearchResultCard.vue (~120 lines)
│   ├── SearchResultsGrouped.vue (~200 lines)
│   │   └── SessionGroup.vue (~150 lines)
│   └── SearchPagination.vue (~50 lines)
└── composables/
    ├── useDatePresets.ts (~80 lines)
    ├── useSearchFilters.ts (~100 lines)
    └── useExpandableResults.ts (~40 lines)
```

### File Organization
```
apps/desktop/src/
├── views/
│   └── SessionSearchView.vue (main coordinator)
├── components/
│   └── search/
│       ├── SearchHero.vue
│       ├── ActiveFilterChips.vue
│       ├── SearchIndexingBanner.vue
│       ├── SearchFilters.vue
│       ├── SearchResults.vue
│       ├── SearchResultsList.vue
│       ├── SearchResultCard.vue
│       ├── SearchResultsGrouped.vue
│       ├── SessionGroup.vue
│       └── SearchPagination.vue
└── composables/
    ├── useDatePresets.ts
    ├── useSearchFilters.ts
    └── useExpandableResults.ts
```

---

## Detailed Component Specifications

### 1. SearchHero.vue (New)

**Purpose**: Search input, hints, and top-level controls

**Props**:
- `modelValue: string` - Search query (v-model)
- `sortBy: string` - Current sort option
- `filtersOpen: boolean` - Filter panel visibility
- `activeFilterCount: number` - Badge count
- `isBrowseMode: boolean` - Whether in browse mode (disables relevance sort)

**Emits**:
- `update:modelValue` - Query change
- `update:sortBy` - Sort change
- `update:filtersOpen` - Toggle filters

**Features**:
- Search input with Ctrl+K shortcut
- Search syntax hints
- Filter toggle button with badge
- Sort dropdown

**Lines**: ~150 (template: 90, script: 40, style: 20)

---

### 2. ActiveFilterChips.vue (New)

**Purpose**: Display active filters as removable chips

**Props**:
- `contentTypeChips: Array<{ type: SearchContentType; mode: 'include' | 'exclude' }>` - Active content type filters
- `repository: string | null` - Active repository filter
- `toolName: string | null` - Active tool filter
- `sessionId: string | null` - Active session filter
- `sessionDisplayName: string | null` - Display name for session filter

**Emits**:
- `remove-content-type(type: SearchContentType)` - Remove content type filter
- `remove-repository` - Remove repository filter
- `remove-tool` - Remove tool filter
- `remove-session` - Remove session filter
- `clear-all` - Clear all filters

**Features**:
- Colored chips for content types (include/exclude)
- Neutral chips for repo/tool/session
- Remove buttons on each chip
- "Clear all" button when multiple filters active

**Lines**: ~80 (template: 50, script: 20, style: 10)

---

### 3. SearchIndexingBanner.vue (New)

**Purpose**: Show indexing progress banner

**Props**:
- `isIndexing: boolean` - Main indexing in progress
- `indexingProgress: { current: number; total: number } | null` - Main indexing progress
- `searchIndexing: boolean` - Search indexing in progress
- `searchIndexingProgress: { current: number; total: number } | null` - Search indexing progress
- `rebuilding: boolean` - Rebuilding index

**Features**:
- Animated spinner icon
- Progress bar when counts available
- Contextual messages

**Lines**: ~70 (template: 40, script: 15, style: 15)

---

### 4. SearchFilters.vue (New)

**Purpose**: Left sidebar with all filter controls

**Props**:
- `collapsed: boolean` - Sidebar collapsed state
- `contentTypes: SearchContentType[]` - Included types
- `excludeContentTypes: SearchContentType[]` - Excluded types
- `repository: string | null` - Selected repository
- `toolName: string | null` - Selected tool
- `dateFrom: string | null` - Date range start
- `dateTo: string | null` - Date range end
- `availableRepositories: string[]` - Repository options
- `availableToolNames: string[]` - Tool options
- `facetCounts: Map<string, number>` - Facet counts for content types

**Emits**:
- `update:contentTypes` - Content type selection changed
- `update:excludeContentTypes` - Content type exclusion changed
- `update:repository` - Repository changed
- `update:toolName` - Tool changed
- `update:dateFrom` - Date from changed
- `update:dateTo` - Date to changed
- `clear-all` - Clear all filters

**Features**:
- Tri-state content type checkboxes (off → include → exclude)
- Repository dropdown
- Tool dropdown
- Date preset buttons (uses useDatePresets composable)
- "Select All" / "Clear All" for content types
- Clear all filters button

**Lines**: ~250 (template: 150, script: 70, style: 30)

---

### 5. SearchResults.vue (New)

**Purpose**: Results area coordinator (error/loading/empty/results)

**Props**:
- `loading: boolean` - Loading state
- `error: string | null` - Error message
- `hasQuery: boolean` - Whether search query exists
- `hasResults: boolean` - Whether results exist
- `hasActiveFilters: boolean` - Whether filters are active
- `viewMode: 'flat' | 'grouped'` - Current view mode
- `results: SearchResult[]` - Flat results
- `groupedResults: SessionGroup[]` - Grouped results
- `totalCount: number` - Total result count
- `totalPages: number` - Total page count
- `page: number` - Current page
- `pageSize: number` - Results per page
- `latencyMs: number` - Search latency
- `stats: SearchStatsResponse | null` - Search stats
- `isBrowseMode: boolean` - Browse mode flag

**Emits**:
- `update:viewMode` - View mode changed
- `update:page` - Page changed
- `dismiss-error` - Dismiss error
- `clear-search` - Clear search
- `browse-errors` - Browse errors preset
- `browse-user-messages` - Browse user messages preset
- `browse-tool-calls` - Browse tool calls preset
- `filter-by-session(sessionId: string, displayName: string | null)` - Filter by session

**Features**:
- Error state display
- Loading skeleton cards
- Empty state with browse presets
- Results summary bar with view mode toggle
- Conditional rendering: SearchResultsList or SearchResultsGrouped
- SearchPagination component

**Lines**: ~300 (template: 200, script: 70, style: 30)

---

### 6. SearchResultsList.vue (New)

**Purpose**: Flat list of search results

**Props**:
- `results: SearchResult[]` - Results to display
- `expandedResults: Set<number>` - Set of expanded result IDs

**Emits**:
- `toggle-expand(id: number)` - Toggle result expansion

**Features**:
- Renders SearchResultCard for each result
- Passes expanded state down
- Staggered animation delays

**Lines**: ~100 (template: 60, script: 30, style: 10)

---

### 7. SearchResultCard.vue (New)

**Purpose**: Individual search result card (flat view)

**Props**:
- `result: SearchResult` - Result data
- `expanded: boolean` - Expansion state

**Emits**:
- `toggle-expand` - Toggle expansion

**Features**:
- Result header (repo, branch, date, content type badge)
- Snippet with HTML highlighting
- Metadata row
- Expandable details grid
- "View in session" link

**Lines**: ~150 (template: 100, script: 30, style: 20)

---

### 8. SearchResultsGrouped.vue (New)

**Purpose**: Grouped results by session

**Props**:
- `groupedResults: SessionGroup[]` - Grouped results
- `collapsedGroups: Set<string>` - Set of collapsed group IDs
- `expandedResults: Set<number>` - Set of expanded result IDs

**Emits**:
- `toggle-group-collapse(sessionId: string)` - Toggle group collapse
- `toggle-result-expand(id: number)` - Toggle result expansion
- `filter-by-session(sessionId: string, displayName: string | null)` - Filter by session

**Features**:
- Renders SessionGroup for each group
- Handles collapse/expand for groups
- Passes events up

**Lines**: ~120 (template: 80, script: 30, style: 10)

---

### 9. SessionGroup.vue (New)

**Purpose**: Single session group with results

**Props**:
- `group: SessionGroup` - Group data
- `collapsed: boolean` - Group collapsed state
- `expandedResults: Set<number>` - Expanded result IDs

**Emits**:
- `toggle-collapse` - Toggle group collapse
- `toggle-result-expand(id: number)` - Toggle result expansion
- `filter-by-session(sessionId: string, displayName: string | null)` - Filter by session

**Features**:
- Group header (title, repo, branch, count, actions)
- Collapsible group of results
- Result cards with inline expansion
- Filter and navigate buttons

**Lines**: ~180 (template: 130, script: 30, style: 20)

---

### 10. SearchPagination.vue (New)

**Purpose**: Pagination controls

**Props**:
- `page: number` - Current page
- `totalPages: number` - Total pages
- `totalCount: number` - Total results
- `pageSize: number` - Results per page
- `hasMore: boolean` - Whether more pages exist

**Emits**:
- `update:page` - Page changed

**Features**:
- Previous/Next buttons
- Page number buttons (with ellipsis for long lists)
- Page info display (X–Y of Z)
- Smart page visibility (shows current + neighbors)

**Lines**: ~50 (template: 30, script: 15, style: 5)

---

## Composables

### 1. useDatePresets.ts (New)

**Purpose**: Shared date preset logic (consolidates duplication)

**Exports**:
```typescript
interface DatePreset {
  key: string;
  label: string;
}

interface UseDatePresetsReturn {
  presets: DatePreset[];
  activeDatePreset: Ref<string>;
  setDatePreset: (
    preset: string,
    dateFrom: Ref<string | null>,
    dateTo: Ref<string | null>
  ) => void;
  clearDatePreset: (
    dateFrom: Ref<string | null>,
    dateTo: Ref<string | null>
  ) => void;
}

export function useDatePresets(): UseDatePresetsReturn
```

**Features**:
- Predefined presets: today, week, month, 3months, all
- Calculates date ranges based on preset
- Tracks active preset
- Can be used in SessionSearchView, analytics views, preferences

**Lines**: ~80

---

### 2. useSearchFilters.ts (New)

**Purpose**: Content type filter state management

**Exports**:
```typescript
interface UseSearchFiltersReturn {
  getContentTypeState: (ct: SearchContentType) => FilterState;
  cycleContentType: (ct: SearchContentType) => void;
  removeContentTypeFilter: (ct: SearchContentType) => void;
  toggleAllContentTypes: () => void;
  activeContentTypeChips: ComputedRef<{ type: SearchContentType; mode: 'include' | 'exclude' }[]>;
}

export function useSearchFilters(
  contentTypes: Ref<SearchContentType[]>,
  excludeContentTypes: Ref<SearchContentType[]>
): UseSearchFiltersReturn
```

**Features**:
- Tri-state filter logic (off → include → exclude → off)
- Helper functions for filter manipulation
- Computed active chips list
- Extracted from SessionSearchView for reusability

**Lines**: ~100

---

### 3. useExpandableResults.ts (New)

**Purpose**: Expandable card state management

**Exports**:
```typescript
interface UseExpandableResultsReturn {
  expandedResults: Ref<Set<number>>;
  toggleExpand: (id: number) => void;
  collapseAll: () => void;
  expandAll: (ids: number[]) => void;
}

export function useExpandableResults(): UseExpandableResultsReturn
```

**Features**:
- Manages Set of expanded result IDs
- Toggle, collapse all, expand all helpers
- Can be used for grouped view collapsed groups as well

**Lines**: ~40

---

## Refactored SessionSearchView.vue

**Purpose**: Top-level coordinator, minimal logic

**Structure**:
```vue
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSearchStore } from '@/stores/search';
import { useSessionsStore } from '@/stores/sessions';
import { useDatePresets } from '@/composables/useDatePresets';
import { useSearchFilters } from '@/composables/useSearchFilters';
import { useExpandableResults } from '@/composables/useExpandableResults';
import SearchHero from '@/components/search/SearchHero.vue';
import ActiveFilterChips from '@/components/search/ActiveFilterChips.vue';
import SearchIndexingBanner from '@/components/search/SearchIndexingBanner.vue';
import SearchFilters from '@/components/search/SearchFilters.vue';
import SearchResults from '@/components/search/SearchResults.vue';
import { safeListen } from '@/utils/tauriEvents';
import { shouldIgnoreGlobalShortcut } from '@/utils/keyboardShortcuts';

const store = useSearchStore();
const sessionsStore = useSessionsStore();

// Composables
const { activeDatePreset, setDatePreset } = useDatePresets();
const filterHelpers = useSearchFilters(store.contentTypes, store.excludeContentTypes);
const { expandedResults, toggleExpand } = useExpandableResults();
const { collapsedGroups, toggleCollapse } = useExpandableResults();

// Local UI state
const searchInputRef = ref<HTMLInputElement | null>(null);
const filtersOpen = ref(true);
const indexingProgress = ref<{ current: number; total: number } | null>(null);
const isIndexing = ref(false);
const filteredSessionNameOverride = ref<string | null>(null);

// Computed
const availableRepositories = computed(() => {
  return store.availableRepositories.length > 0 ? store.availableRepositories : sessionsStore.repositories;
});

const activeFilterCount = computed(() => {
  let count = 0;
  if (store.contentTypes.length > 0 || store.excludeContentTypes.length > 0) count++;
  if (store.repository) count++;
  if (store.dateFrom || store.dateTo) count++;
  if (store.sessionId) count++;
  return count;
});

const sessionDisplayName = computed(() => {
  if (!store.sessionId) return null;
  if (filteredSessionNameOverride.value) return filteredSessionNameOverride.value;
  const match = store.results.find(r => r.sessionId === store.sessionId);
  if (match?.sessionSummary) return match.sessionSummary;
  const group = store.groupedResults.find(g => g.sessionId === store.sessionId);
  if (group?.sessionSummary) return group.sessionSummary;
  return store.sessionId.slice(0, 12) + '…';
});

// Event handlers
function handleClearFilters() {
  store.clearFilters();
  activeDatePreset.value = 'all';
  filteredSessionNameOverride.value = null;
}

function handleFilterBySession(sessionId: string, displayName: string | null) {
  store.sessionId = sessionId;
  filteredSessionNameOverride.value = displayName || null;
  store.resultViewMode = 'flat';
}

function handleKeydown(e: KeyboardEvent) {
  if (shouldIgnoreGlobalShortcut(e)) return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    e.stopImmediatePropagation();
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  }
}

// Lifecycle
onMounted(async () => {
  store.fetchStats();
  store.fetchFilterOptions();
  store.fetchFacets();
  window.addEventListener('keydown', handleKeydown, { capture: true });

  const unlisteners = [];
  unlisteners.push(
    await safeListen<{ current: number; total: number }>('indexing-progress', (event) => {
      indexingProgress.value = event.payload;
    }),
    await safeListen('indexing-started', () => {
      indexingProgress.value = null;
      isIndexing.value = true;
    }),
    await safeListen('indexing-finished', () => {
      indexingProgress.value = null;
      isIndexing.value = false;
    }),
  );

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown, { capture: true });
    unlisteners.forEach(fn => fn());
  });
});
</script>

<template>
  <div class="search-view">
    <SearchHero
      v-model="store.query"
      v-model:sortBy="store.sortBy"
      v-model:filtersOpen="filtersOpen"
      :activeFilterCount="activeFilterCount"
      :isBrowseMode="store.isBrowseMode"
      :searchInputRef="searchInputRef"
    />

    <ActiveFilterChips
      v-if="activeFilterCount > 0"
      :contentTypeChips="filterHelpers.activeContentTypeChips.value"
      :repository="store.repository"
      :toolName="store.toolName"
      :sessionId="store.sessionId"
      :sessionDisplayName="sessionDisplayName"
      @remove-content-type="filterHelpers.removeContentTypeFilter"
      @remove-repository="store.repository = null"
      @remove-tool="store.toolName = null"
      @remove-session="store.sessionId = null; filteredSessionNameOverride = null"
      @clear-all="handleClearFilters"
    />

    <SearchIndexingBanner
      v-if="isIndexing || store.searchIndexing || store.rebuilding"
      :isIndexing="isIndexing"
      :indexingProgress="indexingProgress"
      :searchIndexing="store.searchIndexing"
      :searchIndexingProgress="store.searchIndexingProgress"
      :rebuilding="store.rebuilding"
    />

    <div class="search-page-layout">
      <SearchFilters
        v-model:contentTypes="store.contentTypes"
        v-model:excludeContentTypes="store.excludeContentTypes"
        v-model:repository="store.repository"
        v-model:toolName="store.toolName"
        v-model:dateFrom="store.dateFrom"
        v-model:dateTo="store.dateTo"
        :collapsed="!filtersOpen"
        :availableRepositories="availableRepositories"
        :availableToolNames="store.availableToolNames"
        :facetCounts="store.facets?.byContentType"
        :activeDatePreset="activeDatePreset"
        @set-date-preset="setDatePreset($event, store.dateFrom, store.dateTo)"
        @clear-all="handleClearFilters"
      />

      <SearchResults
        v-model:viewMode="store.resultViewMode"
        v-model:page="store.page"
        :loading="store.loading"
        :error="store.error"
        :hasQuery="store.hasQuery"
        :hasResults="store.hasResults"
        :hasActiveFilters="store.hasActiveFilters"
        :results="store.results"
        :groupedResults="store.groupedResults"
        :totalCount="store.totalCount"
        :totalPages="store.totalPages"
        :pageSize="store.pageSize"
        :latencyMs="store.latencyMs"
        :stats="store.stats"
        :isBrowseMode="store.isBrowseMode"
        :expandedResults="expandedResults"
        :collapsedGroups="collapsedGroups"
        @toggle-expand="toggleExpand"
        @toggle-group-collapse="toggleCollapse"
        @dismiss-error="store.error = null"
        @clear-search="store.clearAll()"
        @browse-errors="store.browseErrors()"
        @browse-user-messages="store.browseUserMessages()"
        @browse-tool-calls="store.browseToolCalls()"
        @filter-by-session="handleFilterBySession"
      />
    </div>
  </div>
</template>

<style scoped>
.search-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 28px;
  overflow-y: auto;
}

.search-page-layout {
  display: flex;
  gap: 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  margin-top: 16px;
}
</style>
```

**Lines**: ~200 (script: 100, template: 80, style: 20)

---

## Implementation Strategy

### Phase 1: Preparation (No Breaking Changes)
1. Create composables first (can be used immediately)
   - `useDatePresets.ts`
   - `useSearchFilters.ts`
   - `useExpandableResults.ts`
2. Write unit tests for composables
3. Run existing tests to ensure baseline

### Phase 2: Component Extraction (Incremental)
1. Extract simple components first (least dependencies)
   - `SearchPagination.vue`
   - `SearchIndexingBanner.vue`
   - `ActiveFilterChips.vue`
2. Extract medium components
   - `SearchHero.vue`
   - `SearchFilters.vue`
   - `SearchResultCard.vue`
3. Extract complex components (most dependencies)
   - `SessionGroup.vue`
   - `SearchResultsList.vue`
   - `SearchResultsGrouped.vue`
   - `SearchResults.vue`

### Phase 3: Integration
1. Update SessionSearchView.vue to use new components
2. Remove old template sections as components are integrated
3. Keep old code commented out during transition (easy rollback)
4. Verify functionality after each component integration

### Phase 4: Validation
1. Run full test suite
2. Manual testing checklist (see below)
3. Performance testing (measure re-render times)
4. Type checking (`pnpm typecheck`)
5. Linting (`pnpm lint`)

### Phase 5: Cleanup
1. Remove commented-out code
2. Update component documentation
3. Create follow-up tasks for additional improvements

---

## Testing Strategy

### Unit Tests

**Composables**:
- `useDatePresets.test.ts`
  - Test each preset calculates correct date range
  - Test clearDatePreset resets to null
  - Test activeDatePreset reactivity

- `useSearchFilters.test.ts`
  - Test tri-state cycle (off → include → exclude → off)
  - Test toggleAll with empty/partial/full states
  - Test removeContentTypeFilter
  - Test activeContentTypeChips computed

- `useExpandableResults.test.ts`
  - Test toggleExpand adds/removes from Set
  - Test collapseAll/expandAll

**Components**:
- `SearchPagination.test.ts`
  - Test page button clicks emit update:page
  - Test prev/next disabled states
  - Test visible pages algorithm

- `SearchResultCard.test.ts`
  - Test expand/collapse toggling
  - Test snippet rendering with HTML
  - Test session link generation

### Integration Tests

**SessionSearchView.test.ts**:
- Test filter interactions update store
- Test search query updates
- Test view mode switching
- Test pagination
- Test keyboard shortcuts (Ctrl+K)

### Manual Testing Checklist (User-Facing)

1. **Search Functionality**
   - [ ] Enter search query and verify results
   - [ ] Test syntax: `"phrase"`, `prefix*`, `AND`, `OR`, `NOT`
   - [ ] Verify Ctrl+K focuses search input
   - [ ] Test empty query shows browse mode
   - [ ] Verify sort options (relevance, newest, oldest)

2. **Filter Functionality**
   - [ ] Toggle content type filters (off → include → exclude → off)
   - [ ] Select/deselect all content types
   - [ ] Filter by repository
   - [ ] Filter by tool name
   - [ ] Use date presets (today, week, month, 3 months, all)
   - [ ] Verify filter chips appear when filters active
   - [ ] Remove individual filter chips
   - [ ] Clear all filters button
   - [ ] Collapse/expand filter sidebar

3. **Results Display**
   - [ ] Flat view: see list of individual results
   - [ ] Grouped view: see results grouped by session
   - [ ] Toggle between flat and grouped views
   - [ ] Expand/collapse individual result cards
   - [ ] Expand/collapse session groups
   - [ ] Verify result metadata (repo, branch, date, content type)
   - [ ] Verify snippet highlighting
   - [ ] Click "View in session" links
   - [ ] Filter by session from grouped view

4. **Pagination**
   - [ ] Navigate to next/previous page
   - [ ] Click specific page number
   - [ ] Verify page info display (X–Y of Z)
   - [ ] Test pagination with different result counts

5. **States**
   - [ ] Loading state shows skeleton cards
   - [ ] Error state shows friendly error message
   - [ ] Empty state shows "No results found" with suggestions
   - [ ] Browse mode shows preset buttons (errors, user messages, tools)
   - [ ] Click browse preset buttons

6. **Indexing**
   - [ ] Trigger indexing and verify banner appears
   - [ ] Verify progress bar updates
   - [ ] Verify banner dismisses when complete

7. **Performance**
   - [ ] Rapid filter changes should not freeze UI
   - [ ] Expanding many results should not cause jank
   - [ ] Pagination should be instant
   - [ ] View mode switching should be smooth

8. **Responsive**
   - [ ] Test at different viewport widths
   - [ ] Verify filter sidebar collapses on narrow screens
   - [ ] Verify mobile layout adjustments

---

## Performance Considerations

### Before Refactoring
- **Re-render scope**: Entire 2,376-line component re-renders on any state change
- **Style recalculation**: 625 lines of scoped styles on every render
- **Memory**: Single large component instance

### After Refactoring
- **Granular re-renders**: Only affected sub-components re-render
  - Filter change → only SearchFilters re-renders
  - Page change → only SearchPagination and results re-render
  - Expand card → only specific SearchResultCard re-renders
- **Style optimization**: Smaller scoped style blocks per component
- **Memory**: Multiple small component instances (better for garbage collection)
- **Bundle splitting**: Components can be lazy-loaded if needed

### Measured Improvements (Expected)
- **Initial render**: ~5-10% faster (smaller template compilation)
- **Filter updates**: ~60-80% faster (isolated re-renders)
- **Result expand**: ~90% faster (single card vs entire results)
- **Bundle size**: Negligible change (same code, different organization)

---

## Migration Risk Assessment

### Low Risk
- ✅ Composables are isolated utilities (no breaking changes)
- ✅ Components are pure presentation (props in, events out)
- ✅ Store logic unchanged (all behavior in useSearchStore)
- ✅ Incremental migration (can test each component individually)
- ✅ Easy rollback (keep old code until verified)

### Medium Risk
- ⚠️ Template breakage (missing prop/event wiring)
  - Mitigation: TypeScript will catch most issues at compile time
  - Mitigation: Comprehensive manual testing checklist
- ⚠️ Style regression (scoped styles may conflict)
  - Mitigation: Keep CSS selectors consistent
  - Mitigation: Visual comparison screenshots

### High Risk
- ❌ None identified (this is a pure refactoring, no logic changes)

---

## Success Criteria

### Objective Metrics
1. ✅ All tests pass (`pnpm -r test`)
2. ✅ Type check passes (`pnpm -r typecheck`)
3. ✅ Lint passes (`pnpm lint`)
4. ✅ No console errors or warnings in browser
5. ✅ Bundle size delta < 5KB
6. ✅ SessionSearchView.vue reduced to < 250 lines

### Subjective Quality
1. ✅ Code is more readable and maintainable
2. ✅ Components are easy to understand in isolation
3. ✅ Composables can be reused in other features
4. ✅ Future changes are easier to make
5. ✅ New developers can onboard faster

### User Experience
1. ✅ No functionality regressions
2. ✅ Visual appearance unchanged
3. ✅ Performance improved or neutral
4. ✅ All interactions work as before

---

## Follow-Up Opportunities

### After This Refactoring
1. **Extract date preset logic in other stores**
   - `preferences.ts` and `analytics.ts` both have similar date logic
   - Use shared `useDatePresets` composable

2. **Add proper TypeScript types**
   - Create `SearchFiltersState` interface
   - Create `SearchResultsState` interface
   - Export from `@tracepilot/types`

3. **Optimize search store**
   - Split into multiple stores (search, searchFilters, searchResults)
   - Use `storeToRefs` for better reactivity

4. **Add keyboard shortcuts for filters**
   - Ctrl+F: focus filters
   - Escape: clear search
   - Arrow keys: navigate results

5. **Add URL query params**
   - Persist search state in URL
   - Allow sharing search links
   - Browser back/forward support

6. **Virtualize results list**
   - Use virtual scrolling for 1000+ results
   - Improve performance for large datasets

---

## Timeline Estimate

### Time Breakdown
- Composables: 2 hours
- Simple components (3): 3 hours
- Medium components (3): 6 hours
- Complex components (3): 9 hours
- Integration: 3 hours
- Testing: 4 hours
- Documentation: 1 hour
- **Total**: ~28 hours (~3.5 days)

### Realistic Schedule
- **Day 1**: Composables + simple components + integration
- **Day 2**: Medium + complex components + integration
- **Day 3**: Testing + validation + cleanup
- **Day 4**: Buffer for unexpected issues

---

## Conclusion

This refactoring will significantly improve the maintainability and performance of the SessionSearchView feature. By decomposing the monolithic component into focused sub-components and extracting shared logic into composables, we create a more sustainable codebase that's easier to test, modify, and extend.

The incremental approach ensures we can validate each step and rollback if needed, making this a low-risk, high-value improvement.

**Next Steps**: Review this plan, gather feedback, and proceed with implementation.
