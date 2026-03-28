# Manual Validation Checklist

## Summary
This refactoring extracted duplicated Git repository operations from `SessionLauncherView.vue` and `WorktreeManagerView.vue` into a reusable `useGitRepository` composable. No functionality was changed - only code organization improved.

## Test Areas

### 1. Session Launcher View (`/orchestration/launcher`)

#### Repository Selection
- [ ] Open Session Launcher
- [ ] Select a repository from the dropdown
- [ ] **Expected**: Default branch loads automatically in the branch field
- [ ] **Expected**: Worktree path preview updates when you enter a branch name

#### Branch Operations
- [ ] Clear the branch field and click "Reset to Default"
- [ ] **Expected**: Branch field populates with the default branch (e.g., "main" or "master")

#### Fetch Remote
- [ ] Select a repository
- [ ] Click the "Fetch Remote" button (if available)
- [ ] **Expected**: Loading indicator appears during fetch
- [ ] **Expected**: Success toast shows "Fetched latest from remote"
- [ ] **Expected**: Branch list refreshes with latest branches

#### Worktree Path Computation
- [ ] Select a repository (e.g., `/home/user/repos/my-project`)
- [ ] Check the "Create Worktree" checkbox
- [ ] Enter a branch name with special characters (e.g., `feature/fix:bug#123`)
- [ ] **Expected**: Preview path shows sanitized branch name (e.g., `/home/user/repos/my-project-feature-fix-bug-123`)
- [ ] **Expected**: Path updates reactively as you type

#### Repository Change
- [ ] Select one repository
- [ ] Note the default branch shown
- [ ] Switch to a different repository
- [ ] **Expected**: Default branch updates to match the new repository
- [ ] **Expected**: Worktree path preview updates with new repository path

### 2. Worktree Manager View (`/orchestration/worktrees`)

#### Create Worktree Modal
- [ ] Open Worktree Manager
- [ ] Click "Create Worktree" button
- [ ] **Expected**: Modal opens with repository selection
- [ ] Select a repository
- [ ] **Expected**: Default branch loads automatically
- [ ] **Expected**: Base branch field populates with default branch

#### Branch Name Entry
- [ ] In the create modal, enter a new branch name (e.g., `feature/new-feature`)
- [ ] **Expected**: Path preview shows computed worktree path
- [ ] **Expected**: Path includes sanitized branch name

#### Repository Change in Modal
- [ ] Open create worktree modal
- [ ] Select repository A, note the default branch
- [ ] Change to repository B
- [ ] **Expected**: Default branch updates to repository B's default
- [ ] **Expected**: Base branch field updates
- [ ] **Expected**: Path preview updates

#### Fetch Remote in Modal
- [ ] Open create worktree modal
- [ ] Select a repository
- [ ] Click "Fetch Remote" button (if available in modal)
- [ ] **Expected**: Loading indicator shows
- [ ] **Expected**: Success toast appears
- [ ] **Expected**: Branch list refreshes

### 3. Error Scenarios

#### Invalid Repository
- [ ] In Session Launcher, manually enter an invalid repository path
- [ ] **Expected**: Default branch stays empty (no error thrown)
- [ ] **Expected**: Worktree path computation returns empty string

#### Network Failure
- [ ] Disconnect network or use repository with no remote
- [ ] Click "Fetch Remote"
- [ ] **Expected**: Error toast appears with appropriate message
- [ ] **Expected**: Loading state clears properly

#### Empty Repository Path
- [ ] Clear repository selection
- [ ] **Expected**: Default branch clears
- [ ] **Expected**: Worktree path preview clears
- [ ] **Expected**: Fetch button disabled or does nothing

### 4. Performance & Reactivity

#### Rapid Repository Switching
- [ ] Quickly switch between multiple repositories
- [ ] **Expected**: Default branch updates correctly for each
- [ ] **Expected**: No race conditions or stale values
- [ ] **Expected**: Loading states manage correctly

#### Concurrent Operations
- [ ] Start a fetch operation
- [ ] While fetching, switch repositories
- [ ] **Expected**: Operations complete gracefully
- [ ] **Expected**: No stuck loading states

### 5. Cross-Platform Paths

#### Windows-Style Paths (if applicable)
- [ ] Test with Windows-style repository path (e.g., `C:\Users\user\repos\project`)
- [ ] Enter a branch name
- [ ] **Expected**: Worktree path computation handles backslashes correctly
- [ ] **Expected**: Path preview shows correct format

### 6. Edge Cases

#### Special Branch Names
Test with various branch names:
- [ ] `feature/JIRA-123` - **Expected**: `feature-JIRA-123`
- [ ] `fix:critical-bug` - **Expected**: `fix-critical-bug`
- [ ] `test#123` - **Expected**: `test-123`
- [ ] `release/v1.0.0` - **Expected**: `release-v1.0.0`

#### Empty Branch Name
- [ ] Enter a branch name, then delete it completely
- [ ] **Expected**: Worktree path preview shows empty string

#### Very Long Branch Name
- [ ] Enter a very long branch name (100+ characters)
- [ ] **Expected**: Path computation completes without error
- [ ] **Expected**: Preview updates correctly

## Regression Checklist

### No Visual Changes
- [ ] Session Launcher layout looks identical to before
- [ ] Worktree Manager layout looks identical to before
- [ ] All buttons, inputs, and labels in same positions

### No Behavioral Changes
- [ ] Session launching works the same as before
- [ ] Worktree creation works the same as before
- [ ] All toasts and error messages appear as expected
- [ ] Loading states behave identically

### Integration Points
- [ ] Template selection in Session Launcher still works
- [ ] Branch list population works in both views
- [ ] Navigation between views works correctly
- [ ] URL parameters respected in Session Launcher

## Success Criteria

✅ **All functionality works exactly as before**
✅ **No new errors in console**
✅ **No visual regressions**
✅ **Loading states work correctly**
✅ **Error handling works properly**
✅ **Path computation is accurate**
✅ **Reactivity updates as expected**

## Known Limitations

1. **Worktree Manager Fetch Scope**: The `handleFetchRemote` in WorktreeManagerView currently only works in the create modal context (operates on `createModalRepoPath`). This matches the original behavior where fetch was primarily used during worktree creation.

2. **Auto-loading**: The composable automatically loads the default branch when `repoPath` changes. This is more efficient than manual loading but means the watcher pattern changed slightly.

## Testing Tips

- **Use DevTools**: Open Vue DevTools to inspect reactive state
- **Check Console**: Monitor for any errors or warnings
- **Test Quickly**: Try operations in rapid succession to catch race conditions
- **Test Slowly**: Also test with delays to ensure debouncing works
- **Multiple Repos**: Test with at least 2-3 different repositories
- **Real vs Mock**: If possible, test with real Git repositories

## If Issues Found

If any functionality doesn't work as expected:

1. **Check Console**: Look for JavaScript errors
2. **Check Network**: Ensure Git operations are being called
3. **Check State**: Use Vue DevTools to inspect `defaultBranch`, `fetchingRemote`, etc.
4. **Compare Behavior**: Try the same operation on the main branch
5. **Document**: Note the exact steps to reproduce
6. **Report**: Include repository path, branch name, and error messages

## Files Changed

- **New**: `apps/desktop/src/composables/useGitRepository.ts` (170 lines)
- **New**: `apps/desktop/src/composables/__tests__/useGitRepository.test.ts` (310 lines)
- **Modified**: `apps/desktop/src/views/orchestration/SessionLauncherView.vue` (-80 lines)
- **Modified**: `apps/desktop/src/views/orchestration/WorktreeManagerView.vue` (-70 lines)

## Automated Testing

All automated tests pass:
- ✅ 511 total tests pass (including 25 new composable tests)
- ✅ TypeScript compilation clean
- ✅ Build successful
