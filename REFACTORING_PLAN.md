# Refactoring Plan: Extract Git Repository Operations Composable

## Problem Statement

Two large orchestration views (`SessionLauncherView.vue` - 1,865 LOC and `WorktreeManagerView.vue` - 1,981 LOC) contain duplicated Git repository operations, including:
- Fetching default branch from a repository
- Fetching latest changes from remote
- Computing worktree paths from branch names
- Managing loading/error states for these operations

This duplication leads to:
- ~150-200 lines of duplicated code
- Inconsistent error handling
- Harder maintenance and testing
- Violation of DRY principle

## Solution Overview

Create a new composable `useGitRepository.ts` that extracts and unifies these common Git operations, following the established pattern from PR #196's `useTimelineToolState` extraction.

## Detailed Changes

### 1. Create `useGitRepository.ts` Composable

**Location:** `/apps/desktop/src/composables/useGitRepository.ts`

**Responsibilities:**
- Load default branch for a repository
- Fetch from remote with loading states
- Compute worktree paths from branch names
- Provide reactive state for loading/error conditions
- Handle errors with appropriate error messages

**Interface Design:**

```typescript
export interface UseGitRepositoryOptions {
  /**
   * Repository path to operate on (reactive)
   */
  repoPath: Ref<string>;

  /**
   * Optional: callback when fetch succeeds
   */
  onFetchSuccess?: () => void;

  /**
   * Optional: callback when fetch fails
   */
  onFetchError?: (error: string) => void;
}

export interface UseGitRepositoryReturn {
  /**
   * Default branch name (e.g., "main", "master")
   */
  defaultBranch: Ref<string>;

  /**
   * Whether a fetch operation is in progress
   */
  fetchingRemote: Ref<boolean>;

  /**
   * Load the default branch for the current repoPath
   */
  loadDefaultBranch: () => Promise<void>;

  /**
   * Fetch latest changes from remote
   */
  fetchRemote: () => Promise<void>;

  /**
   * Compute worktree path from branch name
   * @param branchName - Branch name to compute path for
   * @returns Computed worktree path
   */
  computeWorktreePath: (branchName: string) => string;
}

export function useGitRepository(options: UseGitRepositoryOptions): UseGitRepositoryReturn
```

**Implementation Details:**

```typescript
import { ref, watch } from 'vue';
import type { Ref } from 'vue';
import { getDefaultBranch, fetchRemote } from '@tracepilot/client';
import { pathBasename, pathDirname, sanitizeBranchForPath } from '@tracepilot/ui';

export interface UseGitRepositoryOptions {
  repoPath: Ref<string>;
  onFetchSuccess?: () => void;
  onFetchError?: (error: string) => void;
}

export interface UseGitRepositoryReturn {
  defaultBranch: Ref<string>;
  fetchingRemote: Ref<boolean>;
  loadDefaultBranch: () => Promise<void>;
  fetchRemote: () => Promise<void>;
  computeWorktreePath: (branchName: string) => string;
}

export function useGitRepository(options: UseGitRepositoryOptions): UseGitRepositoryReturn {
  const { repoPath, onFetchSuccess, onFetchError } = options;

  const defaultBranch = ref('');
  const fetchingRemote = ref(false);

  // Auto-load default branch when repoPath changes
  watch(repoPath, async (newPath) => {
    if (newPath) {
      await loadDefaultBranch();
    } else {
      defaultBranch.value = '';
    }
  }, { immediate: true });

  async function loadDefaultBranch() {
    if (!repoPath.value) {
      defaultBranch.value = '';
      return;
    }

    try {
      defaultBranch.value = await getDefaultBranch(repoPath.value);
    } catch {
      defaultBranch.value = '';
    }
  }

  async function fetchRemote() {
    if (!repoPath.value) return;

    fetchingRemote.value = true;
    try {
      await fetchRemote(repoPath.value);
      onFetchSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onFetchError?.(message);
    } finally {
      fetchingRemote.value = false;
    }
  }

  function computeWorktreePath(branchName: string): string {
    if (!repoPath.value || !branchName) return '';

    const repoName = pathBasename(repoPath.value);
    const parent = pathDirname(repoPath.value);
    const sanitized = sanitizeBranchForPath(branchName);

    return `${parent}/${repoName}-${sanitized}`;
  }

  return {
    defaultBranch,
    fetchingRemote,
    loadDefaultBranch,
    fetchRemote,
    computeWorktreePath,
  };
}
```

### 2. Refactor `SessionLauncherView.vue`

**File:** `/apps/desktop/src/views/orchestration/SessionLauncherView.vue`

**Lines to Remove:** ~70-100 lines (lines 69-93, 145-150, plus related imports and state)

**Changes:**

1. **Import new composable:**
```typescript
import { useGitRepository } from '@/composables/useGitRepository';
```

2. **Replace duplicated code:**

**BEFORE (lines 69-93):**
```typescript
const baseBranch = ref('');
const defaultBranch = ref('');
const fetchingRemote = ref(false);

async function loadDefaultBranch(path: string) {
  try {
    defaultBranch.value = await getDefaultBranch(path);
  } catch {
    defaultBranch.value = '';
  }
}

async function handleFetchRemote() {
  if (!repoPath.value) return;
  fetchingRemote.value = true;
  try {
    await fetchRemote(repoPath.value);
    await worktreeStore.loadBranches(repoPath.value);
    toastSuccess('Fetched latest from remote');
  } catch (e) {
    toastError(toErrorMessage(e));
  } finally {
    fetchingRemote.value = false;
  }
}
```

**AFTER:**
```typescript
const baseBranch = ref('');

const {
  defaultBranch,
  fetchingRemote,
  fetchRemote: performFetchRemote,
  computeWorktreePath,
} = useGitRepository({
  repoPath,
  onFetchSuccess: async () => {
    await worktreeStore.loadBranches(repoPath.value);
    toastSuccess('Fetched latest from remote');
  },
  onFetchError: (error) => {
    toastError(error);
  },
});

async function handleFetchRemote() {
  await performFetchRemote();
}
```

3. **Update worktree path computation (lines 145-150):**

**BEFORE:**
```typescript
const worktreePreviewPath = computed(() => {
  if (!createWorktree.value || !repoPath.value || !branch.value) return '';
  const repoName = pathBasename(repoPath.value);
  const sanitized = sanitizeBranchForPath(branch.value);
  const parent = pathDirname(repoPath.value);
  return `${parent}/${repoName}-${sanitized}`.replace(/\//g, '\\');
});
```

**AFTER:**
```typescript
const worktreePreviewPath = computed(() => {
  if (!createWorktree.value || !branch.value) return '';
  return computeWorktreePath(branch.value).replace(/\//g, '\\');
});
```

4. **Remove unused imports:**
- Remove `getDefaultBranch` from imports (line 23)
- Remove `pathBasename`, `pathDirname`, `sanitizeBranchForPath` if no longer used elsewhere

**Net Change:** -60 to -80 lines

### 3. Refactor `WorktreeManagerView.vue`

**File:** `/apps/desktop/src/views/orchestration/WorktreeManagerView.vue`

**Lines to Remove:** ~60-80 lines (lines 37-39, 97-105, plus related logic)

**Changes:**

1. **Import new composable:**
```typescript
import { useGitRepository } from '@/composables/useGitRepository';
```

2. **Replace duplicated code:**

**BEFORE (lines 37-39):**
```typescript
const defaultBranch = ref('');
const fetchingRemote = ref(false);
```

**AFTER:**
```typescript
const {
  defaultBranch,
  fetchingRemote,
  fetchRemote: performFetchRemote,
  loadDefaultBranch,
  computeWorktreePath,
} = useGitRepository({
  repoPath: computed(() => createModalRepoPath.value),
  onFetchSuccess: () => {
    toastSuccess('Fetched latest from remote');
  },
  onFetchError: (error) => {
    toastError(error);
  },
});
```

3. **Remove manual loadDefaultBranch implementation** (if exists)

4. **Update worktree path computation (lines 97-105):**

**BEFORE:**
```typescript
const computedWorktreePath = computed(() => {
  if (!newBranch.value.trim()) return '';
  const repoPath = createModalRepoPath.value;
  if (!repoPath) return '';
  const repoName = pathBasename(repoPath);
  const parent = pathDirname(repoPath);
  const sanitized = sanitizeBranchForPath(newBranch.value);
  return `${parent}/${repoName}-${sanitized}`;
});
```

**AFTER:**
```typescript
const computedWorktreePath = computed(() => {
  if (!newBranch.value.trim()) return '';
  return computeWorktreePath(newBranch.value);
});
```

5. **Remove unused imports:**
- Remove `getDefaultBranch`, `fetchRemote` from client imports (line 5)
- Remove `pathBasename`, `pathDirname`, `sanitizeBranchForPath` from UI imports (line 6)

**Net Change:** -50 to -70 lines

### 4. Create Comprehensive Test Suite

**File:** `/apps/desktop/src/composables/__tests__/useGitRepository.test.ts`

**Test Coverage:**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useGitRepository } from '../useGitRepository';
import * as client from '@tracepilot/client';

// Mock the client functions
vi.mock('@tracepilot/client', () => ({
  getDefaultBranch: vi.fn(),
  fetchRemote: vi.fn(),
}));

describe('useGitRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('defaultBranch loading', () => {
    it('should load default branch on mount when repoPath is provided', async () => {
      vi.mocked(client.getDefaultBranch).mockResolvedValue('main');
      const repoPath = ref('/path/to/repo');

      const { defaultBranch } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick(); // Wait for watch to trigger

      expect(client.getDefaultBranch).toHaveBeenCalledWith('/path/to/repo');
      expect(defaultBranch.value).toBe('main');
    });

    it('should update default branch when repoPath changes', async () => {
      vi.mocked(client.getDefaultBranch)
        .mockResolvedValueOnce('main')
        .mockResolvedValueOnce('master');

      const repoPath = ref('/path/to/repo1');
      const { defaultBranch } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();
      expect(defaultBranch.value).toBe('main');

      repoPath.value = '/path/to/repo2';
      await nextTick();
      await nextTick();

      expect(client.getDefaultBranch).toHaveBeenCalledWith('/path/to/repo2');
      expect(defaultBranch.value).toBe('master');
    });

    it('should clear default branch when repoPath becomes empty', async () => {
      vi.mocked(client.getDefaultBranch).mockResolvedValue('main');

      const repoPath = ref('/path/to/repo');
      const { defaultBranch } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();
      expect(defaultBranch.value).toBe('main');

      repoPath.value = '';
      await nextTick();

      expect(defaultBranch.value).toBe('');
    });

    it('should handle errors gracefully when loading default branch', async () => {
      vi.mocked(client.getDefaultBranch).mockRejectedValue(new Error('Git error'));

      const repoPath = ref('/invalid/path');
      const { defaultBranch } = useGitRepository({ repoPath });

      await nextTick();
      await nextTick();

      expect(defaultBranch.value).toBe('');
    });
  });

  describe('fetchRemote', () => {
    it('should fetch from remote and set loading state', async () => {
      vi.mocked(client.fetchRemote).mockResolvedValue(undefined);
      const onFetchSuccess = vi.fn();

      const repoPath = ref('/path/to/repo');
      const { fetchRemote, fetchingRemote } = useGitRepository({
        repoPath,
        onFetchSuccess,
      });

      expect(fetchingRemote.value).toBe(false);

      const promise = fetchRemote();
      expect(fetchingRemote.value).toBe(true);

      await promise;

      expect(fetchingRemote.value).toBe(false);
      expect(client.fetchRemote).toHaveBeenCalledWith('/path/to/repo');
      expect(onFetchSuccess).toHaveBeenCalled();
    });

    it('should call onFetchError callback on failure', async () => {
      vi.mocked(client.fetchRemote).mockRejectedValue(new Error('Network error'));
      const onFetchError = vi.fn();

      const repoPath = ref('/path/to/repo');
      const { fetchRemote } = useGitRepository({
        repoPath,
        onFetchError,
      });

      await fetchRemote();

      expect(onFetchError).toHaveBeenCalledWith('Network error');
    });

    it('should not fetch when repoPath is empty', async () => {
      const repoPath = ref('');
      const { fetchRemote } = useGitRepository({ repoPath });

      await fetchRemote();

      expect(client.fetchRemote).not.toHaveBeenCalled();
    });

    it('should reset loading state even on error', async () => {
      vi.mocked(client.fetchRemote).mockRejectedValue(new Error('Error'));

      const repoPath = ref('/path/to/repo');
      const { fetchRemote, fetchingRemote } = useGitRepository({ repoPath });

      expect(fetchingRemote.value).toBe(false);

      const promise = fetchRemote();
      expect(fetchingRemote.value).toBe(true);

      await promise;

      expect(fetchingRemote.value).toBe(false);
    });
  });

  describe('computeWorktreePath', () => {
    it('should compute worktree path correctly', () => {
      const repoPath = ref('/home/user/repos/my-project');
      const { computeWorktreePath } = useGitRepository({ repoPath });

      const path = computeWorktreePath('feature/new-feature');

      expect(path).toBe('/home/user/repos/my-project-feature-new-feature');
    });

    it('should sanitize branch names with special characters', () => {
      const repoPath = ref('/home/user/repos/my-project');
      const { computeWorktreePath } = useGitRepository({ repoPath });

      const path = computeWorktreePath('feature/fix:bug#123');

      // Should sanitize special characters (depends on sanitizeBranchForPath implementation)
      expect(path).toContain('my-project-');
      expect(path).not.toContain(':');
      expect(path).not.toContain('#');
    });

    it('should return empty string when repoPath is empty', () => {
      const repoPath = ref('');
      const { computeWorktreePath } = useGitRepository({ repoPath });

      const path = computeWorktreePath('feature/test');

      expect(path).toBe('');
    });

    it('should return empty string when branchName is empty', () => {
      const repoPath = ref('/home/user/repos/my-project');
      const { computeWorktreePath } = useGitRepository({ repoPath });

      const path = computeWorktreePath('');

      expect(path).toBe('');
    });

    it('should handle Windows paths correctly', () => {
      const repoPath = ref('C:\\Users\\user\\repos\\my-project');
      const { computeWorktreePath } = useGitRepository({ repoPath });

      const path = computeWorktreePath('feature/test');

      expect(path).toContain('my-project-');
    });
  });

  describe('loadDefaultBranch method', () => {
    it('should manually load default branch', async () => {
      vi.mocked(client.getDefaultBranch).mockResolvedValue('develop');

      const repoPath = ref('');
      const { loadDefaultBranch, defaultBranch } = useGitRepository({ repoPath });

      repoPath.value = '/path/to/repo';
      await loadDefaultBranch();

      expect(defaultBranch.value).toBe('develop');
    });
  });

  describe('callback integration', () => {
    it('should not call callbacks when not provided', async () => {
      vi.mocked(client.fetchRemote).mockResolvedValue(undefined);

      const repoPath = ref('/path/to/repo');
      const { fetchRemote } = useGitRepository({ repoPath });

      await expect(fetchRemote()).resolves.not.toThrow();
    });
  });
});
```

**Expected Test Results:**
- ~20 test cases
- 100% coverage of composable logic
- Edge cases: empty paths, errors, state transitions

### 5. Update Type Definitions (if needed)

**File:** `/packages/types/src/index.ts` (if types need to be exported)

No new types needed - all existing types are used.

## Integration Points

### 1. Stores

**Affected:**
- `useLauncherStore` - No changes needed
- `useWorktreesStore` - No changes needed

Both stores already work with the views; the composable simply extracts shared logic.

### 2. Client Functions

**Used by composable:**
- `getDefaultBranch(path: string): Promise<string>` - from `@tracepilot/client`
- `fetchRemote(path: string): Promise<void>` - from `@tracepilot/client`

Both already exist and are well-tested.

### 3. UI Utilities

**Used by composable:**
- `pathBasename(path: string): string` - from `@tracepilot/ui`
- `pathDirname(path: string): string` - from `@tracepilot/ui`
- `sanitizeBranchForPath(branch: string): string` - from `@tracepilot/ui`

All utility functions already exist and handle cross-platform paths.

## Testing Strategy

### 1. Unit Tests (New)

- **File:** `useGitRepository.test.ts`
- **Coverage:** ~20 test cases
- **Areas:**
  - Default branch loading (auto and manual)
  - Fetch remote operations
  - Path computation with various inputs
  - Error handling
  - Loading state management
  - Callback integration

### 2. Component Integration Tests (Existing)

- **Files:**
  - `SessionLauncherView.test.ts` (if exists)
  - `WorktreeManagerView.test.ts` (if exists)

- **Strategy:** Run existing tests to ensure no regressions
- **Expected:** All existing tests pass without modification

### 3. Manual Testing Checklist

**SessionLauncherView:**
1. Select a repository → default branch loads
2. Click "Fetch Remote" → loading indicator shows → success toast
3. Enter branch name → worktree path preview updates
4. Change repository → default branch updates

**WorktreeManagerView:**
1. Open create modal → select repository
2. Default branch loads automatically
3. Fetch remote works correctly
4. Branch name sanitization in path preview

### 4. E2E Testing (Manual)

- Test with various repository paths (Windows/Unix)
- Test with special characters in branch names
- Test error scenarios (invalid repo, network failure)
- Test rapid repository switching

## Validation Criteria

### Success Metrics

1. **Code Reduction:**
   - Net -110 to -150 lines across two views
   - Single source of truth for Git operations

2. **Test Coverage:**
   - New composable: 100% coverage
   - All existing tests pass

3. **No Behavioral Changes:**
   - All functionality works exactly as before
   - No visual changes
   - Same error messages and toasts

4. **Consistency:**
   - Both views use identical Git operation patterns
   - Unified error handling

### Regression Checks

- [ ] SessionLauncherView: Repository selection works
- [ ] SessionLauncherView: Fetch remote works
- [ ] SessionLauncherView: Branch path preview correct
- [ ] SessionLauncherView: Default branch loaded on mount
- [ ] WorktreeManagerView: Create modal works
- [ ] WorktreeManagerView: Fetch remote works
- [ ] WorktreeManagerView: Path computation correct
- [ ] WorktreeManagerView: Default branch updates

## Implementation Order

1. ✅ **Phase 1: Create composable**
   - Implement `useGitRepository.ts`
   - Handle all edge cases
   - ~150 lines

2. ✅ **Phase 2: Create test suite**
   - Write comprehensive tests
   - Achieve 100% coverage
   - ~250 lines

3. ✅ **Phase 3: Refactor SessionLauncherView**
   - Import composable
   - Replace duplicated code
   - Remove unused imports
   - Test manually

4. ✅ **Phase 4: Refactor WorktreeManagerView**
   - Import composable
   - Replace duplicated code
   - Remove unused imports
   - Test manually

5. ✅ **Phase 5: Run full test suite**
   - Run desktop app tests: `pnpm --filter @tracepilot/desktop test`
   - Run typecheck: `pnpm --filter @tracepilot/desktop typecheck`
   - Ensure no regressions

6. ✅ **Phase 6: Manual validation**
   - Test both views in running app
   - Verify all operations work
   - Check loading states and toasts

## Risks & Mitigations

### Risk 1: Breaking Existing Functionality

**Mitigation:**
- Comprehensive test suite before refactoring
- Preserve exact same behavior (no new features)
- Manual testing checklist
- Existing tests must pass

### Risk 2: Missing Edge Cases

**Mitigation:**
- Test with empty strings, null values
- Test cross-platform paths
- Test error scenarios
- Review both views for subtle differences

### Risk 3: Performance Impact

**Mitigation:**
- Composable adds minimal overhead
- No new watchers beyond what exists
- Same number of API calls
- Profile if concerns arise

### Risk 4: Type Safety

**Mitigation:**
- Full TypeScript typing
- Use existing type definitions
- Typecheck before/after confirms safety

## Rollback Plan

If issues arise:

1. **Revert commits** (all changes in single PR)
2. **Restore original files** from git history
3. **Re-run tests** to confirm restoration
4. **Document issues** for future attempt

Git operations are well-isolated, so rollback is straightforward.

## Future Enhancements (Out of Scope)

After this refactoring, consider:

1. **More Git operations:**
   - Branch validation
   - Conflict detection
   - Commit history

2. **Error recovery:**
   - Retry logic for network failures
   - Cache default branches

3. **Performance:**
   - Debounce rapid path changes
   - Cache branch lists

4. **Type safety:**
   - Branded types for paths
   - Validation at composable level

## Documentation Updates

**Files to update:**

1. **README.md** (if composables section exists)
   - Add `useGitRepository` to list
   - Brief description

2. **Composable documentation** (if exists)
   - Usage examples
   - Options reference
   - Return value documentation

3. **Changelog** (for PR)
   - "Refactor: Extract Git operations into reusable composable"
   - List affected files

## Success Criteria Summary

✅ **Code Quality:**
- Net reduction of 110-150 lines
- Single source of truth for Git operations
- 100% test coverage for composable

✅ **Functionality:**
- All existing features work identically
- No visual changes
- No behavioral changes

✅ **Testing:**
- All existing tests pass
- New composable fully tested
- Manual validation complete

✅ **Maintainability:**
- Future Git operations can use same pattern
- Easier to add new features
- Consistent error handling

## Estimated Impact

- **Files Changed:** 4 (1 new, 2 refactored, 1 test)
- **Lines Added:** ~400 (composable + tests)
- **Lines Removed:** ~150 (duplicated code)
- **Net Change:** +250 lines (mostly tests)
- **Complexity Reduction:** Significant (centralized logic)

## Alignment with Existing Patterns

This refactoring follows the exact pattern established in **PR #196**:
- Extract shared logic from multiple components
- Create well-typed composable with options pattern
- Comprehensive test suite
- No behavioral changes
- Preserve existing functionality

The success of PR #196 validates this approach.
