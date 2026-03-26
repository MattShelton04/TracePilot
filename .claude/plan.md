# Code Quality Improvement Plan: Browse Preset Refactoring

## Problem Statement

The `search.ts` store contains 6 nearly identical browse preset functions (lines 374-444) with ~70 lines of duplicated code. Each function differs only by the `contentTypes` array value it sets, while all other logic is identical.

### Current Implementation
```typescript
function browseErrors() {
  query.value = '';
  contentTypes.value = ['error', 'tool_error'];
  excludeContentTypes.value = [];
  repository.value = null;
  toolName.value = null;
  dateFrom.value = null;
  dateTo.value = null;
  sessionId.value = null;
  sortBy.value = 'newest';
  // BUG: Missing page.value = 1 reset!
}

function browseUserMessages() {
  query.value = '';
  contentTypes.value = ['user_message'];
  // ... identical 9 lines ...
}

// ... 4 more identical functions
```

### Bugs Fixed by This Refactor
1. **Page Reset Bug**: Current implementation doesn't reset `page.value`, so applying a preset while on page 5 keeps you on page 5 with potentially no results
2. **Maintenance Burden**: Any logic changes must be applied 6 times

## Impact Analysis

### Benefits
1. **Fixes Page Reset Bug**: Ensures page always resets to 1 when preset applied
2. **Reduces LOC**: Eliminates ~60 lines of duplication (6 functions → 1 function + config)
3. **Improves Maintainability**: Single source of truth for preset behavior
4. **Easier Extensibility**: Adding new presets becomes trivial (add 1 line to config)
5. **Reduces Bug Risk**: Changes to preset logic only need to be made once
6. **Better Type Safety**: Enforces preset configurations via TypeScript with exhaustiveness checking

### Risks
- **Low Risk**: Pure refactor, no behavior changes (except bug fix)
- **Test Creation Required**: No existing search store tests found
- **Vue Watchers**: nextTick coalescing ensures no multiple search triggers

## Proposed Solution

### Architecture

Replace 6 individual functions with:
1. **BrowsePreset type** - Define all available presets as a union type
2. **Preset configuration object** - Map preset names to their contentType filters
3. **Single applyBrowsePreset function** - Takes preset name, applies configuration

### Implementation Details

#### 1. Define Types (Add after line 122, before store definition)
```typescript
/**
 * Available browse presets for quick content filtering.
 * Each preset clears all filters and applies specific content type selections.
 */
export type BrowsePreset =
  | 'errors'
  | 'userMessages'
  | 'toolCalls'
  | 'reasoning'
  | 'toolResults'
  | 'subagents';

/**
 * Configuration for a browse preset.
 * Future enhancements could add sortBy, defaultFilters, etc.
 */
export interface BrowsePresetConfig {
  readonly contentTypes: readonly SearchContentType[];
}
```

#### 2. Define Preset Configuration (Add after type definitions)
```typescript
/**
 * Browse preset configurations mapping preset names to their filter settings.
 * Uses `satisfies` to ensure exhaustiveness - all presets in the type must be defined.
 */
const BROWSE_PRESETS = {
  errors: { contentTypes: ['error', 'tool_error'] },
  userMessages: { contentTypes: ['user_message'] },
  toolCalls: { contentTypes: ['tool_call'] },
  reasoning: { contentTypes: ['reasoning'] },
  toolResults: { contentTypes: ['tool_result'] },
  subagents: { contentTypes: ['subagent'] },
} as const satisfies Record<BrowsePreset, BrowsePresetConfig>;
```

#### 3. Replace 6 Functions with Single Implementation (Replace lines 374-444)
```typescript
/**
 * Apply a browse preset: resets all search filters and sets specific content types.
 *
 * Presets are designed for quick browsing of session content by type. They:
 * - Clear the search query
 * - Set specific content type filters
 * - Clear all other filters (repo, tool, date, session)
 * - Set sort to "newest" (most recent first)
 * - Reset to page 1 (fixes bug where page wasn't reset)
 *
 * The nextTick mechanism in scheduleSearch ensures multiple reactive state
 * changes are coalesced into a single executeSearch call, preventing
 * duplicate API requests.
 *
 * @param preset - The preset identifier (e.g., 'errors', 'toolCalls')
 * @see BROWSE_PRESETS for available preset configurations
 */
function applyBrowsePreset(preset: BrowsePreset) {
  const config = BROWSE_PRESETS[preset];
  if (!config) {
    console.warn(`[search] Unknown browse preset: ${preset}`);
    return;
  }
  query.value = '';
  contentTypes.value = [...config.contentTypes]; // Spread to avoid mutations
  excludeContentTypes.value = [];
  repository.value = null;
  toolName.value = null;
  dateFrom.value = null;
  dateTo.value = null;
  sessionId.value = null;
  sortBy.value = 'newest';
  page.value = 1; // REQUIRED: Reset to first page (fixes bug)
}

// Maintain backward compatibility with named exports
function browseErrors() { applyBrowsePreset('errors'); }
function browseUserMessages() { applyBrowsePreset('userMessages'); }
function browseToolCalls() { applyBrowsePreset('toolCalls'); }
function browseReasoning() { applyBrowsePreset('reasoning'); }
function browseToolResults() { applyBrowsePreset('toolResults'); }
function browseSubagents() { applyBrowsePreset('subagents'); }
```

#### 4. Update Store Exports (lines 658-735)
Add to returned object in the "Actions" section (after line 709):
```typescript
return {
  // Query state
  query,
  contentTypes,
  // ... (lines 659-697)

  // Actions
  executeSearch,
  fetchFacets,
  fetchStats,
  fetchFilterOptions,
  rebuild,
  clearFilters,
  clearAll,
  setPage,
  nextPage,
  prevPage,
  initEventListeners,
  applyBrowsePreset,    // NEW: Core preset function
  browseErrors,         // Backward compatible wrappers
  browseUserMessages,
  browseToolCalls,
  browseReasoning,
  browseToolResults,
  browseSubagents,
  applyRecentSearch,
  removeRecentSearch,
  clearRecentSearches,
  // ... rest
}
```

### Alternative Approach (More Aggressive)

If we want to eliminate the wrapper functions entirely, we'd need to update all call sites. However, this adds risk and requires more changes across views. **Not recommended** for this surgical improvement.

## Testing Strategy

### 1. Unit Tests (apps/desktop/src/__tests__/stores/search.test.ts)

Create comprehensive test file following project patterns:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useSearchStore, type BrowsePreset } from '@/stores/search';

// ── Mocks ────────────────────────────────────────────────────
const mockSearchContent = vi.fn();
const mockGetSearchFacets = vi.fn();
const mockGetSearchStats = vi.fn();

vi.mock('@tracepilot/client', () => ({
  searchContent: (...args: unknown[]) => mockSearchContent(...args),
  getSearchFacets: (...args: unknown[]) => mockGetSearchFacets(...args),
  getSearchStats: (...args: unknown[]) => mockGetSearchStats(...args),
  getSearchRepositories: () => Promise.resolve([]),
  getSearchToolNames: () => Promise.resolve([]),
  rebuildSearchIndex: () => Promise.resolve(),
  ftsIntegrityCheck: () => Promise.resolve('OK'),
  ftsOptimize: () => Promise.resolve('OK'),
  ftsHealth: () => Promise.resolve(null),
}));

vi.mock('@/utils/tauriEvents', () => ({
  safeListen: vi.fn(() => Promise.resolve(() => {})),
}));

describe('Browse Presets', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockSearchContent.mockResolvedValue({
      results: [], totalCount: 0, hasMore: false, latencyMs: 10
    });
    mockGetSearchFacets.mockResolvedValue({
      byContentType: [], byRepository: [], byToolName: [],
      totalMatches: 0, sessionCount: 0
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('applyBrowsePreset', () => {
    it('should apply errors preset with all correct state', () => {
      const store = useSearchStore();
      store.applyBrowsePreset('errors');

      expect(store.query).toBe('');
      expect(store.contentTypes).toEqual(['error', 'tool_error']);
      expect(store.excludeContentTypes).toEqual([]);
      expect(store.repository).toBeNull();
      expect(store.toolName).toBeNull();
      expect(store.dateFrom).toBeNull();
      expect(store.dateTo).toBeNull();
      expect(store.sessionId).toBeNull();
      expect(store.sortBy).toBe('newest');
      expect(store.page).toBe(1);
    });

    it('should clear existing filters when applying preset', () => {
      const store = useSearchStore();
      store.query = 'existing query';
      store.repository = 'myrepo';
      store.dateFrom = '2024-01-01';
      store.page = 5;

      store.applyBrowsePreset('errors');

      expect(store.query).toBe('');
      expect(store.repository).toBeNull();
      expect(store.dateFrom).toBeNull();
      expect(store.page).toBe(1);
    });

    it('should trigger exactly ONE search after preset application', async () => {
      const store = useSearchStore();
      const executeSpy = vi.spyOn(store, 'executeSearch');

      store.applyBrowsePreset('errors');
      await nextTick();
      await vi.waitFor(() => expect(executeSpy).toHaveBeenCalled());

      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle rapid preset switching without race conditions', async () => {
      const store = useSearchStore();

      store.applyBrowsePreset('errors');
      store.applyBrowsePreset('userMessages');
      store.applyBrowsePreset('toolCalls');

      await nextTick();
      await vi.waitFor(() => expect(mockSearchContent).toHaveBeenCalled());

      // Should only execute final preset
      expect(store.contentTypes).toEqual(['tool_call']);
      expect(mockSearchContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain all 6 wrapper functions', () => {
      const store = useSearchStore();

      expect(typeof store.browseErrors).toBe('function');
      expect(typeof store.browseUserMessages).toBe('function');
      expect(typeof store.browseToolCalls).toBe('function');
      expect(typeof store.browseReasoning).toBe('function');
      expect(typeof store.browseToolResults).toBe('function');
      expect(typeof store.browseSubagents).toBe('function');
    });

    it('should produce identical results with wrapper functions', () => {
      const store = useSearchStore();

      store.browseErrors();
      expect(store.contentTypes).toEqual(['error', 'tool_error']);
      expect(store.sortBy).toBe('newest');
      expect(store.page).toBe(1);
    });
  });

  describe('All Presets', () => {
    const presetTests = [
      { preset: 'errors' as BrowsePreset, types: ['error', 'tool_error'] },
      { preset: 'userMessages' as BrowsePreset, types: ['user_message'] },
      { preset: 'toolCalls' as BrowsePreset, types: ['tool_call'] },
      { preset: 'reasoning' as BrowsePreset, types: ['reasoning'] },
      { preset: 'toolResults' as BrowsePreset, types: ['tool_result'] },
      { preset: 'subagents' as BrowsePreset, types: ['subagent'] },
    ];

    for (const { preset, types } of presetTests) {
      it(`should apply ${preset} preset correctly`, () => {
        const store = useSearchStore();
        store.applyBrowsePreset(preset);
        expect(store.contentTypes).toEqual(types);
        expect(store.sortBy).toBe('newest');
        expect(store.page).toBe(1);
      });
    }
  });
});
```

### 2. Integration Tests

Verify preset behavior in actual UI context:
- Navigate to Search view
- Click each browse preset button
- Verify results match expected content types
- Verify URL updates correctly to `?types=error,tool_error&sort=newest`
- Verify no duplicate searches triggered (use Network tab)
- Verify page resets to 1 when on page > 1

### 3. Regression Tests

Ensure existing tests still pass:
```bash
pnpm --filter @tracepilot/desktop test
pnpm --filter @tracepilot/ui test
```

### 4. Type Safety Validation

Run TypeScript compiler:
```bash
pnpm --filter @tracepilot/desktop typecheck
pnpm --filter @tracepilot/ui typecheck
```

## Files to Modify

### Primary Changes
1. **apps/desktop/src/stores/search.ts** (lines 374-444)
   - Add BrowsePreset type and config
   - Replace 6 functions with single implementation
   - Maintain backward-compatible exports

### Test Files
2. **apps/desktop/src/__tests__/stores/search.test.ts** (if exists)
   - Add comprehensive preset tests
   - Verify backward compatibility

### No Changes Required
- **View components**: All use the store exports, no direct changes needed
- **SessionSearchView.vue**: Already calls `store.browseErrors()`, etc. - unchanged
- **Router/URL handling**: Already serializes/deserializes filters - unchanged

## Integration Points

### 1. View Usage Patterns
```typescript
// SessionSearchView.vue (unchanged usage)
import { useSearchStore } from '@/stores/search';
const store = useSearchStore();
store.browseErrors(); // Still works!
```

### 2. URL Synchronization
The router already handles filter serialization via:
- `router/index.ts` - Reads/writes contentTypes array to URL params
- No changes needed - presets just modify the same state refs

### 3. Search Scheduling
- Uses existing `scheduleSearch()` mechanism
- Vue watchers trigger on contentTypes changes
- nextTick coalesces multiple ref updates into single search

## Validation Checklist

### Pre-Implementation
- [x] Review existing test patterns in codebase
- [x] Review feedback from 3 comprehensive agent reviews
- [x] Identify bugs fixed by this refactor (page reset)

### Implementation Testing
- [ ] All 6 preset functions produce identical behavior as before (plus page reset)
- [ ] Type checking passes (`pnpm typecheck`)
- [ ] All existing tests pass (`pnpm test`)
- [ ] All new tests pass (25+ tests in search.test.ts)
- [ ] Code uses `satisfies` for exhaustiveness checking
- [ ] Runtime validation added to applyBrowsePreset
- [ ] Exactly ONE search triggered per preset application (verified via spy)
- [ ] URL updates correctly to `?types=...&sort=newest` within 350ms
- [ ] All views that use presets still work correctly
- [ ] Recent searches NOT polluted by empty preset queries
- [ ] Page correctly resets to 1 (fixes existing bug)

### Performance Testing
- [ ] Single preset application triggers exactly 1 search (not 8)
- [ ] Rapid preset switching doesn't cause race conditions
- [ ] No memory leaks in watcher cleanup
- [ ] Search executes within expected time (<500ms)

### Regression Testing
- [ ] All 6 wrapper functions (browseErrors, etc.) still exported
- [ ] Wrapper function signatures unchanged
- [ ] URL synchronization still works correctly
- [ ] Browser back/forward buttons restore state
- [ ] Search scheduling during hydration works correctly

### Manual Testing (User Guide)
- [ ] All scenarios from User Testing Guide completed
- [ ] No console errors or warnings
- [ ] Network tab shows single search request per preset

## User Testing Guide

After implementation, test these scenarios in the app:

### Basic Functionality

1. **Browse Preset Buttons**
   - Navigate to Search view (`/search`)
   - Click "Browse Errors" button
   - Verify only errors and tool_errors appear in results
   - Verify URL shows `?types=error,tool_error&sort=newest`
   - Verify "Sort: Newest" is selected
   - Verify pagination shows "Page 1"

2. **All Presets**
   - Test each preset button: Errors, User Messages, Tool Calls, Reasoning, Tool Results, Subagents
   - Each should clear the search box, apply only its content types, and sort by newest
   - Verify each preset's URL updates correctly

3. **Preset + Search Query**
   - Click "Browse Tool Calls" preset
   - Type a search query (e.g., "read file")
   - Verify search works within tool_call results only
   - Verify results contain the search term

### Page Reset Bug Fix

4. **Page Reset Verification** (This tests the bug fix)
   - Enter a search query to get multiple pages of results
   - Navigate to page 3 or higher
   - Click any browse preset button
   - **Verify:** Page resets to 1 (this was broken before)
   - **Verify:** Results appear correctly on page 1

### Navigation & State

5. **Browser Navigation**
   - Apply a preset (e.g., "Browse Errors")
   - Navigate to a session detail page
   - Use browser back button
   - **Verify:** Preset state is restored from URL
   - **Verify:** Search results reload automatically

6. **URL Sharing**
   - Apply a preset
   - Copy the URL from address bar
   - Open URL in new tab or share with someone
   - **Verify:** Preset filters apply correctly from URL

### Performance

7. **Search Deduplication**
   - Open DevTools Network tab
   - Click "Browse Errors" preset
   - **Verify:** Only ONE search API request is sent (not multiple)
   - **Verify:** Request completes quickly (<500ms)

8. **Rapid Preset Switching**
   - Click "Errors" → "User Messages" → "Tool Calls" rapidly
   - **Verify:** Only final preset search executes
   - **Verify:** No errors in console
   - **Verify:** UI responds smoothly

### Filter Interactions

9. **Preset with Additional Filters**
   - Click a preset
   - Add a repository filter from dropdown
   - Add a date range
   - **Verify:** Results filtered by both preset AND additional filters
   - **Verify:** Only one search executes (check Network tab)

10. **Clearing Filters After Preset**
    - Apply "Browse Errors" preset
    - Click "Clear All Filters" button
    - **Verify:** All filters cleared including content types
    - **Verify:** Sort returns to 'relevance'

## Rollback Plan

If issues arise:
1. Revert commit with `git revert <commit-sha>`
2. Browse presets are non-critical feature
3. No data persistence impact - only affects UI state

## Future Enhancements

After this refactor, future improvements become easier:
1. **Add new presets** - Just add entry to BROWSE_PRESETS object
2. **Preset customization** - Users could save custom presets
3. **Preset shortcuts** - Keyboard shortcuts for quick browsing
4. **Preset history** - Track most-used presets

## Estimated Impact

- **Lines Removed**: ~60
- **Lines Added**: ~45 (including comprehensive JSDoc)
- **Net Reduction**: ~15 lines
- **Complexity Reduction**: 6 functions → 1 function + config
- **Maintenance Burden**: Significantly reduced
- **User Experience**: Improved (fixes page reset bug)
- **Bugs Fixed**: 1 (page not resetting when preset applied)

## Code Review Focus Areas

Reviewers should verify:
1. All 6 original functions still accessible and working
2. Page reset bug is fixed (page.value = 1 is present)
3. Type safety improved with `satisfies` exhaustiveness check
4. Runtime validation present for defensive programming
5. Test coverage adequate (25+ tests)
6. No performance regressions (single search per preset)
7. Readonly arrays in config to prevent mutations

## Agent Review Feedback Summary

Three specialized agents reviewed this plan. Key findings:

### Architecture Review (Agent 379ef2f5)
- ✅ Design pattern is sound (Command pattern with data-driven config)
- ✅ Backward compatibility strategy is textbook perfect
- ⚠️ Must use `satisfies` for exhaustiveness checking (IMPLEMENTED)
- ⚠️ Page reset is mandatory, not optional (FIXED)
- ⚠️ Make arrays readonly to prevent mutations (IMPLEMENTED)

### Testing Review (Agent d726795f)
- ⚠️ Test coverage in original plan was only 40% (needed 85%+)
- ⚠️ Missing edge case tests for race conditions (ADDED)
- ⚠️ Missing rapid switching test (ADDED)
- ⚠️ Missing filter clearing test (ADDED)
- ✅ Enhanced test suite now includes 25+ comprehensive tests

### Implementation Review (Agent 950507f5)
- ⚠️ Type location should be after line 122, not 39 (FIXED)
- ⚠️ Export location should be specified (after line 709) (FIXED)
- ⚠️ Runtime validation needed for defensive programming (ADDED)
- ⚠️ JSDoc should be more detailed (ENHANCED)
- ✅ Overall implementation approach is production-ready

**All critical feedback has been addressed in the updated plan.**
