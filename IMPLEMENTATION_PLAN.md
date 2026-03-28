# Implementation Plan: Add Comprehensive Test Coverage for Orchestration Stores

## Problem Statement

Two critical orchestration stores (`orchestrationHome.ts` and `configInjector.ts`) have **ZERO test coverage**, representing a significant quality assurance gap. These stores manage:
- System health and dependencies detection
- Copilot version discovery and management
- Configuration injection and backup/restore
- Worktree statistics aggregation
- Activity feed generation

**Risk**: Without tests, refactoring or bug fixes in these stores can introduce regressions that won't be caught until production.

## Identified Opportunity

**From codebase exploration:**
- `orchestrationHome.ts`: 205 lines, 0 tests
- `configInjector.ts`: 199 lines, 0 tests
- Both are actively used by large view components (1800+ LOC each)
- Complex async orchestration logic with error handling
- Multiple IPC client function dependencies
- Computed properties and state management

**No open PRs are addressing this gap.**

## Success Criteria

1. **Comprehensive coverage** of all store actions and computed properties
2. **Error path testing** - verify error handling for network failures
3. **Async guard patterns** - verify stale response handling (configInjector doesn't use guards, but orchestrationHome might benefit)
4. **State validation** - ensure state updates correctly after actions
5. **Edge cases** - empty states, partial failures, Promise.allSettled behavior
6. **Integration consistency** - follow existing test patterns from `sessionDetail.test.ts` and `launcher.test.ts`

## Implementation Strategy

### Phase 1: Test Infrastructure Setup

Create two new test files following established patterns:
- `apps/desktop/src/__tests__/stores/orchestrationHome.test.ts`
- `apps/desktop/src/__tests__/stores/configInjector.test.ts`

**Testing Framework:** Vitest (already used throughout desktop app)
**Mocking Strategy:** Mock `@tracepilot/client` functions using `vi.mock()`
**Store Setup:** Use Pinia `setActivePinia(createPinia())` in `beforeEach()`

### Phase 2: orchestrationHome.test.ts

#### Test Structure

```typescript
describe("useOrchestrationHomeStore", () => {
  // Mock all client functions
  const mockCheckSystemDeps = vi.fn();
  const mockListSessions = vi.fn();
  const mockDiscoverCopilotVersions = vi.fn();
  const mockGetActiveCopilotVersion = vi.fn();
  const mockListWorktrees = vi.fn();
  const mockListRegisteredRepos = vi.fn();

  vi.mock("@tracepilot/client", () => ({...}));

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  // Test suites...
});
```

#### Test Cases (35-40 tests)

**Initial State (3 tests)**
- Empty state on creation
- All refs initialized to correct defaults
- Computed properties return expected empty values

**initialize() - First Load (5 tests)**
- Successfully loads all data on first initialization
- Sets loading=true during fetch, false after completion
- Handles partial failures with Promise.allSettled (some succeed, some fail)
- Aggregates multiple errors into error.value
- Populates activity feed from recent sessions

**initialize() - Cache Behavior (4 tests)**
- Reuses fresh cache (< 5 min old) without loading spinner
- Shows stale cache immediately, refreshes in background
- Triggers background refresh for stale data (> 5 min old)
- Respects hasCachedData computed property

**loadWorktreeStatsFromRegistry() (4 tests)**
- Aggregates stats from multiple repos correctly
- Handles repos with no worktrees gracefully
- Skips failed repos without blocking others (Promise.allSettled)
- Updates totalDiskUsage, worktreeCount, staleWorktreeCount

**loadWorktreeStats() (3 tests)**
- Loads stats for a single repo
- Skips silently if repoPath is null
- Handles fetch errors gracefully (non-critical)

**computeWorktreeStats() (3 tests)**
- Correctly counts total worktrees
- Correctly counts stale worktrees (status === 'stale')
- Sums diskUsageBytes, handling nullish values

**Computed Properties (5 tests)**
- isHealthy: true when git + copilot available
- isHealthy: false when either missing
- copilotVersionStr: returns activeVersion.version
- copilotVersionStr: falls back to systemDeps.copilotVersion
- copilotVersionStr: returns 'unknown' when both null

**Activity Feed Generation (3 tests)**
- Generates feed from first 6 sessions
- Marks running sessions as 'session_launched'
- Marks completed sessions as 'batch_completed'
- Uses correct timestamp fallback logic

**Error Handling (4 tests)**
- Clears error on successful reinitialize()
- Preserves existing data when background refresh fails
- Handles network errors in doFetch()
- Sets loading=false on error

**Edge Cases (3 tests)**
- Empty sessions list doesn't crash
- Empty repos list doesn't crash
- All Promise.allSettled rejections handled gracefully

### Phase 3: configInjector.test.ts

#### Test Structure

```typescript
describe("useConfigInjectorStore", () => {
  const mockGetAgentDefinitions = vi.fn();
  const mockSaveAgentDefinition = vi.fn();
  const mockGetCopilotConfig = vi.fn();
  const mockSaveCopilotConfig = vi.fn();
  const mockCreateConfigBackup = vi.fn();
  const mockDeleteConfigBackup = vi.fn();
  const mockListConfigBackups = vi.fn();
  const mockRestoreConfigBackup = vi.fn();
  const mockDiscoverCopilotVersions = vi.fn();
  const mockGetActiveCopilotVersion = vi.fn();
  const mockGetMigrationDiffs = vi.fn();
  const mockMigrateAgentDefinition = vi.fn();

  vi.mock("@tracepilot/client", () => ({...}));
  vi.mock("@/stores/toast", () => ({
    useToastStore: () => ({
      success: vi.fn(),
      error: vi.fn(),
    }),
  }));

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
});
```

#### Test Cases (40-45 tests)

**Initial State (4 tests)**
- Empty state on creation
- activeTab defaults to 'agents'
- All refs initialized correctly
- Computed properties return expected defaults

**initialize() (6 tests)**
- Loads all 5 resources successfully
- Handles partial failures gracefully (Promise.allSettled)
- Aggregates errors from rejected promises
- Sets loading=true during fetch, false after
- Populates agents, copilotConfig, versions, activeVersion, backups
- Clears error on successful load

**selectAgent() (2 tests)**
- Sets selectedAgent and editingYaml
- Preserves rawYaml content for editing

**saveAgent() (5 tests)**
- Successfully saves agent YAML
- Calls saveAgentApi with correct file path and content
- Reloads agent definitions after save
- Shows success toast
- Sets error on failure and returns false
- Sets saving=true during operation

**saveGlobalConfig() (5 tests)**
- Successfully saves global config
- Reloads copilotConfig after save
- Shows success toast
- Sets error on failure
- Sets saving=true during operation

**createBackup() (4 tests)**
- Creates backup and reloads list
- Shows success toast unless silent=true
- Silent mode suppresses toast
- Sets error on failure unless silent=true

**restoreBackup() (4 tests)**
- Restores backup successfully
- Calls initialize() to reload all data after restore
- Shows success toast
- Sets error on failure

**deleteBackup() (3 tests)**
- Deletes backup and reloads list
- Shows success toast
- Sets error on failure

**loadMigrationDiffs() (3 tests)**
- Loads migration diffs for version pair
- Populates migrationDiffs ref
- Sets error on failure

**migrateAgent() (3 tests)**
- Migrates agent definition
- Shows success toast
- Sets error on failure

**Computed Properties (3 tests)**
- hasCustomizations: true when any version has customizations
- hasCustomizations: false when all versions clean
- activeVersionStr: returns activeVersion.version or 'unknown'

**Error Handling (4 tests)**
- Clears error.value before successful operations
- Preserves previous state when operations fail
- Handles non-Error rejection values
- Error aggregation works for partial failures

**Edge Cases (3 tests)**
- Empty agents list doesn't crash
- Null copilotConfig handled gracefully
- Empty versions list doesn't crash

### Phase 4: Validation & Integration

**Run tests:**
```bash
pnpm --filter @tracepilot/desktop test orchestrationHome
pnpm --filter @tracepilot/desktop test configInjector
pnpm --filter @tracepilot/desktop test  # Full suite
```

**Verify:**
- All new tests pass
- No regressions in existing tests (523 total desktop tests)
- Code coverage metrics improve

### Phase 5: Review & Refinement

1. **Run subagent reviews** to validate test quality:
   - Architecture review: Test structure, mocking strategy, coverage
   - Code review: Test clarity, edge cases, maintainability
   - Quality review: Adherence to existing patterns, completeness

2. **Address feedback** from reviews

3. **Update documentation** if needed

## File Changes Summary

### New Files (2)
- `apps/desktop/src/__tests__/stores/orchestrationHome.test.ts` (~450 lines)
- `apps/desktop/src/__tests__/stores/configInjector.test.ts` (~500 lines)

### Modified Files (0)
- No changes to production code required
- Pure test addition

## Testing Strategy

### Mock Setup Pattern
```typescript
const mockFn = vi.fn();
vi.mock("@tracepilot/client", () => ({
  functionName: (...args: unknown[]) => mockFn(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFn.mockResolvedValue(FIXTURE_DATA);
});
```

### Fixture Data Pattern
```typescript
const FIXTURE_SYSTEM_DEPS = {
  gitAvailable: true,
  gitVersion: "2.45.0",
  copilotAvailable: true,
  copilotVersion: "1.0.9",
  copilotHomeExists: true,
};
```

### Test Case Pattern
```typescript
it("loads data successfully", async () => {
  mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
  const store = useOrchestrationHomeStore();
  await store.initialize();
  expect(store.systemDeps).toEqual(FIXTURE_SYSTEM_DEPS);
  expect(store.loading).toBe(false);
  expect(store.error).toBeNull();
});
```

## Integration with Existing Codebase

### Consistency with Existing Tests
- Follows patterns from `sessionDetail.test.ts` (Promise.allSettled testing)
- Follows patterns from `launcher.test.ts` (initialization, error handling)
- Uses same mocking strategy across all store tests
- Consistent fixture naming convention

### No Breaking Changes
- Zero changes to production code
- Purely additive improvement
- No risk of regressions

### Maintainability
- Tests document expected behavior
- Serve as examples for future store tests
- Enable safe refactoring of orchestration stores

## Quality Assurance Checklist

**For Users to Verify:**

1. **Orchestration Home View** (`/orchestration`)
   - Stats cards display correctly (sessions, repos, worktrees, disk usage)
   - System health bar shows Git/Copilot status
   - Activity feed populates with recent sessions
   - No console errors on page load

2. **Config Injector View** (`/orchestration/config`)
   - All four tabs load correctly (Agents, Global Config, Versions, Backups)
   - Agent list displays and selection works
   - YAML editing and saving works
   - Backup creation/restore/delete works
   - Migration diffs display correctly

3. **Run Test Suite**
   ```bash
   pnpm --filter @tracepilot/desktop test
   ```
   - All tests pass (previous count + ~75-85 new tests)
   - No flaky tests
   - Test output clean

## Risk Assessment

**Low Risk Implementation:**
- No production code changes
- Tests can be added incrementally
- Easy to revert if issues arise
- No user-facing changes

**High Value:**
- Prevents future regressions in critical orchestration features
- Documents expected behavior for future developers
- Enables confident refactoring
- Raises test coverage for desktop app

## Timeline Estimate

- Phase 1 (Infrastructure): 15 minutes
- Phase 2 (orchestrationHome tests): 45 minutes
- Phase 3 (configInjector tests): 50 minutes
- Phase 4 (Validation): 20 minutes
- Phase 5 (Review & refinement): 30 minutes

**Total: ~2.5 hours**

## Alternative Approaches Considered

1. **Extract common test utilities first** - Decided against to keep changes minimal
2. **Add integration tests instead** - Unit tests provide faster feedback and better isolation
3. **Use test.each for similar test cases** - Good for future refactoring, but keeping explicit for clarity
4. **Add Cypress E2E tests** - Out of scope, focuses on UI interaction rather than store logic

## Success Metrics

- **Test count**: +75-85 tests
- **Coverage**: 0% → ~95% for both stores
- **All tests pass**: Green CI/CD
- **No regressions**: Existing 523 tests still pass
- **Documentation value**: Tests serve as usage examples
