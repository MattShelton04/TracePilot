# Comprehensive Implementation Plan: Clean Up Dead Code

## Executive Summary

**Problem**: TracePilot has accumulated 830+ instances of dead code (682 unused variables + 148 unused imports) across the codebase. This creates maintenance burden, increases bundle size, and makes the code harder to navigate.

**Solution**: Systematically remove all unused imports and variables while maintaining functionality.

**Impact**:
- Improved code maintainability and readability
- Reduced bundle size
- Better developer experience
- Cleaner codebase for future contributions
- Reduced cognitive load when reading code

**Risk Level**: Low - removing unused code is safe if done correctly with comprehensive testing

---

## Current State Analysis

### Violation Distribution

**By Category:**
- 682 unused variables (functions, constants, refs, computed properties)
- 148 unused imports

**Top 10 Files with Most Violations:**
1. `NestedSwimlanesView.vue` - 35 violations
2. `ConfigInjectorView.vue` - 34 violations
3. `AgentTreeView.vue` - 28 violations
4. `WorktreeManagerView.vue` - 27 violations
5. `SessionLauncherView.vue` - 25 violations
6. `ModelComparisonView.vue` - 24 violations
7. `TurnWaterfallView.vue` - 23 violations
8. `TodoDependencyGraph.vue` - 23 violations
9. `AnalyticsDashboardView.vue` - 22 violations
10. `SessionSearchView.vue` - 21 violations

**Pattern Analysis:**
- Most violations are in large Vue files (1000+ lines)
- Common pattern: functions/variables created for features that were removed or never implemented
- Examples:
  - `showWhatsNew` system in App.vue (7 unused vars/functions)
  - Agent upgrade utilities in ConfigInjectorView (3 unused functions)
  - Tool result loading in NestedSwimlanesView (6 unused from useToolResultLoader)
  - Breadcrumb navigation (unused computed property)

### Existing Infrastructure

**Good News:**
- Biome is configured and working
- 682+ warnings exist (not errors) - intentional linting baseline
- Can use `npx @biomejs/biome check --write` for auto-fix
- Comprehensive test suite exists (824 tests across 71 files)

---

## Implementation Strategy

### Phase 1: Automated Cleanup (Safe Auto-fixes)

**Approach**: Use Biome's auto-fix capability with validation

**Steps:**
1. Run baseline tests to ensure current state is passing
2. Run `npx @biomejs/biome check --write` to auto-fix unused imports/variables
3. Run tests again to catch any regressions
4. Review the diff to understand what was removed
5. Manually investigate any test failures

**Risk Mitigation:**
- Biome only removes truly unused code (it understands Vue/TS semantics)
- Comprehensive test suite will catch functional regressions
- Git provides rollback if needed

**Expected Fixes:**
- All 148 unused imports (safe - imports can't have side effects in this codebase)
- Most unused variables (Biome is conservative)

### Phase 2: Manual Review of Remaining Issues

**Approach**: Handle cases Biome can't auto-fix

**Scenarios Requiring Manual Review:**
1. **False Positives**: Variables used in templates but Biome can't detect
2. **Intentional Dead Code**: Future features or commented-out code
3. **Complex Dependencies**: Variables that look unused but have side effects
4. **Type-only imports**: May need explicit `type` keyword

**Process:**
1. Review remaining violations after auto-fix
2. For each violation:
   - Check if variable is used in template/style blocks
   - Check if it has side effects (reactive watchers, lifecycle hooks)
   - Check git history to understand why it was added
   - Decide: remove, keep with explanation, or refactor

### Phase 3: Verification & Testing

**Testing Strategy:**

**1. Automated Tests:**
```bash
# UI package (568 tests)
pnpm --filter @tracepilot/ui test

# Desktop app (256 tests)
pnpm --filter @tracepilot/desktop test

# Type checking
pnpm -r typecheck
```

**2. Manual Smoke Testing:**
- Launch the desktop app
- Navigate through all major views:
  - Session list
  - Session detail (all tabs)
  - Timeline views (tree, swimlanes, waterfall)
  - Search interface
  - Analytics dashboard
  - Config injector
  - Worktree manager
  - Session launcher
- Test key interactions:
  - Create/view sessions
  - Search and filter
  - View timeline visualizations
  - Edit configuration
  - Manage worktrees

**3. Visual Regression Checks:**
- Compare UI before/after
- Ensure no missing components
- Verify styling is intact
- Check for console errors

---

## Detailed File-by-File Plan

### High-Priority Files (35+ violations)

#### `apps/desktop/src/components/timeline/NestedSwimlanesView.vue` (35 violations)

**Identified Dead Code:**
```typescript
// Line 31: Unused store reference
const prefs = usePreferencesStore();

// Lines 32-32: Unused tool result loader (entire destructure)
const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } = useToolResultLoader();

// Line 42: Unused function
function agentLiveDuration(agent: TurnToolCall): number | undefined { ... }

// Line 52-53: Unused Set tracking
const turnSet = useToggleSet();
const agentSet = useToggleSet();

// Line 56: Unused message expansion tracking
const expandedMessages = useToggleSet();

// Lines 59-62: Unused message index tracking
function getAssistantMsgIdx(turnIdx: number, callIdx: number): number { ... }
function setAssistantMsgIdx(turnIdx: number, callIdx: number, msgIdx: number) { ... }

// Line 69: Unused tool selection
function selectTool(tc: TurnToolCall) { ... }

// Line 79: Unused selection check
function isSelected(tc: TurnToolCall): boolean { ... }

// Line 105: Unused turn ownership check
function turnOwnsSelected(turn: ConversationTurn): boolean { ... }

// Line 128: Unused nested tool counter
function countNestedTools(agent: TurnToolCall): number { ... }

// Line 135: Unused color function
function agentColor(agent: TurnToolCall): string { ... }

// Line 193-197: Unused phase utilities
function phaseDurationMs(phase: TurnPhase): number | undefined { ... }
function phaseToolCount(phase: TurnPhase): number { ... }

// Unused imports: multiple from @tracepilot/types, @tracepilot/ui
```

**Why This Dead Code Exists:**
- Looks like this component was refactored from AgentTreeView
- Many functions were copied but not used in the simplified swimlanes view
- Tool detail panel was removed (hence unused selection logic)

**Cleanup Plan:**
- Remove all unused imports
- Remove all unused functions and variables
- Verify swimlanes still render correctly
- Verify no template references to removed code

---

#### `apps/desktop/src/views/orchestration/ConfigInjectorView.vue` (34 violations)

**Identified Dead Code:**
```typescript
// Line 31: Unused agent metadata lookup
function agentMeta(id: string): AgentDefinition | undefined { ... }

// Lines 36-39: Unused model categorization constants
const ALL_MODELS = [...];
const STANDARD_MODELS = [...];
const FAST_MODELS = [...];

// Lines 41-49: Unused model tier utilities
function modelTier(modelId: string): 'premium' | 'standard' | 'fast' | 'unknown' { ... }
function tierLabel(tier: string): string { ... }

// Line 50: Unused tabs array (using string literals instead)
const tabs = ['Agent Models', 'Global Config', 'Environment', 'Backups'];

// Lines 57-77: Unused computed utilities
function tabCount(tabName: string): number { ... }
const uniqueModelCount = computed(...);
const premiumAgentCount = computed(...);
function visibleTools(...): string[] { ... }
function hiddenToolCount(...): number { ... }

// Lines 123-143: Unused agent upgrade functions
function upgradeAgent(agentId: string, newModel: string) { ... }
function upgradeAllToOpus() { ... }
function resetAllDefaults() { ... }

// Line 171: Unused folder adding
function addFolder() { ... }

// Line 20: Unused dismissable state
const { warningDismissed, dismissWarning } = useDismissableState('config-injector-warning');

// Unused imports from @tracepilot/ui
```

**Why This Dead Code Exists:**
- Bulk upgrade features were planned but not implemented
- Model tier badges were removed from UI
- Tab counting was used for old UI design
- Warning system was removed

**Cleanup Plan:**
- Remove all unused upgrade functions (future feature)
- Remove unused model categorization
- Remove unused computed properties
- Keep core config editing functionality intact

---

#### `apps/desktop/src/App.vue` (21 violations)

**Identified Dead Code:**
```typescript
// Lines 6-13: Unused component imports
import ErrorBoundary from '@/components/ErrorBoundary.vue';
import IndexingLoadingScreen from '@/components/IndexingLoadingScreen.vue';
import SearchPalette from '@/components/SearchPalette.vue';
import BreadcrumbNav from '@/components/layout/BreadcrumbNav.vue';
import SetupWizard from '@/components/SetupWizard.vue';
import UpdateInstructionsModal from '@/components/UpdateInstructionsModal.vue';
import WhatsNewModal from '@/components/WhatsNewModal.vue';
// ... plus more

// Line 19: Unused utility import
import { openExternal } from '@/utils/openExternal';

// Line 30: Unused update modal state
const showUpdateModal = ref(false);

// Lines 33-39: Entire What's New system unused
const {
  showWhatsNew,
  whatsNewPreviousVersion,
  whatsNewCurrentVersion,
  whatsNewEntries,
  whatsNewReleaseUrl,
  openWhatsNew,
  closeWhatsNew,
} = useWhatsNew();

// Lines 86-114: Unused lifecycle handlers
function onSetupSaved(sessionCount: number) { ... }
function onSetupComplete() { ... }
function onIndexingComplete() { ... }

// Line 116: Unused breadcrumbs
const breadcrumbs = computed(() => { ... });
```

**Why This Dead Code Exists:**
- App was refactored to simplify routing
- What's New modal system was disabled/removed
- Setup wizard and indexing screens were moved or removed
- Breadcrumbs replaced by different navigation system

**Cleanup Plan:**
- Verify these components are truly unused in template
- Remove all unused imports
- Remove What's New system (unless user wants it)
- Remove unused lifecycle handlers
- Keep core app routing and config loading

**CRITICAL CHECK**: Need to verify template doesn't reference these components

---

### Medium-Priority Files (20-28 violations)

Similar patterns in:
- `AgentTreeView.vue` (28)
- `WorktreeManagerView.vue` (27)
- `SessionLauncherView.vue` (25)
- `ModelComparisonView.vue` (24)
- `TurnWaterfallView.vue` (23)
- `TodoDependencyGraph.vue` (23)
- `AnalyticsDashboardView.vue` (22)
- `SessionSearchView.vue` (21)

**Common Dead Code Patterns:**
1. Unused tool result loading composables
2. Unused toggle/expansion state
3. Unused formatting/utility functions
4. Unused event handlers
5. Unused computed properties for removed UI features

---

## Testing & Validation Plan

### Pre-Implementation Validation

**1. Establish Baseline:**
```bash
# Ensure all tests pass BEFORE cleanup
pnpm --filter @tracepilot/ui test
pnpm --filter @tracepilot/desktop test
pnpm -r typecheck

# Capture current lint baseline
npx @biomejs/biome check --reporter=summary > /tmp/baseline-before.txt
```

**2. Build Verification:**
```bash
# Ensure desktop app builds
pnpm --filter @tracepilot/desktop build
```

### Post-Implementation Validation

**1. Automated Testing:**
```bash
# Run all tests
pnpm --filter @tracepilot/ui test
pnpm --filter @tracepilot/desktop test

# Type checking (catches any removed types still referenced)
pnpm -r typecheck

# Lint verification
npx @biomejs/biome check --reporter=summary

# Build verification
pnpm --filter @tracepilot/desktop build
```

**Expected Results:**
- All tests pass (824 tests)
- No type errors
- Reduced lint warnings (should drop from 1048 to ~200)
- Successful build

**2. Manual Smoke Testing Checklist:**

**Session Management:**
- [ ] Launch app
- [ ] View session list
- [ ] Open a session detail page
- [ ] Navigate between tabs (Overview, Conversation, Timeline, Events, Todos, Metrics, Token Flow)
- [ ] Verify all tabs load correctly

**Timeline Views:**
- [ ] Switch to Agent Tree view
- [ ] Switch to Nested Swimlanes view
- [ ] Switch to Turn Waterfall view
- [ ] Verify visualizations render correctly
- [ ] Test navigation between turns
- [ ] Test selecting agents/tools

**Search & Filtering:**
- [ ] Open search view (Cmd/Ctrl+K)
- [ ] Execute a search query
- [ ] Apply filters
- [ ] Verify results display correctly

**Analytics:**
- [ ] View Analytics Dashboard
- [ ] View Tool Analysis
- [ ] View Code Impact
- [ ] View Model Comparison
- [ ] Verify charts render correctly

**Orchestration:**
- [ ] Open Config Injector
- [ ] Edit agent model configuration
- [ ] Save changes
- [ ] Open Worktree Manager
- [ ] View worktrees
- [ ] Open Session Launcher
- [ ] Verify form works

**Settings:**
- [ ] Open settings
- [ ] Navigate through tabs
- [ ] Verify all settings load

**Visual Checks:**
- [ ] No console errors in DevTools
- [ ] No broken layouts
- [ ] No missing components
- [ ] All colors/styles intact
- [ ] No white/blank screens

**3. Git Diff Review:**
- Review every deletion to confirm it's truly unused
- Check for any template/style block references
- Verify no dynamic property access patterns

---

## Implementation Approach

### Step 1: Run Automated Cleanup

```bash
# Let Biome auto-fix what it can
npx @biomejs/biome check --write
```

**What Biome Will Fix:**
- Unused imports (safe - no side effects in this codebase)
- Unused variables that are clearly not referenced anywhere
- Unused functions with no external callers

**What Biome Won't Fix:**
- Variables that might be used in templates (requires Vue analysis)
- Variables with complex scoping
- Side-effectful code

### Step 2: Manual Review & Cleanup

**For each remaining violation:**

1. **Verify it's truly unused:**
   - Search for references in template
   - Search for references in style blocks
   - Check for dynamic property access patterns like `this[varName]` or `obj[key]`

2. **Understand the intent:**
   - Check git blame to see when it was added
   - Check commit message for context
   - Determine if it's incomplete feature or leftover from refactor

3. **Make the decision:**
   - **Remove**: Clearly unused, no future plans
   - **Keep**: Used in template, has side effects, or planned feature
   - **Refactor**: Code structure needs adjustment

4. **Document decision:**
   - If keeping, add comment explaining why
   - If removing, ensure it's not needed

### Step 3: Handle Special Cases

**Case A: What's New Modal System**
- Location: `App.vue` lines 33-39, components/WhatsNewModal.vue
- Status: Fully implemented but never wired up
- Decision: **Remove** - feature was disabled
- Alternative: Could be enabled if user wants it

**Case B: Agent Upgrade Utilities**
- Location: `ConfigInjectorView.vue` lines 123-143
- Status: Functions defined but no UI to call them
- Decision: **Remove** - feature was planned but not built
- Note: Can be re-implemented later if needed

**Case C: Tool Result Loading**
- Location: Multiple timeline views
- Status: Composable imported but not used
- Decision: **Remove imports** - feature moved to different component
- Note: Actual composable is used elsewhere, just not in these files

**Case D: Breadcrumb Navigation**
- Location: `App.vue` line 116
- Status: Computed property defined but never rendered
- Decision: **Remove** - replaced by AppSidebar navigation
- Note: BreadcrumbNav component is used in other views

### Step 4: Test & Validate

**Per-File Validation Loop:**
1. Clean up file
2. Run type checker: `pnpm --filter @tracepilot/desktop typecheck`
3. If types pass, move to next file
4. If types fail, investigate and fix

**After All Files:**
1. Run full test suite
2. Run desktop app and execute manual smoke test
3. Review git diff for any surprises
4. Check bundle size reduction

---

## Detailed Code Changes

### File: `apps/desktop/src/App.vue`

**Lines 5-13: Remove unused component imports**
```diff
- import { ConfirmDialog, ToastContainer } from '@tracepilot/ui';
- import ErrorBoundary from '@/components/ErrorBoundary.vue';
- import IndexingLoadingScreen from '@/components/IndexingLoadingScreen.vue';
- import SearchPalette from '@/components/SearchPalette.vue';
- import AppSidebar from '@/components/layout/AppSidebar.vue';
- import BreadcrumbNav from '@/components/layout/BreadcrumbNav.vue';
- import SetupWizard from '@/components/SetupWizard.vue';
- import UpdateInstructionsModal from '@/components/UpdateInstructionsModal.vue';
- import WhatsNewModal from '@/components/WhatsNewModal.vue';
```

**WAIT - Need to check template first!** These might be used.

**Line 19: Remove unused utility**
```diff
- import { openExternal } from '@/utils/openExternal';
```

**Lines 30-39: Remove What's New system**
```diff
- const showUpdateModal = ref(false);
-
- const {
-   showWhatsNew,
-   whatsNewPreviousVersion,
-   whatsNewCurrentVersion,
-   whatsNewEntries,
-   whatsNewReleaseUrl,
-   openWhatsNew,
-   closeWhatsNew,
- } = useWhatsNew();
```

**Lines 75-84: Simplify checkVersionChange**
```diff
  async function checkVersionChange() {
    const current = appVersion.value;
    if (current === 'dev') return;

    const previous = prefsStore.lastSeenVersion;
-   if (previous && previous !== current) {
-     await openWhatsNew(previous, current);
-   }
    prefsStore.lastSeenVersion = current;
  }
```

**Lines 86-114: Remove unused lifecycle handlers**
```diff
- function onSetupSaved(sessionCount: number) { ... }
- function onSetupComplete() { ... }
- async function onIndexingComplete() { ... }
```

**Line 116: Remove unused breadcrumbs**
```diff
- const breadcrumbs = computed(() => { ... });
```

**Expected Impact:**
- ~50 lines removed
- 21 warnings eliminated
- Clearer app initialization logic

---

### File: `apps/desktop/src/components/timeline/NestedSwimlanesView.vue`

**Remove unused composables:**
```diff
- const prefs = usePreferencesStore();
- const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } = useToolResultLoader();
- const turnSet = useToggleSet();
- const agentSet = useToggleSet();
- const expandedMessages = useToggleSet();
```

**Remove unused functions:**
```diff
- function agentLiveDuration(agent: TurnToolCall): number | undefined { ... }
- function getAssistantMsgIdx(turnIdx: number, callIdx: number): number { ... }
- function setAssistantMsgIdx(turnIdx: number, callIdx: number, msgIdx: number) { ... }
- function selectTool(tc: TurnToolCall) { ... }
- function isSelected(tc: TurnToolCall): boolean { ... }
- function turnOwnsSelected(turn: ConversationTurn): boolean { ... }
- function countNestedTools(agent: TurnToolCall): number { ... }
- function agentColor(agent: TurnToolCall): string { ... }
- function phaseDurationMs(phase: TurnPhase): number | undefined { ... }
- function phaseToolCount(phase: TurnPhase): number { ... }
```

**Expected Impact:**
- ~100 lines removed
- 35 warnings eliminated
- Simplified component logic

---

### File: `apps/desktop/src/views/orchestration/ConfigInjectorView.vue`

**Remove unused model tier system:**
```diff
- function agentMeta(id: string): AgentDefinition | undefined { ... }
- const ALL_MODELS = [...];
- const STANDARD_MODELS = [...];
- const FAST_MODELS = [...];
- function modelTier(modelId: string): 'premium' | 'standard' | 'fast' | 'unknown' { ... }
- function tierLabel(tier: string): string { ... }
```

**Remove unused UI utilities:**
```diff
- const tabs = ['Agent Models', 'Global Config', 'Environment', 'Backups'];
- function tabCount(tabName: string): number { ... }
- const uniqueModelCount = computed(...);
- const premiumAgentCount = computed(...);
- function visibleTools(...): string[] { ... }
- function hiddenToolCount(...): number { ... }
```

**Remove unused bulk actions:**
```diff
- function upgradeAgent(agentId: string, newModel: string) { ... }
- function upgradeAllToOpus() { ... }
- function resetAllDefaults() { ... }
- function addFolder() { ... }
```

**Remove unused warning state:**
```diff
- const { warningDismissed, dismissWarning } = useDismissableState('config-injector-warning');
```

**Expected Impact:**
- ~150 lines removed
- 34 warnings eliminated
- Clearer config editing logic

---

### Files: Timeline Views (AgentTreeView, TurnWaterfallView)

**Similar patterns to NestedSwimlanesView:**
- Unused tool result loading
- Unused selection tracking
- Unused formatting utilities

**Approach:** Same as NestedSwimlanesView - let Biome auto-fix most, manually review the rest.

---

### Files: Other Views (ModelComparison, SessionLauncher, etc.)

**Pattern:** Mostly unused imports from refactoring

**Approach:** Let Biome auto-fix all unused imports

---

## Risk Assessment & Mitigation

### High-Risk Scenarios

**Risk 1: Template-only References**
- **Scenario**: Variable used in Vue template but not in script
- **Likelihood**: Medium
- **Mitigation**: Review each file's template section before removal
- **Detection**: Type errors or runtime errors during testing

**Risk 2: Dynamic Property Access**
- **Scenario**: Variable accessed via `obj[key]` pattern
- **Likelihood**: Low (codebase doesn't use this pattern much)
- **Mitigation**: Search for bracket notation before removal
- **Detection**: Runtime errors during testing

**Risk 3: Side-Effect Only Code**
- **Scenario**: Variable/function exists for its side effects (watchers, etc.)
- **Likelihood**: Low (Vue Composition API is explicit about side effects)
- **Mitigation**: Review code context before removal
- **Detection**: Functionality breaks during testing

**Risk 4: Future Feature Code**
- **Scenario**: Code for incomplete feature that user wants to keep
- **Likelihood**: Medium
- **Mitigation**: Check git history, ask user if unsure
- **Detection**: User feedback

### Mitigation Strategy

**1. Conservative Auto-Fix:**
- Trust Biome for imports (safe)
- Trust Biome for clearly unused variables
- Manual review for anything Biome skips

**2. Incremental Validation:**
- Fix one major file at a time
- Run tests after each file
- Commit working changes incrementally

**3. Comprehensive Testing:**
- Full test suite (824 tests)
- Type checking (catches most issues)
- Manual smoke testing (catches UI issues)

**4. Easy Rollback:**
- Each file is a separate commit
- Can cherry-pick successful changes if issues found

---

## Success Criteria

**Quantitative:**
- ✅ Unused imports reduced from 148 to 0
- ✅ Unused variables reduced from 682 to <100 (some false positives expected)
- ✅ All 824 tests passing
- ✅ No type errors
- ✅ Successful production build

**Qualitative:**
- ✅ Code is easier to read and navigate
- ✅ No missing functionality
- ✅ UI works identically to before
- ✅ No console errors
- ✅ Improved developer experience

---

## Rollback Plan

**If Issues Found:**
1. Identify problematic file via failing test
2. `git revert <commit-hash>` for that file
3. Manually investigate the issue
4. Re-apply cleanup with fix

**If Major Issues:**
1. `git reset --hard HEAD~N` to rollback all changes
2. Re-analyze the approach
3. Take more conservative strategy

---

## Timeline Estimate

**Phase 1: Automated Cleanup** - 5 minutes
- Run Biome auto-fix
- Initial commit

**Phase 2: Manual Review** - 15-20 minutes
- Review top 10 files with most violations
- Check templates for usage
- Remove clearly unused code
- Commits per file

**Phase 3: Testing** - 10-15 minutes
- Run test suite
- Run type checker
- Build desktop app
- Manual smoke testing

**Phase 4: Refinement** - 5-10 minutes
- Fix any issues found
- Final validation
- Documentation

**Total: 35-50 minutes**

---

## Implementation Order

**Phase 1: Quick Wins (Auto-fixable)**
1. Run `npx @biomejs/biome check --write`
2. Review diff
3. Test & commit

**Phase 2: High-Impact Files (Manual)**
1. `App.vue` - 21 violations (check template first!)
2. `ConfigInjectorView.vue` - 34 violations
3. `NestedSwimlanesView.vue` - 35 violations
4. Test after each file

**Phase 3: Medium Files (Semi-automated)**
5-10. Other large views (20-28 violations each)
11. Test after all medium files

**Phase 4: Small Files (Bulk)**
- Remaining files with <10 violations
- Batch commit after all are done

**Phase 5: Final Validation**
- Full test suite
- Manual smoke testing
- Build verification

---

## Expected Outcomes

### Code Quality Improvements

**Before:**
- 682 unused variables
- 148 unused imports
- 1,048 total lint warnings
- Large files with cluttered code

**After:**
- ~0 unused imports
- <100 unused variables (only false positives)
- ~200-300 total lint warnings
- Cleaner, more focused code

### Developer Experience Improvements

1. **Easier Navigation**: Less noise when reading code
2. **Faster IDE**: Fewer symbols to index
3. **Clearer Intent**: Only code that matters remains
4. **Better Onboarding**: New contributors see cleaner code
5. **Reduced Confusion**: No wondering "is this used?"

### Maintenance Benefits

1. **Easier Refactoring**: Less dead code to work around
2. **Faster Builds**: Smaller dependency graph
3. **Better Search**: Search results less cluttered
4. **Clearer History**: Git blame shows relevant code

---

## Alternative Approaches Considered

### Alternative 1: Manual Review First, Then Auto-fix
**Pros**: More control, better understanding
**Cons**: Much slower (hours vs minutes)
**Decision**: Rejected - auto-fix is safe and fast

### Alternative 2: Only Fix Top 10 Files
**Pros**: Lower risk, faster
**Cons**: Leaves 75% of violations unfixed
**Decision**: Rejected - we want comprehensive cleanup

### Alternative 3: Add Comments Instead of Removing
**Pros**: Preserves code for future reference
**Cons**: Doesn't solve the problem, adds more clutter
**Decision**: Rejected - git history preserves removed code

### Alternative 4: Create New Types/Abstractions
**Pros**: Could improve architecture
**Cons**: Over-engineering, not the goal
**Decision**: Rejected - this is cleanup, not refactor

---

## Dependencies & Prerequisites

**Required Tools:**
- Node.js / pnpm (already installed)
- Biome (via npx, already configured)
- Git (for commits and rollback)

**Required Knowledge:**
- Vue 3 Composition API semantics
- Biome lint rules
- TypeScript type system
- Testing with Vitest

**Blocked By:**
- None - can start immediately

---

## Future Improvements

**After This PR:**
1. Enable stricter lint rules (promote warnings to errors)
2. Add pre-commit hook to prevent unused code
3. Configure Biome to auto-fix on save in IDE
4. Add CI check for unused code
5. Review and clean up remaining violations periodically

**Related Tech Debt** (from tech-debt-report.md):
- Large Vue files (2000+ lines) - separate effort
- Hardcoded colors - separate effort
- Type safety improvements - separate effort
- Test coverage gaps - separate effort

This cleanup lays groundwork for future improvements by reducing noise.

---

## Communication Plan

**User Validation Checklist** (to be provided at end):

The user requested a list of things to check after implementation. Here's what they should test:

**Critical Paths to Test:**
1. **App Launch**: App starts without errors
2. **Session List**: Can view and filter sessions
3. **Session Detail**: All tabs load (Overview, Conversation, Timeline, etc.)
4. **Timeline Views**: Switch between Tree/Swimlanes/Waterfall - all render correctly
5. **Search**: Cmd/Ctrl+K opens search, results display
6. **Config Injector**: Can edit agent models and save
7. **Worktree Manager**: Can view and manage worktrees
8. **Session Launcher**: Can create new sessions
9. **Analytics**: All charts and dashboards render
10. **Settings**: All settings pages load

**Red Flags to Watch For:**
- Console errors in DevTools
- Blank/white screens
- Missing buttons or UI elements
- Broken navigation
- Failed data loading
- Styling issues

---

## Conclusion

This cleanup removes **830+ instances of dead code** with **low risk** and **high value**. The automated approach with comprehensive testing ensures we maintain functionality while improving code quality.

The key insight is that most of this dead code came from:
1. Incomplete features that were planned but not finished
2. Refactoring that left old code behind
3. UI redesigns that removed functionality

By cleaning this up, we make the codebase more maintainable and easier to work with for future development.
