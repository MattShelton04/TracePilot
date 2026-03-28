# Implementation Plan: Fix Desktop App Search Architecture Bypass

## Issue Summary

**Critical Architecture Bug**: The desktop app's session list (apps/desktop/src/stores/sessions.ts) performs **client-side substring filtering** instead of leveraging the sophisticated backend FTS5 search index. This completely bypasses:

- The Rust FTS5 indexer infrastructure (crates/tracepilot-indexer)
- Full-text search of conversation content
- Optimized database queries
- Search performance benefits
- 47 lines of redundant frontend filtering logic

**Impact**: Users searching for content in their sessions only search against metadata (summary, repo, branch, ID), not the actual conversation content indexed in FTS5. This defeats the entire purpose of the search indexer.

**Evidence**:
- `apps/desktop/src/stores/sessions.ts:41-85` - Client-side filtering with `toLowerCase().includes()`
- `crates/tracepilot-tauri-bindings/src/commands/search.rs:14-59` - Backend `search_sessions()` command exists and works
- `packages/client/src/index.ts:233-235` - Client exports `searchSessions()` but it's never used
- Tech debt report §1 (P0) explicitly lists: "Desktop app bypasses backend search"

**Why this wasn't addressed in other PRs**: All 5 open PRs (202-207) just started and have empty diffs - they haven't identified specific improvements yet.

---

## Solution Design

### Overview
Replace the client-side filtering in `filteredSessions` computed property with backend FTS5 search queries when `searchQuery` is non-empty.

### Architecture Integration

**Current Flow (Broken)**:
```
User types in search box
  → searchQuery reactive ref updates
  → filteredSessions computed runs client-side .includes()
  → Only searches metadata fields
```

**New Flow (Fixed)**:
```
User types in search box
  → searchQuery reactive ref updates
  → Debounced search trigger (300ms)
  → Call backend searchSessions() via Tauri IPC
  → FTS5 searches full conversation content + metadata
  → Update sessions list with search results
  → Apply repo/branch filters client-side (fast)
```

### Design Decisions

1. **Debouncing**: Add 300ms debounce to avoid hammering the backend on every keystroke
2. **Empty query behavior**: When query is empty, revert to `listSessions()` (current behavior)
3. **Filter interaction**: Repo/branch filters applied client-side to search results (for instant reactivity)
4. **Sort preservation**: Sorting still done client-side after receiving results
5. **Loading states**: Add `searching` boolean separate from `loading` to show search spinner
6. **Error handling**: Network errors fall back to showing cached sessions with error toast

### Backward Compatibility

- No API changes - only internal store behavior
- Component interfaces unchanged
- Existing tests remain valid
- Mock mode still works (client already has mock for `search_sessions`)

---

## Implementation Steps

### Phase 1: Core Search Integration

**File**: `apps/desktop/src/stores/sessions.ts`

**Changes**:

1. **Add state** (after line 24):
```typescript
const searching = ref(false);
const searchError = ref<string | null>(null);
```

2. **Add debounced search function** (after line 39):
```typescript
import { watchDebounced } from '@vueuse/core';
import { searchSessions } from '@tracepilot/client';

// Debounced search watcher
watchDebounced(
  searchQuery,
  async (query) => {
    if (!query || query.trim() === '') {
      // Empty query: show all sessions
      await fetchSessions();
      return;
    }

    // Execute FTS search
    searching.value = true;
    searchError.value = null;
    try {
      const results = await searchSessions(query.trim());
      sessions.value = results;
    } catch (e) {
      searchError.value = toErrorMessage(e);
      logError('[sessions] Search failed:', e);
      // Keep existing sessions visible on error
    } finally {
      searching.value = false;
    }
  },
  { debounce: 300, maxWait: 1000 }
);
```

3. **Simplify filteredSessions computed** (replace lines 41-85):
```typescript
const filteredSessions = computed(() => {
  const prefs = usePreferencesStore();
  const repo = filterRepo.value;
  const branch = filterBranch.value;
  const hideEmpty = prefs.hideEmptySessions;

  // sessions.value now contains either:
  // - All sessions (from listSessions) if no search query
  // - Search results (from searchSessions) if query exists

  let result = sessions.value;

  // Apply filters
  if (hideEmpty) {
    result = result.filter(s => (s.turnCount ?? 0) !== 0);
  }
  if (repo) {
    result = result.filter(s => s.repository === repo);
  }
  if (branch) {
    result = result.filter(s => s.branch === branch);
  }

  // Sort
  result.sort((a, b) => {
    switch (sortBy.value) {
      case "created":
        return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      case "oldest":
        return (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
      case "events":
        return (b.eventCount ?? 0) - (a.eventCount ?? 0);
      case "turns":
        return (b.turnCount ?? 0) - (a.turnCount ?? 0);
      case "updated":
      default:
        return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    }
  });

  return result;
});
```

4. **Remove searchFieldCache** (delete lines 28-39):
   - No longer needed since we're not doing client-side search

5. **Export new state** (update return statement):
```typescript
return {
  sessions,
  loading,
  indexing,
  searching, // NEW
  error,
  searchError, // NEW
  // ... rest unchanged
};
```

### Phase 2: Install Dependencies

**File**: `apps/desktop/package.json`

Check if `@vueuse/core` is already installed. If not:
```json
{
  "dependencies": {
    "@vueuse/core": "^11.0.0"
  }
}
```

Run: `pnpm install --filter @tracepilot/desktop`

### Phase 3: Update UI Components

**File**: `apps/desktop/src/views/SessionListView.vue` (or equivalent)

1. Import `searching` state from store
2. Show search spinner when `searching === true`
3. Display `searchError` if present
4. Update placeholder text to reflect FTS capability: "Search sessions, conversations, and content..."

**File**: `apps/desktop/src/components/SessionSearchBar.vue` (if it exists)

Add visual feedback:
- Spinner icon when `searching`
- Search magnifying glass when idle
- Error state styling for `searchError`

### Phase 4: Update Tests

**File**: `apps/desktop/src/__tests__/stores/sessions.test.ts`

Update/add tests:

1. **Test: Search triggers backend call**
```typescript
it('should call searchSessions when searchQuery is set', async () => {
  const store = useSessionsStore();
  const spy = vi.spyOn(client, 'searchSessions').mockResolvedValue([MOCK_SESSION]);

  store.searchQuery = 'test query';
  await vi.advanceTimersByTimeAsync(400); // debounce + execution

  expect(spy).toHaveBeenCalledWith('test query');
  expect(store.sessions).toEqual([MOCK_SESSION]);
});
```

2. **Test: Empty query fetches all sessions**
```typescript
it('should fetch all sessions when search query is cleared', async () => {
  const store = useSessionsStore();
  const spy = vi.spyOn(client, 'listSessions').mockResolvedValue([...MOCK_SESSIONS]);

  store.searchQuery = 'test';
  await vi.advanceTimersByTimeAsync(400);
  store.searchQuery = '';
  await vi.advanceTimersByTimeAsync(400);

  expect(spy).toHaveBeenCalled();
});
```

3. **Test: Debouncing works**
```typescript
it('should debounce search queries', async () => {
  const store = useSessionsStore();
  const spy = vi.spyOn(client, 'searchSessions').mockResolvedValue([]);

  store.searchQuery = 'a';
  await vi.advanceTimersByTimeAsync(100);
  store.searchQuery = 'ab';
  await vi.advanceTimersByTimeAsync(100);
  store.searchQuery = 'abc';
  await vi.advanceTimersByTimeAsync(400);

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith('abc');
});
```

4. **Test: Filters work with search results**
```typescript
it('should apply filters to search results', async () => {
  const store = useSessionsStore();
  vi.spyOn(client, 'searchSessions').mockResolvedValue([
    { ...MOCK_SESSION, repository: 'repo-a' },
    { ...MOCK_SESSION, id: 'session-2', repository: 'repo-b' },
  ]);

  store.searchQuery = 'test';
  await vi.advanceTimersByTimeAsync(400);
  store.filterRepo = 'repo-a';

  expect(store.filteredSessions).toHaveLength(1);
  expect(store.filteredSessions[0].repository).toBe('repo-a');
});
```

5. **Test: Error handling**
```typescript
it('should handle search errors gracefully', async () => {
  const store = useSessionsStore();
  vi.spyOn(client, 'searchSessions').mockRejectedValue(new Error('Network error'));

  const initialSessions = store.sessions;
  store.searchQuery = 'test';
  await vi.advanceTimersByTimeAsync(400);

  expect(store.searchError).toBe('Network error');
  expect(store.sessions).toBe(initialSessions); // Unchanged
});
```

### Phase 5: Type Safety

**File**: `apps/desktop/src/stores/sessions.ts`

Ensure TypeScript types are correct:
- `searching: Ref<boolean>`
- `searchError: Ref<string | null>`
- Return type inference should work automatically with Pinia

### Phase 6: Performance Validation

Run benchmarks to ensure the change improves performance:

```bash
# Before/after comparison
pnpm dev
# Open DevTools Network tab
# Type in search box and measure:
# - Time to first result
# - Memory usage
# - Number of re-renders
```

Expected improvements:
- **Before**: O(n) client-side filtering, 10-50ms for 100 sessions
- **After**: O(log n) FTS5 query, 5-15ms for 1000+ sessions

---

## Testing Strategy

### Unit Tests (Vitest)
- ✅ Store behavior (5 new tests as outlined above)
- ✅ Mock client integration
- ✅ Debounce timing
- ✅ Error cases

### Integration Tests
1. **Manual Testing in Dev Mode**:
   - Start app: `pnpm dev`
   - Test scenarios:
     - Empty search → shows all sessions
     - Text search → triggers backend, shows matching results
     - Clear search → reverts to all sessions
     - Rapid typing → debounced to single query
     - Network error → shows error message, keeps existing sessions
     - Filter interaction → filters applied to search results

2. **Real Backend Testing**:
   - Requires actual indexed sessions
   - Test with 100+ sessions
   - Search for content in conversation text (not just metadata)
   - Verify FTS5 ranking works (best matches first)

### Regression Testing
- ✅ Existing 417 desktop tests should pass
- ✅ No changes to component APIs
- ✅ Mock mode continues working

---

## Rollback Plan

If issues arise:

1. **Immediate rollback** (< 5 minutes):
   - Revert `apps/desktop/src/stores/sessions.ts` to original
   - Remove `@vueuse/core` dependency if newly added

2. **Fallback mode** (if partial rollback needed):
   - Add feature flag: `USE_FTS_SEARCH`
   - Conditional: `if (USE_FTS_SEARCH) { /* new code */ } else { /* old code */ }`

3. **Debug mode**:
   - Add console.log for search queries
   - Track search timing metrics
   - Monitor Tauri backend logs

---

## Success Metrics

### Functional Success
- ✅ Search queries hit backend FTS5 index
- ✅ Results include content-based matches (not just metadata)
- ✅ Debouncing prevents excessive queries
- ✅ Error handling preserves UX
- ✅ All existing tests pass

### Performance Success
- ✅ Search latency < 50ms for 1000 sessions
- ✅ No UI jank during typing
- ✅ Memory usage unchanged or reduced (no client-side cache)

### Code Quality Success
- ✅ Remove 47 lines of redundant filtering logic
- ✅ Remove `searchFieldCache` computed (12 lines)
- ✅ Net reduction: ~50 lines of code
- ✅ Complexity reduced: O(n) → O(log n)

---

## Documentation Updates

### Code Comments
- Add JSDoc to `watchDebounced` explaining debounce strategy
- Document why filters are applied client-side (instant reactivity)

### README Updates
None required - user-facing behavior improves transparently.

### Developer Notes
Update `docs/architecture.md` (if exists) to note that search queries now properly use the indexer.

---

## Risk Assessment

### Low Risk ✅
- Tauri command already exists and works
- Client function already exported
- Mock data supports search
- Graceful degradation on errors

### Medium Risk ⚠️
- Debounce timing may need tuning (300ms might be too long/short)
- Filter interaction UX change (user may not notice filters applied after search)

### Mitigation
- Make debounce configurable via preferences if users complain
- Add unit tests for all edge cases
- Monitor real-world usage patterns

---

## Timeline Estimate

- **Phase 1** (Core implementation): 30 minutes
- **Phase 2** (Dependencies): 5 minutes
- **Phase 3** (UI updates): 20 minutes
- **Phase 4** (Tests): 45 minutes
- **Phase 5** (Type safety): 10 minutes
- **Phase 6** (Performance validation): 30 minutes
- **Total**: ~2.5 hours

---

## Related Issues from Tech Debt Report

This fix addresses:
- **P0 Issue #4**: "Desktop app bypasses backend search" - DIRECTLY FIXED ✅
- **P1 Issue #2**: "Code duplication" - Removes 50+ lines ✅
- Indirectly improves: Performance, maintainability, architecture consistency

---

## Next Steps

1. Confirm plan approval (or auto-proceed as instructed)
2. Implement Phase 1-6 sequentially
3. Run full test suite
4. Spin up review subagents
5. Iterate based on feedback
6. Generate user validation checklist

---

**Plan Status**: ✅ Complete and ready for implementation
**Estimated Impact**: 🔥 HIGH - Fixes critical architecture bug, improves performance, reduces complexity
**Confidence Level**: 95% - Well-scoped, backend infrastructure already exists, clear success criteria
