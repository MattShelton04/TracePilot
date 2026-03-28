# Refactoring Plan: Generic `useAsyncData` Composable

## Problem Statement

The codebase has a repetitive pattern of managing async operations that appears in **12+ files**:

```typescript
const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<T | null>(null);
const guard = useAsyncGuard();

async function fetchData() {
  const token = guard.start();
  loading.value = true;
  error.value = null;
  try {
    const result = await someApiCall();
    if (!guard.isValid(token)) return;
    data.value = result;
  } catch (e) {
    if (!guard.isValid(token)) return;
    error.value = toErrorMessage(e);
  } finally {
    if (guard.isValid(token)) loading.value = false;
  }
}
```

This pattern creates:
- **Code duplication**: ~20-30 lines repeated across files
- **Maintenance burden**: Changes to async handling require updating all locations
- **Inconsistency**: Some implementations have subtle differences in error handling
- **Testing complexity**: Each implementation needs separate tests for the same behavior

## Affected Files

1. `apps/desktop/src/stores/search.ts` - Multiple loading states (loading, statsLoading, healthLoading)
2. `apps/desktop/src/stores/sessionDetail.ts` - loading + per-section error refs
3. `apps/desktop/src/stores/worktrees.ts` - loading + reposLoading
4. `apps/desktop/src/stores/sessions.ts` - loading + indexing
5. `apps/desktop/src/stores/launcher.ts` - loading state
6. `apps/desktop/src/stores/configInjector.ts` - loading + saving
7. `apps/desktop/src/stores/orchestrationHome.ts` - loading + refreshing
8. `apps/desktop/src/composables/useCachedFetch.ts` - Already complex, could be simplified
9. `apps/desktop/src/composables/useExportPreview.ts` - loading + error
10. `apps/desktop/src/views/SessionComparisonView.vue` - loading + error
11. `apps/desktop/src/views/HealthScoringView.vue` - loading + error
12. `apps/desktop/src/components/SearchPalette.vue` - loading + error

## Solution: Generic `useAsyncData` Composable

### Design Principles

1. **Type-safe**: Full TypeScript support with generics
2. **Flexible**: Support both immediate and manual execution
3. **Composable**: Works alongside existing patterns (can use guards independently)
4. **Minimal**: Zero external dependencies beyond Vue core
5. **Backward compatible**: Can be adopted incrementally

### API Design

```typescript
interface UseAsyncDataOptions<TData, TParams extends unknown[]> {
  /** Initial data value */
  initialData?: TData | null;

  /** Execute immediately on mount */
  immediate?: boolean;

  /** Transform error into message */
  onError?: (error: unknown) => string;

  /** Callback on success */
  onSuccess?: (data: TData) => void;

  /** Enable retry functionality */
  retry?: {
    maxAttempts?: number;
    delay?: number;
  };
}

interface UseAsyncDataReturn<TData, TParams extends unknown[]> {
  /** Reactive data ref */
  data: Ref<TData | null>;

  /** Loading state */
  loading: Ref<boolean>;

  /** Error message */
  error: Ref<string | null>;

  /** Execute the async function */
  execute: (...params: TParams) => Promise<void>;

  /** Refresh (re-execute with last params) */
  refresh: () => Promise<void>;

  /** Clear error */
  clearError: () => void;

  /** Reset to initial state */
  reset: () => void;

  /** Retry last failed operation */
  retry: () => Promise<void>;
}

function useAsyncData<TData, TParams extends unknown[]>(
  asyncFn: (...params: TParams) => Promise<TData>,
  options?: UseAsyncDataOptions<TData, TParams>
): UseAsyncDataReturn<TData, TParams>;
```

### Implementation Plan

#### Phase 1: Create Core Composable (apps/desktop/src/composables/useAsyncData.ts)

**File**: `apps/desktop/src/composables/useAsyncData.ts`
**Estimated LOC**: ~200 lines (including JSDoc)

Key features:
- Generic type parameters for data and function params
- Built-in `useAsyncGuard()` for stale request prevention
- Automatic error handling with `toErrorMessage()` fallback
- Optional immediate execution
- Retry support with exponential backoff
- Parameter caching for refresh/retry

```typescript
export function useAsyncData<TData, TParams extends unknown[]>(
  asyncFn: (...params: TParams) => Promise<TData>,
  options: UseAsyncDataOptions<TData, TParams> = {}
): UseAsyncDataReturn<TData, TParams> {
  const {
    initialData = null,
    immediate = false,
    onError = toErrorMessage,
    onSuccess,
    retry: retryOptions,
  } = options;

  const data = ref<TData | null>(initialData) as Ref<TData | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);
  const guard = useAsyncGuard();

  let lastParams: TParams | null = null;
  let retryCount = 0;

  async function execute(...params: TParams): Promise<void> {
    const token = guard.start();
    loading.value = true;
    error.value = null;
    lastParams = params;

    try {
      const result = await asyncFn(...params);
      if (!guard.isValid(token)) return;

      data.value = result;
      retryCount = 0;
      onSuccess?.(result);
    } catch (e) {
      if (!guard.isValid(token)) return;
      error.value = onError(e);
    } finally {
      if (guard.isValid(token)) {
        loading.value = false;
      }
    }
  }

  async function refresh(): Promise<void> {
    if (lastParams === null) return;
    await execute(...lastParams);
  }

  async function retry(): Promise<void> {
    if (!retryOptions || !lastParams || retryCount >= (retryOptions.maxAttempts ?? 3)) {
      return;
    }

    retryCount++;
    const delay = (retryOptions.delay ?? 1000) * Math.pow(2, retryCount - 1);
    await new Promise(resolve => setTimeout(resolve, delay));
    await execute(...lastParams);
  }

  function clearError(): void {
    error.value = null;
  }

  function reset(): void {
    guard.invalidate();
    data.value = initialData ?? null;
    loading.value = false;
    error.value = null;
    lastParams = null;
    retryCount = 0;
  }

  // Immediate execution support
  if (immediate && lastParams === null) {
    // Need default params for immediate - will handle in actual implementation
  }

  return {
    data,
    loading,
    error,
    execute,
    refresh,
    clearError,
    reset,
    retry,
  };
}
```

#### Phase 2: Create Test Suite

**File**: `apps/desktop/src/composables/__tests__/useAsyncData.test.ts`
**Estimated LOC**: ~400 lines

Test coverage:
1. **Basic async execution**
   - Successfully loads data
   - Sets loading state correctly
   - Clears error on success

2. **Error handling**
   - Sets error message on failure
   - Uses custom onError handler
   - Clears data on error (optional)

3. **Stale request prevention**
   - Ignores results from superseded calls
   - Only latest request updates state
   - Multiple concurrent requests handled correctly

4. **Retry functionality**
   - Retry with exponential backoff
   - Max retry attempts respected
   - Retry count resets on success

5. **Lifecycle methods**
   - refresh() re-executes with last params
   - reset() clears all state
   - clearError() removes error message

6. **Immediate execution**
   - Executes on mount when immediate=true
   - Does not execute when immediate=false

7. **Callbacks**
   - onSuccess called with data
   - onError called with error

#### Phase 3: Refactor Existing Code

Refactor files incrementally to use the new composable. Priority order based on complexity reduction:

**High Value (10+ lines saved per usage)**:
1. `stores/sessionDetail.ts` - Multiple section loaders with identical patterns
2. `stores/search.ts` - Multiple loading states (main, stats, health)
3. `stores/worktrees.ts` - Worktree and repo loading
4. `composables/useExportPreview.ts` - Simple async pattern

**Medium Value (5-10 lines saved)**:
5. `views/SessionComparisonView.vue` - Comparison loading
6. `views/HealthScoringView.vue` - Health data loading
7. `components/SearchPalette.vue` - Search execution
8. `stores/launcher.ts` - Launch state
9. `stores/configInjector.ts` - Config operations
10. `stores/orchestrationHome.ts` - Dashboard data

**Low Priority (already complex/special cases)**:
11. `stores/sessions.ts` - Has special indexing state
12. `composables/useCachedFetch.ts` - Already sophisticated, may not benefit

### Example Refactorings

#### Before (stores/launcher.ts - lines 27-28, 45-62):

```typescript
const loading = ref(false);
const error = ref<string | null>(null);

async function loadSystemDeps() {
  loading.value = true;
  error.value = null;
  try {
    systemDeps.value = await checkSystemDependencies();
  } catch (e) {
    error.value = toErrorMessage(e);
  } finally {
    loading.value = false;
  }
}
```

#### After:

```typescript
const {
  data: systemDeps,
  loading,
  error,
  execute: loadSystemDeps,
} = useAsyncData(checkSystemDependencies, {
  immediate: false,
});
```

**Savings**: 17 lines → 6 lines (11 lines saved)

#### Before (views/HealthScoringView.vue - lines 13-14, 20-32):

```typescript
const loading = ref(true);
const error = ref<string | null>(null);

async function loadData() {
  loading.value = true;
  error.value = null;
  try {
    const result = await getHealthScoringData();
    data.value = result;
  } catch (e) {
    error.value = toErrorMessage(e);
  } finally {
    loading.value = false;
  }
}
```

#### After:

```typescript
const {
  data,
  loading,
  error,
  execute: loadData,
} = useAsyncData(getHealthScoringData, {
  immediate: true,
});
```

**Savings**: 15 lines → 7 lines (8 lines saved)

### Integration with Existing Patterns

The composable is designed to work **alongside** existing patterns:

1. **With stores**: Can be used in Pinia stores for data fetching
2. **With async guards**: Uses `useAsyncGuard` internally, can coexist with separate guards
3. **With cached fetch**: `useCachedFetch` remains for complex caching needs
4. **Incremental adoption**: Each usage is independent; no need to refactor everything at once

## Benefits

### Immediate Benefits

1. **Code reduction**: Estimated 100-150 lines removed across affected files
2. **Consistency**: All async operations follow same pattern
3. **Testability**: Core logic tested once, not in every component
4. **Developer experience**: Simple API reduces cognitive load

### Long-term Benefits

1. **Maintenance**: Single place to fix bugs or add features
2. **Features**: Easy to add retry, debounce, caching, etc. centrally
3. **Performance**: Can add optimizations (request deduplication, batching) in one place
4. **Monitoring**: Can add telemetry/logging to all async operations from one location

## Testing Strategy

### Unit Tests (useAsyncData.test.ts)

- Test all API methods independently
- Test edge cases (concurrent calls, rapid invalidation)
- Test retry logic and exponential backoff
- Test error handling and transformations
- Mock async functions with controlled delays

### Integration Tests

After refactoring each file:
1. Run existing test suite for that file
2. Verify no behavioral changes
3. Check that loading/error states work as before
4. Test manual scenarios in dev mode

### Manual Validation

For each refactored component/store:
1. Test in development mode
2. Verify loading spinners appear/disappear correctly
3. Verify error messages display properly
4. Test rapid user actions (fast clicking, session switching)
5. Verify no stale data appears

## Rollout Plan

### Step 1: Implementation (Week 1)
- [ ] Create `useAsyncData.ts` composable
- [ ] Create comprehensive test suite
- [ ] Document API and examples
- [ ] Get feedback on API design

### Step 2: Pilot Refactoring (Week 1)
- [ ] Refactor 2-3 simple cases (HealthScoringView, SearchPalette)
- [ ] Validate that tests pass
- [ ] Manual testing of refactored components
- [ ] Iterate on API if needed

### Step 3: Broader Adoption (Week 2)
- [ ] Refactor medium complexity files
- [ ] Update stores incrementally
- [ ] Run full test suite after each refactoring
- [ ] Manual validation in UI

### Step 4: Documentation (Week 2)
- [ ] Add usage examples to docs
- [ ] Add to composables README
- [ ] Create migration guide for future usage

## Success Metrics

- **Lines of code reduced**: Target 100-150 lines
- **Test coverage**: 90%+ for `useAsyncData`
- **All existing tests pass**: Zero behavioral changes
- **Performance**: No regression in load times or responsiveness
- **Developer satisfaction**: Easier to write new async operations

## Risks and Mitigations

### Risk 1: Breaking Existing Behavior
**Mitigation**:
- Comprehensive test suite
- Incremental adoption (can be reverted per-file)
- Thorough manual testing before each commit

### Risk 2: Over-abstraction
**Mitigation**:
- Keep API simple and focused
- Allow escape hatches for complex cases
- Don't force usage where existing pattern works better

### Risk 3: Learning Curve
**Mitigation**:
- Clear documentation with examples
- Simple API (data/loading/error/execute)
- Familiar patterns (similar to VueUse's `useAsyncState`)

## Alternative Approaches Considered

### 1. Use VueUse's `useAsyncState`
**Pros**: Battle-tested, comprehensive
**Cons**: Heavy dependency, may not fit our exact needs, learning curve

### 2. Custom hook per store
**Pros**: Tailored to each use case
**Cons**: Still creates duplication, harder to maintain

### 3. Higher-order function wrapper
**Pros**: Functional approach
**Cons**: Less Vue-idiomatic, harder to understand

**Decision**: Custom composable provides best balance of control, simplicity, and integration.

## Conclusion

This refactoring addresses a clear pattern of technical debt across 12+ files. The `useAsyncData` composable will:
- Reduce code duplication
- Improve maintainability
- Provide consistent error handling
- Enable future enhancements (retry, caching, monitoring)

The incremental adoption strategy minimizes risk while providing immediate value.
