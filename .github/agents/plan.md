# Implementation Plan: Extract Async Request Guard Pattern

## Problem Statement

The codebase has significant duplication of the "async request guard" pattern across multiple stores and composables. This pattern prevents stale async writes when users trigger rapid successive requests (e.g., switching sessions quickly, typing in search, etc.).

### Current State Analysis

**Pattern Usage Locations:**
1. **sessionDetail.ts** (lines 99-101)
   - `requestToken` for main session loads
   - `eventsRequestToken` for events pagination/filtering
   - Used in `buildSectionLoader` factory (lines 116, 121, 125)

2. **search.ts**
   - `searchGeneration` (line 142) for main search results
   - `facetGeneration` (line 270) for facet loading
   - Each has identical increment/check pattern

3. **useCachedFetch.ts** (lines 104-105, 125, 134, 148)
   - `generation` counter with proper implementation
   - Most sophisticated version with full lifecycle management

**Code Duplication:**
- Pattern appears ~15-20 times across 3 files
- Each implements: counter variable, increment on start, guard checks on completion
- Inconsistent naming: `requestToken` vs `generation` vs `searchGeneration`
- No shared abstraction or reusable utility

## Benefits of Extraction

1. **DRY Principle** - Eliminates 50+ lines of duplicated logic
2. **Consistency** - Single implementation ensures pattern is used correctly everywhere
3. **Maintainability** - Bug fixes or improvements apply to all usage sites
4. **Type Safety** - Encapsulates the token/generation logic with proper typing
5. **Testability** - Composable can be unit tested in isolation
6. **Discoverability** - New code can easily adopt the pattern

## Proposed Solution

### Create New Composable: `useAsyncGuard`

**Location:** `/apps/desktop/src/composables/useAsyncGuard.ts`

**API Design:**
```typescript
export interface AsyncGuardToken {
  /** Opaque token representing this request */
  readonly value: number;
}

export interface AsyncGuard {
  /**
   * Create a new token, invalidating all previous tokens.
   * Call at the start of an async operation.
   */
  start(): AsyncGuardToken;

  /**
   * Check if a token is still valid (no newer tokens have been created).
   * Use in guard clauses to prevent stale updates.
   */
  isValid(token: AsyncGuardToken): boolean;

  /**
   * Invalidate all tokens without creating a new one.
   * Useful for cleanup/reset scenarios.
   */
  invalidateAll(): void;
}

/**
 * Creates an async request guard for preventing stale async writes.
 *
 * Common pattern: User triggers action A, then quickly action B.
 * Without guards, B might complete first, then A overwrites with stale data.
 *
 * @example
 * const guard = useAsyncGuard();
 *
 * async function loadData(id: string) {
 *   const token = guard.start();
 *   const data = await fetchData(id);
 *   if (!guard.isValid(token)) return; // Stale request, abort
 *   state.value = data;
 * }
 */
export function useAsyncGuard(): AsyncGuard {
  let generation = 0;

  return {
    start: () => {
      generation++;
      return { value: generation };
    },

    isValid: (token: AsyncGuardToken) => {
      return token.value === generation;
    },

    invalidateAll: () => {
      generation++;
    }
  };
}
```

**Key Design Decisions:**
- **Opaque token type** - Prevents accidental number comparisons, enforces using `isValid()`
- **Simple API** - Only 3 methods, easy to understand and adopt
- **No dependencies** - Pure JavaScript, works in any context
- **TypeScript native** - Full type safety and autocomplete support

### Migration Strategy

#### Phase 1: Create and Test Composable
1. Create `/apps/desktop/src/composables/useAsyncGuard.ts`
2. Create comprehensive unit tests in `/apps/desktop/src/composables/__tests__/useAsyncGuard.test.ts`
3. Test scenarios:
   - Basic token generation and validation
   - Multiple rapid calls invalidate earlier tokens
   - `invalidateAll()` invalidates all tokens
   - Concurrent requests (simulate race conditions)

#### Phase 2: Migrate `sessionDetail.ts`
**File:** `/apps/desktop/src/stores/sessionDetail.ts`

**Changes:**
```typescript
// Before (lines 99-101):
let requestToken = 0;
let eventsRequestToken = 0;

// After:
import { useAsyncGuard } from '@/composables/useAsyncGuard';

const sessionGuard = useAsyncGuard();
const eventsGuard = useAsyncGuard();
```

**Update `buildSectionLoader` function (lines 106-129):**
```typescript
// Before:
function buildSectionLoader<T>(opts: { ... }) {
  return async () => {
    const id = sessionId.value;
    if (!id || loaded.value.has(opts.key)) return;
    const token = requestToken; // OLD
    opts.errorRef.value = null;

    try {
      const result = await opts.fetchFn(id);
      if (requestToken !== token) return; // OLD
      opts.onResult(result);
      loaded.value.add(opts.key);
    } catch (e) {
      if (requestToken !== token) return; // OLD
      opts.errorRef.value = toErrorMessage(e);
      // ... logging
    }
  };
}

// After:
function buildSectionLoader<T>(opts: { ... }) {
  return async () => {
    const id = sessionId.value;
    if (!id || loaded.value.has(opts.key)) return;
    const token = sessionGuard.start(); // NEW
    opts.errorRef.value = null;

    try {
      const result = await opts.fetchFn(id);
      if (!sessionGuard.isValid(token)) return; // NEW
      opts.onResult(result);
      loaded.value.add(opts.key);
    } catch (e) {
      if (!sessionGuard.isValid(token)) return; // NEW
      opts.errorRef.value = toErrorMessage(e);
      // ... logging
    }
  };
}
```

**Update events loading functions (4 locations):**
- `loadEvents()` - lines 214-241
- `refreshEvents()` - lines 243-270
- Similar pattern: replace `const token = ++eventsRequestToken` with `const token = eventsGuard.start()`
- Replace `if (eventsRequestToken !== token)` with `if (!eventsGuard.isValid(token))`

**Update `clearSession()` method (line 480):**
```typescript
// Before:
requestToken++;
eventsRequestToken++;

// After:
sessionGuard.invalidateAll();
eventsGuard.invalidateAll();
```

**Expected changes:** ~12 line modifications, net reduction of 2 lines

#### Phase 3: Migrate `search.ts`
**File:** `/apps/desktop/src/stores/search.ts`

**Changes:**
```typescript
// Before (lines 141-142, 270):
let searchGeneration = 0;
// ...
let facetGeneration = 0;

// After:
import { useAsyncGuard } from '@/composables/useAsyncGuard';

const searchGuard = useAsyncGuard();
const facetGuard = useAsyncGuard();
```

**Update `executeSearch()` (lines 162-215):**
```typescript
// Before:
async function executeSearch() {
  const gen = ++searchGeneration;
  loading.value = true;
  error.value = null;

  try {
    // ... API call ...
    if (gen !== searchGeneration) return;
    // ... update state ...
  } catch (e) {
    if (gen !== searchGeneration) return;
    // ... error handling ...
  } finally {
    if (gen === searchGeneration) loading.value = false;
  }
}

// After:
async function executeSearch() {
  const token = searchGuard.start();
  loading.value = true;
  error.value = null;

  try {
    // ... API call ...
    if (!searchGuard.isValid(token)) return;
    // ... update state ...
  } catch (e) {
    if (!searchGuard.isValid(token)) return;
    // ... error handling ...
  } finally {
    if (searchGuard.isValid(token)) loading.value = false;
  }
}
```

**Update `fetchFacets()` (lines 272-295):**
- Same pattern as above
- Replace `const gen = ++facetGeneration` with `const token = facetGuard.start()`
- Replace `if (gen !== facetGeneration)` with `if (!facetGuard.isValid(token))`

**Update `resetFilters()` if needed (line 346):**
- May need to call `searchGuard.invalidateAll()` to cancel in-flight searches

**Expected changes:** ~8 line modifications, net reduction of 2 lines

#### Phase 4: Refactor `useCachedFetch.ts` (Optional)
**File:** `/apps/desktop/src/composables/useCachedFetch.ts`

This file already has a well-implemented generation pattern. We can optionally refactor it to use `useAsyncGuard` for consistency, but it's not strictly necessary since:
- It's already well-encapsulated within the composable
- The pattern is only used internally (not exposed)
- Performance-critical code path

**Decision:** Skip refactoring `useCachedFetch.ts` for this iteration. The internal implementation is fine, and using `useAsyncGuard` would add minimal value while potentially introducing risk.

### Testing Strategy

#### Unit Tests for `useAsyncGuard`
**File:** `/apps/desktop/src/composables/__tests__/useAsyncGuard.test.ts`

**Test Cases:**
1. **Basic functionality**
   - `start()` returns a token
   - `isValid()` returns true for current token
   - `isValid()` returns false for old token after new `start()`

2. **Multiple tokens**
   - Create 3 tokens in sequence
   - Only the last one is valid
   - Earlier tokens return false

3. **invalidateAll()**
   - Current token becomes invalid after `invalidateAll()`
   - No tokens are valid after invalidation
   - Next `start()` creates valid token again

4. **Race condition simulation**
   - Start multiple async operations
   - Simulate out-of-order completion
   - Verify only the latest updates state

5. **Token immutability**
   - Token value cannot be modified
   - Type safety prevents number comparison

#### Integration Tests
**Existing test files to verify:**
1. `/apps/desktop/src/__tests__/stores/sessionDetail.test.ts` (if exists)
2. `/apps/desktop/src/__tests__/stores/search.test.ts` (if exists)

**Manual verification scenarios:**
1. **Session switching**
   - Open session A, immediately switch to session B
   - Verify only session B data is displayed
   - Check no stale session A data appears

2. **Search typing**
   - Type rapidly in search box: "test query"
   - Verify only final results for "test query" appear
   - Check no intermediate results (e.g., "test", "test q") flash

3. **Events pagination**
   - Load session detail, quickly change event filters multiple times
   - Verify only final filter's results are shown

#### Validation Commands
```bash
# Type checking
pnpm --filter @tracepilot/desktop typecheck

# Run unit tests
pnpm --filter @tracepilot/desktop test useAsyncGuard

# Run all desktop tests
pnpm --filter @tracepilot/desktop test

# Run full test suite
pnpm -r test

# Lint check
pnpm lint
```

### Integration with Existing Code

#### Import Paths
- Composable location: `/apps/desktop/src/composables/useAsyncGuard.ts`
- Import in stores: `import { useAsyncGuard } from '@/composables/useAsyncGuard'`
- Import in components: Same path (@ alias resolves to src)

#### No Breaking Changes
- This is purely internal refactoring
- No API changes to stores or composables
- No changes to component interfaces
- User-facing behavior remains identical

#### Backwards Compatibility
- Pattern is additive - can be adopted incrementally
- Old code continues working while migration is in progress
- No version bumps or deprecation notices needed

### Documentation

#### Code Documentation
Each file includes JSDoc comments with:
- Purpose and use case
- Example usage
- Common pitfalls (forgetting to check `isValid()`)

#### Developer Guide (README update)
Add section to `/apps/desktop/README.md` or create `/docs/patterns/async-guards.md`:

```markdown
## Async Request Guards

When users perform rapid actions (switching sessions, typing searches), async
operations can complete out of order, causing stale data to overwrite fresh data.

### Pattern: useAsyncGuard

Use the `useAsyncGuard` composable to prevent stale async writes:

\`\`\`typescript
import { useAsyncGuard } from '@/composables/useAsyncGuard';

const guard = useAsyncGuard();

async function loadData(id: string) {
  const token = guard.start(); // Mark as latest request

  const result = await fetchData(id);

  if (!guard.isValid(token)) return; // Abort if superseded

  state.value = result; // Safe to update
}
\`\`\`

### When to Use
- User-triggered actions that can be rapidly repeated
- Session/route switching
- Search-as-you-type
- Pagination or filtering that updates the same state
- Any async operation where order matters

### When NOT to Use
- One-time initialization
- User confirmation dialogs (single action)
- Independent operations that don't share state
```

### Risk Assessment

#### Low Risk
- **Isolated change** - Only affects internal implementation of existing stores
- **Well-tested pattern** - Already proven in `useCachedFetch.ts`
- **No API changes** - External consumers unaffected
- **Backwards compatible** - Can be rolled back easily

#### Potential Issues & Mitigation

**Issue 1: Forgetting to check `isValid()`**
- **Risk:** Developer adds `guard.start()` but forgets guard clause
- **Mitigation:** TypeScript enforces token usage, linter rule possible, code review

**Issue 2: Incorrect guard reuse**
- **Risk:** Using same guard for unrelated operations
- **Mitigation:** Clear naming (e.g., `sessionGuard`, `searchGuard`), documentation

**Issue 3: Performance overhead**
- **Risk:** Token object creation adds GC pressure
- **Mitigation:** Minimal - single number property, short-lived objects

**Issue 4: Race conditions in multi-step operations**
- **Risk:** Token check passes, but state changes before update
- **Mitigation:** Document that guards prevent stale writes, not concurrency issues

### Rollback Plan

If issues are discovered post-merge:
1. **Immediate:** Revert the merge commit (single commit via squash)
2. **Short-term:** Re-apply old pattern inline
3. **Long-term:** Fix issues in composable, re-submit with additional tests

### Success Criteria

✅ **Code Quality**
- All type checks pass
- All tests pass (unit + integration)
- Linter reports no new issues
- Code coverage maintained or improved

✅ **Functionality**
- Session switching works correctly (no stale data)
- Search typing works correctly (no stale results)
- Events pagination works correctly (no stale events)
- No regressions in manual testing

✅ **Maintainability**
- 50+ lines of duplication eliminated
- Consistent pattern across all async operations
- Clear documentation and examples
- Future developers can easily adopt pattern

### Timeline Estimate

- ✅ **Phase 1** (Composable + Tests): Create base implementation and comprehensive tests
- ✅ **Phase 2** (sessionDetail.ts): Migrate first store
- ✅ **Phase 3** (search.ts): Migrate second store
- ✅ **Phase 4** (Testing): Manual verification and integration testing
- ✅ **Phase 5** (Documentation): Update developer documentation

## Implementation Checklist

- [ ] Create `useAsyncGuard.ts` composable with full TypeScript types
- [ ] Create comprehensive unit tests for `useAsyncGuard`
- [ ] Migrate `sessionDetail.ts` to use `useAsyncGuard`
- [ ] Migrate `search.ts` to use `useAsyncGuard`
- [ ] Run all type checks (`pnpm -r typecheck`)
- [ ] Run all tests (`pnpm -r test`)
- [ ] Run linter (`pnpm lint`)
- [ ] Manual verification: rapid session switching
- [ ] Manual verification: rapid search typing
- [ ] Manual verification: rapid events filtering
- [ ] Update documentation with pattern usage guide
- [ ] Final code review and cleanup

## Appendix: Alternative Approaches Considered

### Alternative 1: Higher-Order Function
```typescript
function withAsyncGuard<T extends (...args: any[]) => Promise<any>>(fn: T) {
  let gen = 0;
  return async (...args: Parameters<T>) => {
    const token = ++gen;
    const result = await fn(...args);
    if (gen !== token) return;
    return result;
  };
}
```
**Rejected:** Less flexible, harder to integrate with existing code structure

### Alternative 2: Class-Based
```typescript
class AsyncGuard {
  private generation = 0;
  start() { return ++this.generation; }
  isValid(token: number) { return token === this.generation; }
}
```
**Rejected:** Classes are heavier, composable pattern more idiomatic for Vue

### Alternative 3: Global Registry
```typescript
const guards = new Map<string, AsyncGuard>();
function getGuard(key: string) { ... }
```
**Rejected:** Over-engineered, adds complexity without benefits

## Conclusion

This refactoring eliminates significant code duplication while improving consistency and maintainability. The pattern is proven (already exists in `useCachedFetch`), low-risk (internal changes only), and well-scoped (3 files affected). The benefits clearly outweigh the minimal implementation effort.
