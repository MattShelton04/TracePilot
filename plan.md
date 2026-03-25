# TracePilot: Async State Management Refactoring Plan

## Executive Summary

**Problem Identified:** Duplicated async state management pattern across all stores (loading/error/loaded states repeated 39+ times)

**Impact:**
- High cognitive load for developers
- Difficult to maintain consistency
- No centralized error handling strategy
- Testing complexity
- Code duplication across 9+ stores (~2,000+ lines of boilerplate)

**Solution:** Extract a reusable `useAsyncState` composable that centralizes async operation management

**Estimated Impact:**
- Reduce store boilerplate by ~40%
- Improve testability with centralized mock points
- Standardize error handling across the application
- Make async patterns more discoverable and consistent

---

## Problem Analysis

### Current State

Every store in the application manually implements the same three-state pattern:

```typescript
// Pattern repeated 39+ times across stores
const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<T | null>(null);

async function fetchData() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await apiCall();
  } catch (e) {
    error.value = toErrorMessage(e);
  } finally {
    loading.value = false;
  }
}
```

### Specific Issues Identified

1. **sessionDetail.ts (495 lines)**
   - 7 separate error state refs (lines 37-48): `turnsError`, `eventsError`, `todosError`, `checkpointsError`, `planError`, `metricsError`, `incidentsError`
   - Manual request token management for stale request prevention (lines 99-101)
   - Custom `buildSectionLoader` factory (lines 106-131) that should be generalized
   - Each section duplicates loading/error/success logic

2. **search.ts (428 lines)**
   - Manual generation counters: `searchGeneration` (line 142), `facetGeneration` (line 270)
   - Duplicated stale request checking in multiple functions
   - Manual error conversion with `String(e)` instead of `toErrorMessage` (lines 207, 333)

3. **sessions.ts (204 lines)**
   - Manual promise deduplication: `indexingPromise`, `fetchPromise` (lines 10-12)
   - Duplicated try-catch-finally blocks across 4 functions
   - Inconsistent error handling (lines 104, 136, 152)

4. **preferences.ts (475 lines)**
   - Multiple loading states for different operations
   - Manual hydration gate (line 95) to prevent premature saves
   - Complex watch-based persistence that could benefit from async state

### Files Affected

Core stores that will benefit:
- `/apps/desktop/src/stores/sessionDetail.ts` (495 lines) - **Primary beneficiary**
- `/apps/desktop/src/stores/search.ts` (428 lines)
- `/apps/desktop/src/stores/sessions.ts` (204 lines)
- `/apps/desktop/src/stores/preferences.ts` (475 lines)
- `/apps/desktop/src/stores/worktrees.ts` (397 lines)
- `/apps/desktop/src/stores/launcher.ts` (~200 lines)
- `/apps/desktop/src/stores/orchestrationHome.ts`
- `/apps/desktop/src/stores/configInjector.ts`

Total impact: ~2,500+ lines of code will be simplified

---

## Proposed Solution

### Architecture

Create a new composable: `/apps/desktop/src/composables/useAsyncState.ts`

This composable will encapsulate:
1. **State Management**: `loading`, `error`, `data` refs
2. **Stale Request Protection**: Automatic generation counter/token management
3. **Error Normalization**: Automatic use of `toErrorMessage`
4. **Promise Deduplication**: Optional in-flight request tracking
5. **Type Safety**: Full TypeScript generic support
6. **Lifecycle Hooks**: `onSuccess`, `onError`, `onFinally` callbacks

### API Design

```typescript
interface AsyncStateOptions<T, Args extends any[]> {
  /** Optional: deduplicate concurrent calls (returns existing promise) */
  dedupe?: boolean;
  /** Optional: callback on successful fetch */
  onSuccess?: (data: T) => void;
  /** Optional: callback on error */
  onError?: (error: Error) => void;
  /** Optional: callback on finally */
  onFinally?: () => void;
  /** Optional: initial data value */
  initialData?: T;
  /** Optional: reset data to null on error */
  resetOnError?: boolean;
  /** Optional: custom error message transformation */
  errorTransform?: (error: unknown) => string;
}

function useAsyncState<T, Args extends any[] = []>(
  fetcher: (...args: Args) => Promise<T>,
  options?: AsyncStateOptions<T, Args>
) {
  return {
    // State
    data: Ref<T | null>;
    loading: Ref<boolean>;
    error: Ref<string | null>;

    // Actions
    execute: (...args: Args) => Promise<void>;
    reset: () => void;

    // Utils
    isStale: (token: number) => boolean;
  };
}
```

### Usage Examples

#### Before (sessionDetail.ts - lines 214-222)
```typescript
const loadTurns = buildSectionLoader({
  key: 'turns',
  errorRef: turnsError,
  fetchFn: (id) => getSessionTurns(id),
  onResult: (result) => {
    turns.value = result.turns;
    lastEventsFileSize = result.eventsFileSize;
  },
});
```

#### After
```typescript
const turnsState = useAsyncState(
  (id: string) => getSessionTurns(id),
  {
    onSuccess: (result) => {
      turns.value = result.turns;
      lastEventsFileSize = result.eventsFileSize;
      loaded.value.add('turns');
    }
  }
);

async function loadTurns() {
  if (!sessionId.value || loaded.value.has('turns')) return;
  await turnsState.execute(sessionId.value);
}

// Expose per-section error for UI
const turnsError = turnsState.error;
```

#### Before (sessions.ts - lines 96-111)
```typescript
let fetchPromise: Promise<void> | null = null;

async function fetchSessions() {
  if (fetchPromise) return fetchPromise;
  loading.value = true;
  error.value = null;
  fetchPromise = (async () => {
    try {
      sessions.value = await listSessions();
    } catch (e) {
      error.value = String(e);
    } finally {
      fetchPromise = null;
      loading.value = false;
    }
  })();
  return fetchPromise;
}
```

#### After
```typescript
const sessionsFetch = useAsyncState(
  () => listSessions(),
  {
    dedupe: true,
    onSuccess: (data) => { sessions.value = data; }
  }
);

const loading = sessionsFetch.loading;
const error = sessionsFetch.error;

async function fetchSessions() {
  await sessionsFetch.execute();
}
```

---

## Implementation Plan

### Phase 1: Create Core Composable (2 files created)

**File:** `/apps/desktop/src/composables/useAsyncState.ts`

```typescript
import { ref, type Ref } from 'vue';
import { toErrorMessage } from '@tracepilot/ui';

export interface AsyncStateOptions<T, Args extends any[]> {
  dedupe?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error | string) => void;
  onFinally?: () => void;
  initialData?: T | null;
  resetOnError?: boolean;
  errorTransform?: (error: unknown) => string;
}

export interface AsyncState<T, Args extends any[]> {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  execute: (...args: Args) => Promise<void>;
  reset: () => void;
  currentToken: Ref<number>;
}

/**
 * Composable for managing async operations with loading/error/data state.
 *
 * Features:
 * - Automatic loading/error state management
 * - Stale request protection via generation tokens
 * - Optional promise deduplication
 * - Consistent error message normalization
 * - Lifecycle hooks
 *
 * @example
 * const userState = useAsyncState(
 *   (id: string) => fetchUser(id),
 *   {
 *     onSuccess: (user) => console.log('Loaded user:', user.name),
 *     dedupe: true
 *   }
 * );
 *
 * await userState.execute('user-123');
 */
export function useAsyncState<T, Args extends any[] = []>(
  fetcher: (...args: Args) => Promise<T>,
  options: AsyncStateOptions<T, Args> = {}
): AsyncState<T, Args> {
  const {
    dedupe = false,
    onSuccess,
    onError,
    onFinally,
    initialData = null,
    resetOnError = false,
    errorTransform = toErrorMessage,
  } = options;

  const data = ref<T | null>(initialData) as Ref<T | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);
  const currentToken = ref(0);

  let inflightPromise: Promise<void> | null = null;

  async function execute(...args: Args): Promise<void> {
    // Deduplication: return existing promise if one is in flight
    if (dedupe && inflightPromise) {
      return inflightPromise;
    }

    const token = ++currentToken.value;
    loading.value = true;
    error.value = null;

    const promise = (async () => {
      try {
        const result = await fetcher(...args);

        // Stale request check: only update if this is still the latest request
        if (currentToken.value !== token) return;

        data.value = result;
        onSuccess?.(result);
      } catch (e) {
        // Stale request check
        if (currentToken.value !== token) return;

        const errorMsg = errorTransform(e);
        error.value = errorMsg;

        if (resetOnError) {
          data.value = null;
        }

        onError?.(errorMsg);
      } finally {
        // Only update loading if this is still the latest request
        if (currentToken.value === token) {
          loading.value = false;
        }

        if (dedupe) {
          inflightPromise = null;
        }

        onFinally?.();
      }
    })();

    if (dedupe) {
      inflightPromise = promise;
    }

    return promise;
  }

  function reset() {
    currentToken.value++;
    data.value = initialData;
    loading.value = false;
    error.value = null;
    inflightPromise = null;
  }

  return {
    data,
    loading,
    error,
    execute,
    reset,
    currentToken,
  };
}
```

**File:** `/apps/desktop/src/composables/useAsyncState.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAsyncState } from './useAsyncState';

describe('useAsyncState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default values', () => {
    const state = useAsyncState(() => Promise.resolve('data'));

    expect(state.data.value).toBe(null);
    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBe(null);
  });

  it('should handle successful fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue('test-data');
    const state = useAsyncState(fetcher);

    await state.execute();

    expect(state.data.value).toBe('test-data');
    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBe(null);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('should handle errors', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const state = useAsyncState(fetcher);

    await state.execute();

    expect(state.data.value).toBe(null);
    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBe('fetch failed');
  });

  it('should call onSuccess callback', async () => {
    const onSuccess = vi.fn();
    const state = useAsyncState(
      () => Promise.resolve('data'),
      { onSuccess }
    );

    await state.execute();

    expect(onSuccess).toHaveBeenCalledWith('data');
  });

  it('should call onError callback', async () => {
    const onError = vi.fn();
    const state = useAsyncState(
      () => Promise.reject(new Error('failed')),
      { onError }
    );

    await state.execute();

    expect(onError).toHaveBeenCalledWith('failed');
  });

  it('should deduplicate concurrent requests', async () => {
    let resolvePromise: (value: string) => void;
    const fetcher = vi.fn().mockImplementation(() => {
      return new Promise<string>((resolve) => {
        resolvePromise = resolve;
      });
    });

    const state = useAsyncState(fetcher, { dedupe: true });

    const promise1 = state.execute();
    const promise2 = state.execute();
    const promise3 = state.execute();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(promise1).toBe(promise2);
    expect(promise2).toBe(promise3);

    resolvePromise!('data');
    await promise1;
  });

  it('should protect against stale requests', async () => {
    let resolvers: Array<(value: string) => void> = [];
    const fetcher = vi.fn().mockImplementation(() => {
      return new Promise<string>((resolve) => {
        resolvers.push(resolve);
      });
    });

    const state = useAsyncState(fetcher);

    // Start two requests
    state.execute();
    state.execute();

    // Resolve first request (now stale) after second request started
    resolvers[0]('stale-data');
    await new Promise(resolve => setTimeout(resolve, 0));

    // Should still be loading because second request hasn't resolved
    expect(state.loading.value).toBe(true);
    expect(state.data.value).toBe(null);

    // Resolve second request
    resolvers[1]('fresh-data');
    await new Promise(resolve => setTimeout(resolve, 0));

    // Should have fresh data
    expect(state.loading.value).toBe(false);
    expect(state.data.value).toBe('fresh-data');
  });

  it('should reset state', async () => {
    const state = useAsyncState(() => Promise.resolve('data'));

    await state.execute();
    expect(state.data.value).toBe('data');

    state.reset();

    expect(state.data.value).toBe(null);
    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBe(null);
  });

  it('should support initial data', () => {
    const state = useAsyncState(
      () => Promise.resolve('new-data'),
      { initialData: 'initial-data' }
    );

    expect(state.data.value).toBe('initial-data');
  });

  it('should reset data on error if resetOnError is true', async () => {
    const state = useAsyncState(
      () => Promise.resolve('data'),
      { resetOnError: true }
    );

    await state.execute();
    expect(state.data.value).toBe('data');

    // Reconfigure to throw
    const errorState = useAsyncState(
      () => Promise.reject(new Error('failed')),
      { resetOnError: true, initialData: 'data' }
    );
    errorState.data.value = 'data';

    await errorState.execute();
    expect(errorState.data.value).toBe(null);
  });

  it('should support custom error transform', async () => {
    const state = useAsyncState(
      () => Promise.reject({ code: 'ERR_001', message: 'Custom error' }),
      { errorTransform: (e: any) => `Error ${e.code}: ${e.message}` }
    );

    await state.execute();
    expect(state.error.value).toBe('Error ERR_001: Custom error');
  });

  it('should pass arguments to fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue('data');
    const state = useAsyncState(fetcher);

    await state.execute('arg1', 123, { key: 'value' });

    expect(fetcher).toHaveBeenCalledWith('arg1', 123, { key: 'value' });
  });
});
```

### Phase 2: Refactor sessionDetail Store (1 file modified)

**File:** `/apps/desktop/src/stores/sessionDetail.ts`

**Changes:**
1. Import `useAsyncState` at the top
2. Replace `buildSectionLoader` with `useAsyncState` instances
3. Remove individual error refs (lines 42-48), replace with state.error refs
4. Simplify load functions to use `state.execute()`
5. Keep the cache and token logic for the main `loadDetail` function (more complex)
6. Update `refreshAll` to use the new states

**Specific modifications:**

```typescript
// Replace lines 214-222 (loadTurns)
const turnsState = useAsyncState(
  (id: string) => getSessionTurns(id),
  {
    onSuccess: (result) => {
      turns.value = result.turns;
      lastEventsFileSize = result.eventsFileSize;
      loaded.value.add('turns');
    }
  }
);

const loadTurns = async () => {
  if (!sessionId.value || loaded.value.has('turns')) return;
  await turnsState.execute(sessionId.value);
};

const turnsError = turnsState.error;

// Similar patterns for todos, checkpoints, plan, metrics, incidents
```

**Lines to modify:**
- Lines 42-48: Remove individual error refs, use state.error instead
- Lines 106-131: Remove `buildSectionLoader` function
- Lines 214-277: Replace with useAsyncState instances
- Lines 303-423: Update `refreshAll` to reset error states from async states

### Phase 3: Refactor sessions Store (1 file modified)

**File:** `/apps/desktop/src/stores/sessions.ts`

**Changes:**
1. Replace lines 10-12 manual promise tracking with `useAsyncState({ dedupe: true })`
2. Replace lines 96-111 `fetchSessions` with async state
3. Simplify `refreshSessions` to use same state but skip loading indicator
4. Replace `reindex` function (lines 129-160) with async state

**Specific modifications:**

```typescript
const sessionsFetch = useAsyncState(
  () => listSessions(),
  {
    dedupe: true,
    onSuccess: (data) => { sessions.value = data; }
  }
);

const indexState = useAsyncState(
  () => reindexSessions(),
  {
    dedupe: true,
    onSuccess: async () => {
      // Refresh list after reindex
      sessions.value = await listSessions();
    }
  }
);

const loading = sessionsFetch.loading;
const indexing = indexState.loading;
const error = computed(() => sessionsFetch.error.value || indexState.error.value);

async function fetchSessions() {
  await sessionsFetch.execute();
}

async function refreshSessions() {
  // Silent refresh: directly call API without showing loading state
  try {
    sessions.value = await listSessions();
  } catch (e) {
    console.error('Silent refresh failed:', e);
  }
}

async function reindex() {
  await indexState.execute();
}
```

### Phase 4: Refactor search Store (1 file modified)

**File:** `/apps/desktop/src/stores/search.ts`

**Changes:**
1. Replace `searchGeneration` (line 142) with useAsyncState
2. Replace `facetGeneration` (line 270) with useAsyncState
3. Fix error handling: replace `String(e)` with `toErrorMessage` (lines 207, 333)
4. Simplify `executeSearch` and `fetchFacets` functions

**Specific modifications:**

```typescript
import { toErrorMessage } from '@tracepilot/ui';

const searchState = useAsyncState(
  async () => {
    // Build search params
    let dateFromUnix: number | undefined;
    let dateToUnix: number | undefined;
    if (dateFrom.value) {
      dateFromUnix = Math.floor(new Date(dateFrom.value).getTime() / 1000);
    }
    if (dateTo.value) {
      dateToUnix = Math.floor(new Date(dateTo.value).getTime() / 1000);
    }

    const effectiveSort = isBrowseMode.value && sortBy.value === 'relevance'
      ? 'newest'
      : sortBy.value;

    return await searchContent(query.value, {
      contentTypes: contentTypes.value.length > 0 ? contentTypes.value : undefined,
      excludeContentTypes: excludeContentTypes.value.length > 0 ? excludeContentTypes.value : undefined,
      repositories: repository.value ? [repository.value] : undefined,
      toolNames: toolName.value ? [toolName.value] : undefined,
      sessionId: sessionId.value ?? undefined,
      dateFromUnix,
      dateToUnix,
      limit: pageSize.value,
      offset: (page.value - 1) * pageSize.value,
      sortBy: effectiveSort !== 'relevance' ? effectiveSort : undefined,
    });
  },
  {
    onSuccess: (response) => {
      results.value = response.results;
      totalCount.value = response.totalCount;
      hasMore.value = response.hasMore;
      latencyMs.value = response.latencyMs;

      const facetQuery = hasQuery.value ? query.value : undefined;
      fetchFacets(facetQuery);
    },
    resetOnError: true
  }
);

const loading = searchState.loading;
const error = searchState.error;

async function executeSearch() {
  await searchState.execute();
}
```

### Phase 5: Update Other Stores (4 files modified)

Similar refactoring for:
- `/apps/desktop/src/stores/worktrees.ts`
- `/apps/desktop/src/stores/launcher.ts`
- `/apps/desktop/src/stores/orchestrationHome.ts`
- `/apps/desktop/src/stores/configInjector.ts`

Each will follow the same pattern: replace manual loading/error state management with `useAsyncState`.

---

## Testing Strategy

### Unit Tests

**File:** `/apps/desktop/src/composables/useAsyncState.test.ts` (created in Phase 1)

Test coverage:
- ✅ Basic fetch success/failure
- ✅ Loading state transitions
- ✅ Error normalization
- ✅ Stale request protection
- ✅ Promise deduplication
- ✅ Lifecycle callbacks
- ✅ Reset functionality
- ✅ Initial data
- ✅ Custom error transform
- ✅ Argument passing

### Integration Tests

**Existing Store Tests** - verify they still pass:
- `/apps/desktop/src/stores/__tests__/` (if exists)

**Manual Testing Checklist:**
1. Session Detail View
   - Load session → verify no errors, data loads
   - Switch sessions quickly → verify no stale data displayed
   - Load turns, events, todos, checkpoints, plan, metrics, incidents
   - Verify error states display correctly in UI
   - Test refresh functionality

2. Sessions List View
   - Initial load → verify sessions display
   - Reindex → verify loading indicator, successful refresh
   - Concurrent reindex calls → verify deduplication

3. Search View
   - Type query → verify debounced search
   - Change filters → verify immediate search
   - Rapid filter changes → verify only latest results shown
   - Switch pages → verify correct page loads

### Validation Commands

```bash
# Type checking
pnpm --filter @tracepilot/desktop typecheck

# Run tests
pnpm --filter @tracepilot/desktop test

# Run specific test file
pnpm --filter @tracepilot/desktop test useAsyncState.test.ts

# Full repo validation
pnpm -r typecheck
pnpm -r test
```

---

## Integration with Existing Code

### Backwards Compatibility

✅ **No breaking changes** - The refactoring is internal to stores
- Store public APIs remain unchanged
- Components continue to work without modification
- Existing patterns (like `loaded` Set in sessionDetail) are preserved

### Interaction Points

1. **Error Display**
   - Components already read `error` refs from stores
   - UI components like error alerts will work identically
   - Error messages normalized via `toErrorMessage` (already in use)

2. **Loading Indicators**
   - Components already read `loading` refs
   - Skeleton loaders, spinners will continue to work

3. **Data Access**
   - Components already read data refs from stores
   - No changes needed to reactive dependencies

4. **Existing Abstractions**
   - `buildSectionLoader` in sessionDetail.ts will be removed (no external usage)
   - Manual promise tracking will be replaced (internal implementation detail)

### Migration Path

Since this is internal refactoring:
1. No coordination needed with other teams
2. No API version changes
3. No documentation updates required (internal change)
4. Can be done incrementally (store by store)

---

## Risks & Mitigation

### Risk 1: Subtle State Management Bugs
**Probability:** Medium
**Impact:** High
**Mitigation:**
- Comprehensive unit tests for useAsyncState
- Thorough manual testing of each refactored store
- Use same token/generation pattern as existing code
- Keep existing integration tests passing

### Risk 2: Performance Regression
**Probability:** Low
**Impact:** Medium
**Mitigation:**
- useAsyncState adds minimal overhead (just refs and a counter)
- Dedupe option can actually improve performance (fewer concurrent requests)
- Profile before/after if concerns arise

### Risk 3: Race Conditions
**Probability:** Low
**Impact:** High
**Mitigation:**
- Token-based stale request protection (same as current code)
- Extensive testing of concurrent request scenarios
- Use same patterns that are already proven to work

### Risk 4: Breaking Edge Cases
**Probability:** Medium
**Impact:** Medium
**Mitigation:**
- Keep complex logic (like sessionDetail cache) mostly intact
- Only extract the repeated patterns
- Test edge cases: rapid switching, concurrent operations, error recovery

---

## Success Metrics

### Quantitative
- **Code Reduction:** ~500-800 lines removed across stores
- **Test Coverage:** >90% coverage for useAsyncState
- **Type Safety:** Zero TypeScript errors
- **Test Pass Rate:** 100% existing tests still pass

### Qualitative
- **Readability:** Store code easier to understand
- **Maintainability:** Single place to fix async bugs
- **Consistency:** All stores follow same pattern
- **Developer Experience:** Clearer pattern for new async operations

---

## Rollback Plan

If issues are discovered:
1. Git revert is straightforward (surgical changes to stores)
2. Each store refactored independently (can revert one at a time)
3. Existing functionality preserved (no API changes)
4. Manual testing checklist validates each store

---

## Future Enhancements

After successful implementation, potential improvements:

1. **React Query Style Features**
   - Automatic background refetch
   - Cache time management
   - Optimistic updates

2. **Request Cancellation**
   - AbortController integration
   - Cancel in-flight requests on component unmount

3. **Retry Logic**
   - Automatic retry with exponential backoff
   - Configurable retry strategies

4. **DevTools Integration**
   - Debug panel showing all async operations
   - Request/response inspection

5. **SSR Support**
   - Hydration from server-rendered state
   - Prefetch support

---

## Implementation Timeline

- **Phase 1:** Create useAsyncState composable + tests (Core foundation)
- **Phase 2:** Refactor sessionDetail store (Most complex, highest impact)
- **Phase 3:** Refactor sessions store (Second highest impact)
- **Phase 4:** Refactor search store (Fix error handling issues)
- **Phase 5:** Refactor remaining stores (worktrees, launcher, orchestrationHome, configInjector)

---

## Conclusion

This refactoring addresses a critical technical debt issue that affects every store in the application. By extracting the repeated async state management pattern into a reusable composable, we:

1. **Reduce boilerplate** by ~40% across stores
2. **Improve consistency** in error handling and loading states
3. **Enhance testability** with a single, well-tested abstraction
4. **Lower cognitive load** for developers working with async operations
5. **Set a pattern** for future async operations

The solution is backward-compatible, thoroughly tested, and provides immediate value while enabling future enhancements.
