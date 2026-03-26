# Implementation Plan: Consolidate Duplicated Browse Preset Functions

## Problem Statement

The search store (`apps/desktop/src/stores/search.ts`) contains 6 nearly identical "browse" preset functions that differ only in the `contentTypes` value they set. This represents 66 lines of duplicated code (6 functions × 11 lines each).

### Current Implementation (Lines 374-444)

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
}

function browseUserMessages() {
  query.value = '';
  contentTypes.value = ['user_message'];
  excludeContentTypes.value = [];
  repository.value = null;
  toolName.value = null;
  dateFrom.value = null;
  dateTo.value = null;
  sessionId.value = null;
  sortBy.value = 'newest';
}

// ... 4 more identical functions (browseToolCalls, browseReasoning, browseToolResults, browseSubagents)
```

### Issues Identified

1. **Code Duplication**: 66 lines of nearly identical code
2. **Maintenance Burden**: Any change to the browse pattern requires updating 6 functions
3. **Error Prone**: Easy to forget updating one function when modifying the pattern
4. **Limited Extensibility**: Adding new presets requires copy-pasting another 11-line function

## Proposed Solution

### Core Strategy

Create a single, reusable `applyBrowsePreset` function that accepts the content types as a parameter. The existing 6 browse functions become thin wrappers that call this shared implementation.

### Benefits

1. **Reduces Code**: From 66 lines to ~20 lines (-70% reduction)
2. **Single Source of Truth**: Browse pattern logic in one place
3. **Easy Maintenance**: Changes to pattern require single update
4. **Extensibility**: New presets are trivial to add (1 line each)
5. **Type Safety**: Leverages TypeScript type system for content types
6. **Zero Breaking Changes**: Public API remains identical

## Detailed Implementation Plan

### Phase 1: Create Core Helper Function

**File**: `apps/desktop/src/stores/search.ts`
**Location**: Insert at line 371 (before the browse preset functions)

```typescript
/**
 * Shared implementation for all browse presets.
 * Clears all filters and query, sets the specified content types,
 * and forces sort to 'newest' (most useful for browse mode).
 */
function applyBrowsePreset(types: SearchContentType | SearchContentType[]) {
  query.value = '';
  contentTypes.value = Array.isArray(types) ? types : [types];
  excludeContentTypes.value = [];
  repository.value = null;
  toolName.value = null;
  dateFrom.value = null;
  dateTo.value = null;
  sessionId.value = null;
  sortBy.value = 'newest';
}
```

**Key Design Decisions**:

1. **Parameter Type**: Accepts both single type (`'user_message'`) or array (`['error', 'tool_error']`)
   - Rationale: Errors preset needs 2 types, others need 1. This provides flexibility without complicating the API.

2. **Naming**: `applyBrowsePreset` instead of `setBrowsePreset` or `browseBy`
   - Rationale: Matches existing convention (`applyRecentSearch` at line 454)

3. **Location**: Private helper function (not exported from store)
   - Rationale: Internal implementation detail. Public API remains the specific browse* functions.

4. **Sort Behavior**: Always sets to 'newest'
   - Rationale: Consistent with all 6 existing browse functions. Browse mode (no query) makes relevance sorting meaningless.

### Phase 2: Refactor Existing Browse Functions

**File**: `apps/desktop/src/stores/search.ts`
**Lines to Replace**: 374-444

Replace all 6 functions with single-line implementations:

```typescript
function browseErrors() {
  applyBrowsePreset(['error', 'tool_error']);
}

function browseUserMessages() {
  applyBrowsePreset('user_message');
}

function browseToolCalls() {
  applyBrowsePreset('tool_call');
}

function browseReasoning() {
  applyBrowsePreset('reasoning');
}

function browseToolResults() {
  applyBrowsePreset('tool_result');
}

function browseSubagents() {
  applyBrowsePreset('subagent');
}
```

**Why Keep Individual Functions?**

While we could refactor the component to call `applyBrowsePreset` directly, keeping the named functions:
- Maintains the existing public API (no breaking changes)
- Provides semantic clarity at call sites (`browseErrors()` is clearer than `applyBrowsePreset(['error', 'tool_error'])`)
- Acts as documentation of available presets
- Allows future per-preset customization if needed

### Phase 3: Add Tests

**File**: Create `apps/desktop/src/__tests__/stores/search.test.ts`

**Test Coverage**:

```typescript
describe('useSearchStore - browse presets', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // Mock client functions to prevent actual API calls
  });

  describe('applyBrowsePreset shared behavior', () => {
    it('clears query', () => {
      const store = useSearchStore();
      store.query = 'existing query';
      store.browseErrors();
      expect(store.query).toBe('');
    });

    it('clears all filters', () => {
      const store = useSearchStore();
      store.repository = 'some-repo';
      store.toolName = 'some-tool';
      store.dateFrom = '2024-01-01';
      store.dateTo = '2024-12-31';
      store.sessionId = 'session-123';
      store.excludeContentTypes = ['user_message'];

      store.browseErrors();

      expect(store.excludeContentTypes).toEqual([]);
      expect(store.repository).toBeNull();
      expect(store.toolName).toBeNull();
      expect(store.dateFrom).toBeNull();
      expect(store.dateTo).toBeNull();
      expect(store.sessionId).toBeNull();
    });

    it('sets sort to newest', () => {
      const store = useSearchStore();
      store.sortBy = 'relevance';
      store.browseErrors();
      expect(store.sortBy).toBe('newest');
    });

    it('resets to page 1', () => {
      const store = useSearchStore();
      store.page = 5;
      store.browseErrors();
      expect(store.page).toBe(1);
    });
  });

  describe('individual presets', () => {
    it('browseErrors sets error content types', () => {
      const store = useSearchStore();
      store.browseErrors();
      expect(store.contentTypes).toEqual(['error', 'tool_error']);
    });

    it('browseUserMessages sets user_message type', () => {
      const store = useSearchStore();
      store.browseUserMessages();
      expect(store.contentTypes).toEqual(['user_message']);
    });

    it('browseToolCalls sets tool_call type', () => {
      const store = useSearchStore();
      store.browseToolCalls();
      expect(store.contentTypes).toEqual(['tool_call']);
    });

    it('browseReasoning sets reasoning type', () => {
      const store = useSearchStore();
      store.browseReasoning();
      expect(store.contentTypes).toEqual(['reasoning']);
    });

    it('browseToolResults sets tool_result type', () => {
      const store = useSearchStore();
      store.browseToolResults();
      expect(store.contentTypes).toEqual(['tool_result']);
    });

    it('browseSubagents sets subagent type', () => {
      const store = useSearchStore();
      store.browseSubagents();
      expect(store.contentTypes).toEqual(['subagent']);
    });
  });

  describe('preset combinations', () => {
    it('switching between presets updates content types correctly', () => {
      const store = useSearchStore();

      store.browseErrors();
      expect(store.contentTypes).toEqual(['error', 'tool_error']);

      store.browseUserMessages();
      expect(store.contentTypes).toEqual(['user_message']);

      store.browseToolCalls();
      expect(store.contentTypes).toEqual(['tool_call']);
    });

    it('clears previous filters when applying new preset', () => {
      const store = useSearchStore();

      // Apply filters
      store.repository = 'my-repo';
      store.toolName = 'my-tool';

      // Apply preset
      store.browseErrors();

      // Verify filters are cleared
      expect(store.repository).toBeNull();
      expect(store.toolName).toBeNull();
    });
  });
});
```

**Test Structure Rationale**:
- Group shared behavior tests (all presets should behave the same)
- Test individual preset configurations (each sets correct content types)
- Test state transitions (switching between presets)
- Follows existing test patterns from `sessions.test.ts`

### Phase 4: Integration Points

**No Changes Required** to:

1. **Component**: `apps/desktop/src/components/search/SearchBrowsePresets.vue`
   - Uses: `store.browseErrors()`, `store.browseUserMessages()`, etc.
   - Public API unchanged, no component modifications needed

2. **Store Exports** (lines 658-735): All browse functions remain in public API

3. **Watchers** (lines 359-369): No changes to search scheduling logic

### Phase 5: Testing & Validation Strategy

#### Unit Tests
```bash
pnpm --filter @tracepilot/desktop test search.test.ts
```

Expected: All tests pass, 100% coverage for browse preset logic

#### Integration Testing
1. **Manual UI Testing**:
   - Navigate to search view
   - Click each browse preset button
   - Verify filters are cleared and correct content types are set
   - Verify sort is set to 'newest'
   - Verify search executes automatically

2. **State Transition Testing**:
   - Set various filters manually
   - Click a browse preset
   - Verify all filters are cleared
   - Switch between different presets
   - Verify content types update correctly

3. **Edge Cases**:
   - Apply preset while search is loading
   - Apply preset with existing query
   - Rapid clicks on different presets

#### Type Safety Validation
```bash
pnpm --filter @tracepilot/desktop typecheck
```

Expected: No new type errors

#### Full Test Suite
```bash
pnpm --filter @tracepilot/desktop test
```

Expected: All 256 existing tests still pass

## Risk Analysis

### Low Risk Factors

1. **No Breaking Changes**: Public API identical
2. **Pure Refactor**: Behavior unchanged
3. **Type Safety**: TypeScript enforces correct usage
4. **Well-Scoped**: Changes confined to single file
5. **Easy Rollback**: Small, atomic change

### Edge Cases Handled

1. **Array vs Single Type**: `Array.isArray()` check handles both
2. **Empty Arrays**: TypeScript types prevent passing empty arrays
3. **Null/Undefined**: Function signature requires valid types
4. **Watcher Coalescing**: `nextTick` in `scheduleSearch` (line 273) already handles synchronous multi-ref updates

## Code Quality Improvements

### Before
- 66 lines of duplicated code
- 6 places to update for pattern changes
- Manual testing required for each function

### After
- ~20 lines total (helper + 6 wrappers)
- 1 place to update for pattern changes
- Comprehensive test coverage

## Future Extensibility

Adding new presets becomes trivial:

```typescript
// Example: Add "browse AI responses" preset
function browseAiResponses() {
  applyBrowsePreset('assistant_message');
}
```

## Implementation Sequence

1. Write comprehensive test file first (TDD approach)
2. Create `applyBrowsePreset` helper function
3. Refactor 6 browse functions to use helper
4. Run unit tests (verify functionality)
5. Run type checks (verify types)
6. Run full test suite (verify no regressions)
7. Manual UI testing (verify user experience)

## Success Criteria

- [ ] All 256+ existing desktop tests pass
- [ ] New search.test.ts has 15+ passing tests
- [ ] No TypeScript errors
- [ ] All 6 browse presets work identically in UI
- [ ] Code reduced by ~46 lines
- [ ] No behavioral changes observed

## Rollback Plan

If issues arise, revert is straightforward:
```bash
git revert <commit-sha>
```

Single file change makes rollback risk-free.

## Timeline Estimate

- Test writing: 30 minutes
- Implementation: 15 minutes
- Testing & validation: 30 minutes
- Total: ~75 minutes

## Additional Notes

### Why This Improvement is Valuable

1. **DRY Principle**: Eliminates significant code duplication
2. **Maintainability**: Future browse pattern changes require single update
3. **Developer Experience**: New presets are trivial to add
4. **Code Review**: Easier to review and understand preset logic
5. **Testing**: Shared tests validate all presets simultaneously

### Related Code Patterns

The codebase already uses similar patterns:
- `applyRecentSearch` (line 454): Sets query from recent search
- `clearFilters` (line 621): Shared filter clearing logic

This refactor aligns with existing architectural patterns.

### Alignment with Stored Memories

This implementation follows the stored memory convention:
> "Search browse presets use applyBrowsePreset to clear filters, set page=1, force sort 'newest', and schedule one search after hydrating suppression."

The memory already expects this pattern to exist, suggesting this refactor was previously identified as valuable.
