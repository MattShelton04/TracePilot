# Store Refactoring Plan: Extract Duplicate Async Fetch Pattern

## Problem Statement

Multiple stores (`analytics.ts`, `search.ts`, `sessions.ts`) contain near-identical patterns for:
1. Request deduplication (inflight promise tracking)
2. Generation counter validation (preventing stale async writes)
3. Error handling and formatting
4. Loading state management
5. Cache key generation and tracking

This creates ~150+ lines of duplicated code across three stores, making maintenance difficult and error-prone.

## Solution: Create `useCachedFetch` Composable

Extract the common async fetch pattern into a reusable composable that handles:
- Request deduplication
- Generation counter validation
- Error state management
- Loading state management
- Cache tracking

## Detailed Implementation Plan

### 1. Create New Composable: `apps/desktop/src/composables/useCachedFetch.ts`

**Purpose:** Provide a generic, type-safe async fetch pattern with caching, deduplication, and generation tracking.

**API Design:**
```typescript
interface CachedFetchOptions<TData, TParams> {
  // The async function to execute
  fetcher: (params: TParams) => Promise<TData>;

  // Optional cache key generator (defaults to JSON.stringify(params))
  cacheKeyFn?: (params: TParams) => string;

  // Whether to skip cache and force fetch
  force?: boolean;
}

interface CachedFetchResult<TData> {
  // Reactive state
  data: Ref<TData | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;

  // Actions
  fetch: (params: TParams, options?: { force?: boolean }) => Promise<void>;
  reset: () => void;

  // Cache info
  isCached: (params: TParams) => boolean;
  clearCache: () => void;
}
```

**Internal Implementation:**
```typescript
export function useCachedFetch<TData, TParams = void>(
  options: CachedFetchOptions<TData, TParams>
): CachedFetchResult<TData> {
  const { fetcher, cacheKeyFn = (p) => JSON.stringify(p) } = options;

  // State
  const data = ref<TData | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Cache tracking
  const loaded = new Set<string>();
  const inflight = new Map<string, Promise<void>>();

  // Generation tracking to prevent stale writes
  let generation = 0;

  const fetch = async (params: TParams, opts?: { force?: boolean }) => {
    const cacheKey = cacheKeyFn(params);

    // Return early if cached and not forced
    if (!opts?.force && loaded.has(cacheKey)) return;

    // Deduplicate: return existing promise if in-flight
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);

    // Start new fetch
    const gen = ++generation;
    loading.value = true;
    error.value = null;

    const promise = (async () => {
      try {
        const result = await fetcher(params);

        // Only update if this is still the latest request
        if (gen !== generation) return;

        data.value = result as TData;
        loaded.add(cacheKey);
      } catch (e) {
        // Only update error if this is still the latest request
        if (gen !== generation) return;

        error.value = e instanceof Error ? e.message : String(e);
      } finally {
        // Clean up inflight tracking
        inflight.delete(cacheKey);

        // Only update loading if this is still the latest request
        if (gen === generation) {
          loading.value = false;
        }
      }
    })();

    inflight.set(cacheKey, promise);
    return promise;
  };

  const reset = () => {
    data.value = null;
    loading.value = false;
    error.value = null;
    loaded.clear();
    inflight.clear();
    generation++;
  };

  const isCached = (params: TParams) => {
    return loaded.has(cacheKeyFn(params));
  };

  const clearCache = () => {
    loaded.clear();
  };

  return {
    data,
    loading,
    error,
    fetch,
    reset,
    isCached,
    clearCache,
  };
}
```

### 2. Refactor `analytics.ts` to Use `useCachedFetch`

**Current Pattern (lines 80-113):**
```typescript
async function fetchAnalytics(options?: { fromDate?: string; toDate?: string; repo?: string; force?: boolean }) {
  const prefs = usePreferencesStore();
  const merged = { ...dateRange.value, ...options };
  const repo = merged.repo ?? selectedRepo.value ?? undefined;
  const hideEmpty = prefs.hideEmptySessions;
  const cacheKey = cacheKeyFor('analytics', { ...merged, repo, hideEmpty });
  if (!options?.force && loaded.has(cacheKey)) return;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const gen = ++analyticsGen;
  analyticsLoading.value = true;
  analyticsError.value = null;
  const promise = (async () => {
    try {
      const result = await getAnalytics({
        fromDate: merged.fromDate,
        toDate: merged.toDate,
        repo,
        hideEmpty,
      });
      if (gen !== analyticsGen) return;
      analytics.value = result;
      loaded.add(cacheKey);
    } catch (e) {
      if (gen !== analyticsGen) return;
      analyticsError.value = e instanceof Error ? e.message : String(e);
    } finally {
      inflight.delete(cacheKey);
      if (gen === analyticsGen) analyticsLoading.value = false;
    }
  })();
  inflight.set(cacheKey, promise);
  return promise;
}
```

**Refactored Version:**
```typescript
// Create typed params interface
interface AnalyticsFetchParams {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
}

// Create cached fetch instances
const analyticsFetcher = useCachedFetch<AnalyticsData, AnalyticsFetchParams>({
  fetcher: (params) => getAnalytics(params),
  cacheKeyFn: (params) => `analytics:${params.fromDate ?? ''}:${params.toDate ?? ''}:${params.repo ?? ''}:${params.hideEmpty ?? ''}`,
});

const toolAnalysisFetcher = useCachedFetch<ToolAnalysisData, AnalyticsFetchParams>({
  fetcher: (params) => getToolAnalysis(params),
  cacheKeyFn: (params) => `toolAnalysis:${params.fromDate ?? ''}:${params.toDate ?? ''}:${params.repo ?? ''}:${params.hideEmpty ?? ''}`,
});

const codeImpactFetcher = useCachedFetch<CodeImpactData, AnalyticsFetchParams>({
  fetcher: (params) => getCodeImpact(params),
  cacheKeyFn: (params) => `codeImpact:${params.fromDate ?? ''}:${params.toDate ?? ''}:${params.repo ?? ''}:${params.hideEmpty ?? ''}`,
});

// Simplified fetch function
async function fetchAnalytics(options?: { fromDate?: string; toDate?: string; repo?: string; force?: boolean }) {
  const prefs = usePreferencesStore();
  const merged = { ...dateRange.value, ...options };
  const params: AnalyticsFetchParams = {
    fromDate: merged.fromDate,
    toDate: merged.toDate,
    repo: merged.repo ?? selectedRepo.value ?? undefined,
    hideEmpty: prefs.hideEmptySessions,
  };

  await analyticsFetcher.fetch(params, { force: options?.force });
}

// Update return to expose fetcher state
return {
  // Use fetcher state instead of local refs
  analytics: analyticsFetcher.data,
  analyticsLoading: analyticsFetcher.loading,
  analyticsError: analyticsFetcher.error,
  toolAnalysis: toolAnalysisFetcher.data,
  toolAnalysisLoading: toolAnalysisFetcher.loading,
  toolAnalysisError: toolAnalysisFetcher.error,
  codeImpact: codeImpactFetcher.data,
  codeImpactLoading: codeImpactFetcher.loading,
  codeImpactError: codeImpactFetcher.error,
  // ... rest of state
};
```

**Benefits:**
- Eliminates ~90 lines of duplicate code
- Centralized error handling
- Type-safe params
- Easier to test
- Consistent behavior across all three fetchers

### 3. Update `$reset()` to Use Fetcher Reset

**Before:**
```typescript
function $reset() {
  analytics.value = null;
  toolAnalysis.value = null;
  codeImpact.value = null;
  analyticsLoading.value = false;
  toolAnalysisLoading.value = false;
  codeImpactLoading.value = false;
  analyticsError.value = null;
  toolAnalysisError.value = null;
  codeImpactError.value = null;
  selectedRepo.value = null;
  selectedTimeRange.value = 'all';
  customFromDate.value = undefined;
  customToDate.value = undefined;
  loaded.clear();
}
```

**After:**
```typescript
function $reset() {
  analyticsFetcher.reset();
  toolAnalysisFetcher.reset();
  codeImpactFetcher.reset();
  selectedRepo.value = null;
  selectedTimeRange.value = 'all';
  customFromDate.value = undefined;
  customToDate.value = undefined;
}
```

### 4. Update Cache Invalidation in Watch

**Before:**
```typescript
watch(() => prefs.hideEmptySessions, () => {
  loaded.clear();
});
```

**After:**
```typescript
watch(() => prefs.hideEmptySessions, () => {
  analyticsFetcher.clearCache();
  toolAnalysisFetcher.clearCache();
  codeImpactFetcher.clearCache();
});
```

### 5. Consider Similar Refactoring for `sessions.ts` (Optional)

The `sessions.ts` store has a simpler pattern (module-level promise deduplication) that could benefit from a lighter-weight version of `useCachedFetch`:

**Current:**
```typescript
let fetchPromise: Promise<void> | null = null;
let indexingPromise: Promise<[number, number]> | null = null;

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

**Could Become:**
```typescript
const sessionsFetcher = useCachedFetch<SessionListItem[], void>({
  fetcher: () => listSessions(),
  cacheKeyFn: () => 'sessions', // Single cache key since no params
});

async function fetchSessions() {
  await sessionsFetcher.fetch(undefined);
}
```

However, `sessions.ts` has unique requirements (silent refresh, indexing state) so we may keep the current pattern or create a specialized variant.

## Files to Modify

1. **Create:**
   - `/apps/desktop/src/composables/useCachedFetch.ts` (new file, ~150 lines)

2. **Modify:**
   - `/apps/desktop/src/stores/analytics.ts` (reduce from 260 → ~180 lines)
   - `/apps/desktop/src/composables/index.ts` (if exists, export new composable)

3. **Optional (future iteration):**
   - `/apps/desktop/src/stores/sessions.ts` (if pattern fits)

## Testing Strategy

### 1. Unit Tests for `useCachedFetch`

Create `/apps/desktop/src/__tests__/composables/useCachedFetch.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { useCachedFetch } from '@/composables/useCachedFetch';

describe('useCachedFetch', () => {
  it('should fetch data successfully', async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
    const { data, loading, error, fetch } = useCachedFetch({ fetcher });

    expect(loading.value).toBe(false);
    expect(data.value).toBe(null);

    await fetch(undefined);

    expect(loading.value).toBe(false);
    expect(data.value).toEqual({ data: 'test' });
    expect(error.value).toBe(null);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('should cache results and not refetch', async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
    const { fetch } = useCachedFetch({ fetcher });

    await fetch({ id: 1 });
    await fetch({ id: 1 }); // Should use cache

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('should deduplicate concurrent requests', async () => {
    let resolvePromise: (value: any) => void;
    const fetcher = vi.fn(() => new Promise(resolve => { resolvePromise = resolve; }));
    const { fetch } = useCachedFetch({ fetcher });

    const promise1 = fetch({ id: 1 });
    const promise2 = fetch({ id: 1 });

    expect(fetcher).toHaveBeenCalledTimes(1);

    resolvePromise!({ data: 'test' });
    await Promise.all([promise1, promise2]);
  });

  it('should handle errors', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Fetch failed'));
    const { data, error, fetch } = useCachedFetch({ fetcher });

    await fetch(undefined);

    expect(data.value).toBe(null);
    expect(error.value).toBe('Fetch failed');
  });

  it('should prevent stale writes with generation counter', async () => {
    let resolvers: Array<(value: any) => void> = [];
    const fetcher = vi.fn(() => new Promise(resolve => resolvers.push(resolve)));
    const { data, fetch } = useCachedFetch({ fetcher });

    // Start first request
    const req1 = fetch({ id: 1 });
    // Start second request (newer generation)
    const req2 = fetch({ id: 2 });

    // Resolve second request first
    resolvers[1]({ value: 'second' });
    await req2;

    // Resolve first request (should be ignored as stale)
    resolvers[0]({ value: 'first' });
    await req1;

    expect(data.value).toEqual({ value: 'second' });
  });

  it('should force refetch when force: true', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ data: 'first' })
      .mockResolvedValueOnce({ data: 'second' });
    const { data, fetch } = useCachedFetch({ fetcher });

    await fetch({ id: 1 });
    expect(data.value).toEqual({ data: 'first' });

    await fetch({ id: 1 }); // Cached
    expect(fetcher).toHaveBeenCalledTimes(1);

    await fetch({ id: 1 }, { force: true }); // Force refetch
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(data.value).toEqual({ data: 'second' });
  });

  it('should reset state correctly', async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
    const { data, error, fetch, reset } = useCachedFetch({ fetcher });

    await fetch(undefined);
    expect(data.value).toEqual({ data: 'test' });

    reset();
    expect(data.value).toBe(null);
    expect(error.value).toBe(null);

    // Should refetch after reset
    await fetch(undefined);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
```

### 2. Integration Tests for Refactored `analytics.ts`

Update existing tests in `/apps/desktop/src/__tests__/stores/analytics.test.ts` to verify behavior remains identical.

### 3. Manual Testing Checklist

After implementation, verify:
- [ ] Analytics Dashboard View loads correctly
- [ ] Tool Analysis View loads correctly
- [ ] Code Impact View loads correctly
- [ ] Time range filter changes trigger refetch
- [ ] Repository filter changes trigger refetch
- [ ] Force refresh works (refreshAll action)
- [ ] Cache invalidation works when hideEmptySessions changes
- [ ] No duplicate network requests on rapid filter changes
- [ ] Error states display correctly
- [ ] Loading states display correctly
- [ ] Navigation away and back uses cache
- [ ] TypeScript compilation succeeds
- [ ] All existing tests pass

## Implementation Order

1. **Phase 1: Create Composable**
   - Create `useCachedFetch.ts`
   - Write unit tests
   - Export from composables index

2. **Phase 2: Refactor Analytics Store**
   - Refactor `analytics.ts` to use `useCachedFetch`
   - Update existing analytics tests
   - Run manual testing

3. **Phase 3: Validation**
   - Run full test suite
   - Run type checking
   - Test in UI manually

4. **Phase 4: Review & Iterate (with subagents)**
   - Spawn review subagents
   - Address feedback
   - Final validation

## Success Metrics

- **Code Reduction:** ~90 lines removed from `analytics.ts`
- **Test Coverage:** `useCachedFetch` has >90% coverage
- **No Behavior Changes:** All existing tests pass
- **Type Safety:** No TypeScript errors
- **Performance:** No regression in fetch performance

## Risk Mitigation

1. **Breaking Existing Behavior:** Comprehensive test suite ensures compatibility
2. **Type Safety Issues:** TypeScript generics ensure type safety
3. **Performance Regression:** Generation counter and deduplication maintain performance
4. **Testing Gaps:** Unit tests cover all edge cases

## Future Enhancements

After this refactoring succeeds, we could:
1. Apply pattern to other stores with similar needs
2. Add optional request debouncing to `useCachedFetch`
3. Add optional LRU cache eviction policy
4. Add cache persistence (localStorage)
5. Add request cancellation support (AbortController)

## Summary

This refactoring provides:
- ✅ **Reduced duplication** - Single source of truth for async fetch pattern
- ✅ **Better testability** - Isolated, unit-testable composable
- ✅ **Type safety** - Full TypeScript support with generics
- ✅ **Maintainability** - Centralized error handling and state management
- ✅ **Consistency** - All stores use same pattern
- ✅ **Low risk** - No external behavior changes, comprehensive tests
- ✅ **Foundation** - Enables future improvements across codebase
