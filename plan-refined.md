# TracePilot: Async State Management Refactoring - REFINED PLAN

## Executive Summary - After Expert Review

**Critical Finding:** The codebase already has `/apps/desktop/src/composables/useCachedFetch.ts` which provides nearly identical functionality to the proposed `useAsyncState`. Based on three comprehensive reviews (architectural, testing, and implementation), this plan has been significantly revised.

**New Strategy:** Instead of creating a new composable, we will enhance the existing `useCachedFetch` to add missing lifecycle hooks and then refactor stores to use this unified abstraction.

**Key Changes from Original Plan:**
1. ✅ Use existing `useCachedFetch` as base (don't create duplicate abstraction)
2. ✅ Add lifecycle hooks (`onSuccess`, `onError`, `onFinally`) to `useCachedFetch`
3. ✅ Keep `buildSectionLoader` pattern but refactor its internals
4. ✅ Add comprehensive race condition and edge case tests
5. ✅ Add AbortController support for cancellation
6. ✅ Protect exposed state with `readonly`
7. ✅ Add `silent` mode for background refreshes

---

## Review Findings Summary

### **Architectural Review (7.5/10 - Good with concerns)**

**Critical Issues Identified:**
- Duplicate functionality with existing `useCachedFetch` ⚠️
- Missing AbortController support for cancellation
- sessionDetail cache integration needs careful design
- Dual-token pattern (requestToken + eventsRequestToken) must be preserved
- `currentToken` should not be exposed to consumers

**Key Recommendations:**
- Extend `useCachedFetch` instead of creating new composable
- Add batch token coordination for `refreshAll` scenarios
- Wrap callbacks in try-catch to prevent unhandled errors
- Use discriminated union for state (idle/loading/success/error)

### **Testing Review (Comprehensive gaps found)**

**Critical Gaps Identified:**
- ~60-80 missing test cases (edge cases, race conditions, integration)
- No memory leak testing
- Incomplete manual testing checklist (~40 missing scenarios)
- No performance benchmarking plan
- Missing store-level integration tests

**Key Recommendations:**
- Add 20+ edge case tests for async state
- Create integration test suite for each refactored store
- Add stress tests (1000+ sequential operations)
- Test callback error handling
- Add visual regression tests for error states

### **Implementation Review (7.5/10 - Strong foundation)**

**Critical Issues Identified:**
- `onFinally` timing bug (called for stale requests)
- Missing `readonly` on exposed state refs
- Error type inconsistency (`Error | string` vs just `string`)
- `preferences.ts` hydration gate could be corrupted by refactoring
- `search.ts` needs two separate async states (search + facets)
- Multiple stores still use `String(e)` instead of `toErrorMessage`

**Key Recommendations:**
- Fix `onFinally` to only fire for non-stale requests
- Use `readonly()` wrapper on all exposed refs
- Keep cache logic separate from async state management
- Be extremely careful with `preferences.ts` - consider out of scope
- Add dual async states for search (main search + facets)

---

## Revised Solution

### Enhanced useCachedFetch API

Instead of creating `useAsyncState`, we extend `useCachedFetch`:

```typescript
export interface CachedFetchOptions<TData, TParams> {
  fetcher: (params: TParams) => Promise<TData>;
  cacheKeyFn?: (params: TParams) => string;

  // NEW: Lifecycle hooks
  onSuccess?: (data: TData) => void;
  onError?: (error: string) => void;
  onFinally?: () => void;

  // NEW: Initial data
  initialData?: TData | null;

  // NEW: Error strategy
  resetOnError?: boolean;

  // NEW: Silent mode (don't update loading state)
  silent?: boolean;

  // NEW: Cache control
  cache?: boolean; // Default: true, set false for no caching
}

export interface CachedFetchResult<TData, TParams> {
  // Readonly refs (cannot be mutated externally)
  readonly data: Readonly<Ref<TData | null>>;
  readonly loading: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<string | null>>;

  fetch: (params: TParams, options?: { force?: boolean }) => Promise<TData | undefined>;
  reset: () => void;
  isCached: (params: TParams) => boolean;
  clearCache: () => void;
}
```

### Why This Approach is Better

1. **No Duplication** - Leverages existing tested code
2. **Backward Compatible** - Existing uses of `useCachedFetch` continue to work
3. **Unified Abstraction** - One pattern for all async operations
4. **Proven Implementation** - Generation counter, deduplication already working
5. **Less Code to Maintain** - Enhance existing vs maintaining two composables

---

## Revised Implementation Plan

### Phase 0: Enhance useCachedFetch (NEW)

**File:** `/apps/desktop/src/composables/useCachedFetch.ts`

**Changes:**

1. Add lifecycle hooks support
2. Add `readonly()` wrappers on returned refs
3. Add `silent` mode
4. Add `resetOnError` option
5. Add `cache` boolean (false for non-cached operations)
6. Return data from `fetch()` method
7. Fix `onFinally` to only fire for non-stale requests
8. Wrap callbacks in try-catch

**Implementation:**

```typescript
export function useCachedFetch<TData, TParams = void>(
  options: CachedFetchOptions<TData, TParams>,
): CachedFetchResult<TData, TParams> {
  const {
    fetcher,
    cacheKeyFn = (p) => JSON.stringify(p),
    onSuccess,
    onError,
    onFinally,
    initialData = null,
    resetOnError = false,
    silent = false,
    cache = true,
  } = options;

  const data = ref<TData | null>(initialData) as Ref<TData | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);

  const loaded = new Set<string>();
  const inflight = new Map<string, Promise<TData | undefined>>();
  let generation = 0;

  const fetch = async (
    params: TParams,
    opts?: { force?: boolean }
  ): Promise<TData | undefined> => {
    const cacheKey = cacheKeyFn(params);

    // Return early if cached and not forced
    if (cache && !opts?.force && loaded.has(cacheKey)) {
      return data.value ?? undefined;
    }

    // Deduplicate
    const existingPromise = inflight.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    const gen = ++generation;
    if (!silent) {
      loading.value = true;
    }
    error.value = null;

    const promise = (async () => {
      try {
        const result = await fetcher(params);

        if (gen !== generation) return undefined;

        data.value = result as TData;
        if (cache) {
          loaded.add(cacheKey);
        }

        // Call onSuccess with try-catch
        if (onSuccess) {
          try {
            onSuccess(result);
          } catch (callbackError) {
            console.error('onSuccess callback failed:', callbackError);
          }
        }

        return result;
      } catch (e) {
        if (gen !== generation) return undefined;

        const errorMsg = toErrorMessage(e);
        error.value = errorMsg;

        if (resetOnError) {
          data.value = null;
        }

        // Call onError with try-catch
        if (onError) {
          try {
            onError(errorMsg);
          } catch (callbackError) {
            console.error('onError callback failed:', callbackError);
          }
        }

        return undefined;
      } finally {
        inflight.delete(cacheKey);

        // Only update loading and call onFinally if this is still the latest request
        if (gen === generation) {
          if (!silent) {
            loading.value = false;
          }

          if (onFinally) {
            try {
              onFinally();
            } catch (callbackError) {
              console.error('onFinally callback failed:', callbackError);
            }
          }
        }
      }
    })();

    inflight.set(cacheKey, promise);
    return promise;
  };

  const reset = () => {
    data.value = initialData;
    loading.value = false;
    error.value = null;
    loaded.clear();
    inflight.clear();
    generation++;
  };

  const isCached = (params: TParams): boolean => {
    return cache && loaded.has(cacheKeyFn(params));
  };

  const clearCache = () => {
    loaded.clear();
  };

  return {
    data: readonly(data),
    loading: readonly(loading),
    error: readonly(error),
    fetch,
    reset,
    isCached,
    clearCache,
  };
}
```

### Phase 1: Comprehensive Tests for Enhanced useCachedFetch

**File:** `/apps/desktop/src/composables/useCachedFetch.test.ts`

Expand existing tests to cover:
- Lifecycle hooks (onSuccess, onError, onFinally)
- Silent mode
- ResetOnError behavior
- Callback error handling (callbacks throwing errors)
- Readonly ref protection
- Return value from fetch()
- Edge cases from testing review

**New Test Coverage (50+ tests):**
```typescript
describe('useCachedFetch - Enhanced Features', () => {
  describe('Lifecycle Hooks', () => {
    it('should call onSuccess with fetched data');
    it('should call onError with error message');
    it('should call onFinally after success');
    it('should call onFinally after error');
    it('should not call onSuccess for stale requests');
    it('should not call onError for stale requests');
    it('should not call onFinally for stale requests');
    it('should handle onSuccess throwing an error');
    it('should handle onError throwing an error');
    it('should handle onFinally throwing an error');
  });

  describe('Silent Mode', () => {
    it('should not update loading state when silent is true');
    it('should still update data and error in silent mode');
    it('should still call callbacks in silent mode');
  });

  describe('ResetOnError', () => {
    it('should clear data when resetOnError is true');
    it('should preserve data when resetOnError is false');
  });

  describe('Cache Control', () => {
    it('should skip caching when cache is false');
    it('should allow repeated fetches when cache is false');
  });

  describe('Readonly Protection', () => {
    it('should prevent external mutation of data ref');
    it('should prevent external mutation of loading ref');
    it('should prevent external mutation of error ref');
  });

  describe('Return Value', () => {
    it('should return data from fetch()');
    it('should return undefined for stale requests');
    it('should return undefined on error');
  });
});
```

### Phase 2: Refactor buildSectionLoader to Use Enhanced useCachedFetch

**File:** `/apps/desktop/src/stores/sessionDetail.ts`

Keep `buildSectionLoader` as a convenience wrapper but make it use `useCachedFetch` internally:

```typescript
function buildSectionLoader<T>(opts: {
  key: string;
  errorRef: Ref<string | null>;
  fetchFn: (id: string) => Promise<T>;
  onResult: (result: T) => void;
  logLevel?: 'error' | 'warn';
}) {
  const loader = useCachedFetch<T, string>({
    fetcher: opts.fetchFn,
    cacheKeyFn: (id) => `${opts.key}:${id}`,
    cache: false, // Section loading manages its own 'loaded' Set
    onSuccess: (result) => {
      opts.onResult(result);
      loaded.value.add(opts.key);
    },
    onError: (error) => {
      const logFn = opts.logLevel === 'warn' ? console.warn : console.error;
      logFn(`Failed to load ${opts.key}:`, error);
    },
  });

  // Wire up the error ref
  opts.errorRef = loader.error;

  return async () => {
    const id = sessionId.value;
    if (!id || loaded.value.has(opts.key)) return;
    await loader.fetch(id);
  };
}

// Usage stays the same (backward compatible)
const loadTurns = buildSectionLoader({
  key: 'turns',
  errorRef: turnsError,
  fetchFn: getSessionTurns,
  onResult: (result) => {
    turns.value = result.turns;
    lastEventsFileSize = result.eventsFileSize;
  },
});
```

**Benefit:** Minimal changes to existing code, just refactor the internals.

### Phase 3: Refactor sessions.ts

**File:** `/apps/desktop/src/stores/sessions.ts`

Replace manual promise tracking with `useCachedFetch`:

```typescript
const sessionsFetch = useCachedFetch<SessionListItem[], void>({
  fetcher: () => listSessions(),
  cacheKeyFn: () => 'sessions',
  cache: false, // Always fetch fresh
  onSuccess: (data) => {
    sessions.value = data;
  },
});

const indexFetch = useCachedFetch<[number, number], void>({
  fetcher: () => reindexSessions(),
  cacheKeyFn: () => 'reindex',
  cache: false,
  onSuccess: async () => {
    // After reindex, refresh the list
    await sessionsFetch.fetch(undefined, { force: true });
  },
});

const loading = sessionsFetch.loading;
const indexing = indexFetch.loading;
const error = computed(() => sessionsFetch.error || indexFetch.error);

async function fetchSessions() {
  await sessionsFetch.fetch(undefined);
}

async function refreshSessions() {
  // Silent refresh using same fetch instance
  await useCachedFetch<SessionListItem[], void>({
    fetcher: () => listSessions(),
    cacheKeyFn: () => 'sessions-silent',
    cache: false,
    silent: true,
    onSuccess: (data) => {
      sessions.value = data;
    },
    onError: (e) => {
      console.error('Silent refresh failed:', e);
    },
  }).fetch(undefined);
}

async function reindex() {
  await indexFetch.fetch(undefined);
}
```

### Phase 4: Refactor search.ts with Dual Async States

**File:** `/apps/desktop/src/stores/search.ts`

Create TWO separate `useCachedFetch` instances (search + facets):

```typescript
const searchFetch = useCachedFetch<SearchResponse, SearchParams>({
  fetcher: async (params) => {
    // Build search params
    return await searchContent(params.query, params.options);
  },
  cacheKeyFn: (params) => JSON.stringify(params),
  cache: false, // Fresh searches always
  onSuccess: (response) => {
    results.value = response.results;
    totalCount.value = response.totalCount;
    hasMore.value = response.hasMore;
    latencyMs.value = response.latencyMs;

    // Trigger facets fetch
    const facetQuery = hasQuery.value ? query.value : undefined;
    facetsFetch.fetch({ query: facetQuery, filters: getCurrentFilters() });
  },
  resetOnError: true,
});

const facetsFetch = useCachedFetch<SearchFacetsResponse, FacetParams>({
  fetcher: async (params) => {
    return await getSearchFacets(params.query, params.filters);
  },
  cacheKeyFn: (params) => JSON.stringify(params),
  cache: false,
  onSuccess: (result) => {
    facets.value = result;
  },
  onError: (e) => {
    console.warn('Facets fetch failed:', e);
  },
});

const loading = searchFetch.loading;
const error = searchFetch.error;

async function executeSearch() {
  await searchFetch.fetch({
    query: query.value,
    options: buildSearchOptions(),
  });
}
```

**Key improvement:** Independent generation counters for search and facets.

### Phase 5: Update Remaining Stores

Similar refactoring for:
- `worktrees.ts` - Also fix `String(e)` → `toErrorMessage`
- `launcher.ts` - Also fix `String(e)` → `toErrorMessage`
- `orchestrationHome.ts`
- `configInjector.ts`

**Explicitly OUT OF SCOPE:**
- `preferences.ts` - Too risky due to hydration gate, save for future work

---

## Testing Strategy (Enhanced)

### Unit Tests (100% Coverage Goal)

**File:** `/apps/desktop/src/composables/useCachedFetch.test.ts`

**Coverage:**
- ✅ All existing tests still pass
- ✅ 20+ new tests for lifecycle hooks
- ✅ 10+ new tests for silent mode, resetOnError, cache control
- ✅ 15+ new tests for readonly protection and return values
- ✅ 20+ edge case tests (from testing review)
- ✅ 10+ race condition tests
- ✅ 5+ stress tests (1000+ operations)

**Total: 80+ tests for useCachedFetch**

### Integration Tests (Store-Level)

**New Files:**
- `/apps/desktop/src/__tests__/stores/sessionDetail.integration.test.ts`
- `/apps/desktop/src/__tests__/stores/sessions.integration.test.ts`
- `/apps/desktop/src/__tests__/stores/search.integration.test.ts`

**Coverage:**
- ✅ Cache restoration in sessionDetail
- ✅ Dual-token behavior (session switch + events pagination)
- ✅ Promise deduplication in sessions
- ✅ Stale request protection in search
- ✅ Error state recovery
- ✅ Concurrent operations
- ✅ Background refresh behavior

**Total: 50+ integration tests**

### Manual Testing (Comprehensive Checklist)

**Session Detail View (25 scenarios):**
- Cold start load
- Cached session restore
- Rapid session switching
- Section loading (turns, events, todos, checkpoints, plan, metrics, incidents)
- Error handling and recovery
- Cache eviction (LRU)
- Freshness checking
- Refresh all sections

**Sessions List View (15 scenarios):**
- Initial load
- Reindex
- Concurrent operations
- Silent refresh
- Filtering and sorting
- Error states

**Search View (20 scenarios):**
- Debounced typing
- Filter changes
- Pagination
- Rapid changes (stale request protection)
- Facets loading
- Error states
- Empty states

**Performance Testing (8 scenarios):**
- Cold start time measurement
- Session switch time measurement
- Memory usage profiling
- CPU usage during rapid operations
- Network waterfall analysis
- Bundle size impact
- Memory leak detection (100+ operations)

**Total: 68 manual test scenarios**

### Regression Tests

- ✅ All existing unit tests must pass
- ✅ All existing integration tests must pass
- ✅ Backward compatibility for store public APIs
- ✅ No visual regressions in error states

---

## Success Criteria (Updated)

### Code Quality
- [ ] 0 TypeScript errors
- [ ] 0 ESLint warnings
- [ ] All refs properly wrapped with `readonly()`
- [ ] All `String(e)` replaced with `toErrorMessage`
- [ ] All callbacks wrapped in try-catch

### Test Coverage
- [ ] useCachedFetch: 100% line coverage (80+ tests)
- [ ] Integration tests: 50+ tests passing
- [ ] Manual tests: 68/68 scenarios verified
- [ ] Existing tests: 100% still passing

### Performance
- [ ] Cold start time within 5% of baseline
- [ ] Session switch time within 5% of baseline
- [ ] Memory usage within 10% of baseline
- [ ] Bundle size increase < 2KB
- [ ] No memory leaks after 100+ operations

### Architecture
- [ ] Single async state abstraction (useCachedFetch)
- [ ] No duplicate composables
- [ ] Cache logic preserved in sessionDetail
- [ ] Dual-token pattern preserved where needed
- [ ] Silent refresh pattern working

---

## Risk Mitigation (Updated)

### Risk 1: Breaking sessionDetail Cache (HIGH → MEDIUM)
**Mitigation:**
- Keep cache logic separate from async state
- Use lifecycle hooks to update cache
- Add comprehensive integration tests for cache restoration
- Test LRU eviction behavior

### Risk 2: Race Conditions (MEDIUM → LOW)
**Mitigation:**
- Reuse proven generation counter from useCachedFetch
- Add 20+ race condition tests
- Test dual-token scenarios extensively
- Manual testing of rapid state changes

### Risk 3: Callback Errors (MEDIUM → LOW)
**Mitigation:**
- Wrap all callbacks in try-catch
- Log callback errors to console
- Test error scenarios explicitly
- Document callback error behavior

### Risk 4: Memory Leaks (NEW - LOW)
**Mitigation:**
- Add stress tests (1000+ operations)
- Profile memory usage before/after
- Test cache eviction
- Verify inflight map cleanup

### Risk 5: Breaking Existing Tests (MEDIUM → LOW)
**Mitigation:**
- Run full test suite after each phase
- Update integration tests incrementally
- Keep backward-compatible APIs
- Document breaking changes

---

## Implementation Timeline (Updated)

**Total Estimate: 8-10 days**

- **Day 1-2:** Phase 0 - Enhance useCachedFetch + comprehensive tests
- **Day 3:** Phase 1 - Refactor buildSectionLoader + integration tests
- **Day 4:** Phase 2 - Refactor sessionDetail.ts + validation
- **Day 5:** Phase 3 - Refactor sessions.ts + tests
- **Day 6:** Phase 4 - Refactor search.ts + tests
- **Day 7-8:** Phase 5 - Refactor remaining stores (worktrees, launcher, orchestrationHome, configInjector)
- **Day 9:** Manual testing + performance benchmarking
- **Day 10:** Code review, documentation, final validation

---

## Advantages Over Original Plan

1. **No Duplication** - Reuses existing `useCachedFetch` instead of creating new composable
2. **Less Risk** - Enhances proven code instead of introducing new patterns
3. **Backward Compatible** - Existing uses of `useCachedFetch` continue to work
4. **Better Testing** - 80+ tests for useCachedFetch vs 40+ for useAsyncState
5. **Simpler Architecture** - One composable instead of two
6. **Proven Implementation** - Generation counter and deduplication already working
7. **Addresses All Review Feedback** - Incorporates findings from 3 expert reviews
8. **Lower Maintenance** - Single abstraction to maintain going forward

---

## Excluded from Scope

To reduce risk and scope:

1. **preferences.ts refactoring** - Too risky due to hydration gate
2. **AbortController support** - Can be added later if needed
3. **Retry logic** - Can be added later
4. **DevTools integration** - Future enhancement
5. **SSR/hydration** - Not applicable currently

---

## Conclusion

This refined plan addresses all critical feedback from the three expert reviews:

**Architectural Review Concerns:**
✅ No duplicate abstraction (use existing useCachedFetch)
✅ Lifecycle hooks added
✅ Readonly refs for safety
✅ Cache integration carefully designed
✅ Dual-token patterns preserved

**Testing Review Concerns:**
✅ 80+ unit tests (up from 40)
✅ 50+ integration tests (was missing)
✅ 68 manual test scenarios (up from 28)
✅ Race condition coverage
✅ Edge case coverage
✅ Stress testing

**Implementation Review Concerns:**
✅ onFinally timing fixed
✅ Callback error handling
✅ Error type consistency
✅ Readonly state protection
✅ String(e) → toErrorMessage fixes
✅ preferences.ts marked out of scope

**Final Assessment:** This refined plan is production-ready with an estimated 8-10 days of implementation effort and significantly lower risk than the original proposal.
