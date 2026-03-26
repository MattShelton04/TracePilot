# Plan: Consolidate Formatting Utilities into Shared Package

## Problem Statement

The TracePilot codebase has duplicated formatting utilities across multiple packages:

1. **`packages/ui/src/utils/formatters.ts`** - Contains comprehensive formatting utilities including:
   - `formatNumber(n)` - Abbreviates numbers (1200 → "1.2K", 1500000 → "1.5M")
   - `formatDuration(ms)` - Formats milliseconds to human-readable duration
   - `formatCost(cost)` - Formats USD values
   - `formatDate`, `formatTime`, `formatRelativeTime`, etc.
   - `toErrorMessage(e)` - Error handling utility
   - And ~15 other formatting functions

2. **`apps/cli/src/commands/utils.ts`** - Contains:
   - `formatTokens(n)` - Identical implementation to `formatNumber` but named for tokens

**Current Issues:**
- **Code Duplication**: `formatTokens` duplicates `formatNumber` logic
- **Inconsistent Imports**: CLI imports from its own utils, UI/Desktop imports from `@tracepilot/ui`
- **Maintenance Burden**: Changes to formatting logic must be made in multiple places
- **Naming Confusion**: `formatNumber` is used for tokens throughout the UI, but CLI uses `formatTokens`
- **Package Architecture Violation**: Formatting utilities in `@tracepilot/ui` couples UI components with formatting logic that should be reusable by CLI

**Impact on Codebase:**
- 21 files currently use formatters from `packages/ui/src/utils/formatters.ts`
- CLI has its own implementation that can drift from UI implementation
- `@tracepilot/types` is the natural home for shared utilities (already exists, no build step needed)

## Proposed Solution

**Move all formatting utilities from `@tracepilot/ui` to `@tracepilot/types`**, creating a new `utils/formatters.ts` module that both CLI and Desktop/UI can import.

### Benefits:
1. **Single Source of Truth**: One implementation, no drift
2. **Better Architecture**: Separates presentation formatting from UI components
3. **CLI Access**: CLI can use all formatters without importing from UI package
4. **Zero Breaking Changes**: All existing imports continue to work via barrel re-exports
5. **Type Safety**: All utilities remain strongly typed
6. **No Build Overhead**: Types package is source-only (no compilation needed)

### Architecture Decision:

```
Before:
apps/cli/src/commands/utils.ts (formatTokens)
packages/ui/src/utils/formatters.ts (formatNumber, formatDuration, etc.)

After:
packages/types/src/utils/formatters.ts (all formatters, including formatTokens)
packages/ui/src/utils/formatters.ts (re-export for backwards compatibility)
apps/cli/src/commands/utils.ts (remove formatTokens, import from @tracepilot/types)
```

## Detailed Implementation Plan

### Phase 1: Setup New Shared Utilities Module

**1.1. Create `packages/types/src/utils/` directory**
- Create directory structure for utilities

**1.2. Move formatters to types package**
- Copy `packages/ui/src/utils/formatters.ts` → `packages/types/src/utils/formatters.ts`
- Keep all existing functions:
  - `formatDuration(ms)`
  - `formatDate(dateStr)`, `formatShortDate`, `formatTime`, `formatRelativeTime`
  - `formatNumber(n)` - The main number abbreviation function
  - `formatCost(cost)`, `formatBytes(bytes)`
  - `formatLiveDuration(ms)`, `formatRate`, `formatPercent`
  - `formatDateShort`, `formatDateMedium`, `formatNumberFull`
  - `toErrorMessage(e, fallback)`
- Add new **alias** for CLI compatibility:
  ```typescript
  /** Alias for formatNumber - formats token counts (e.g. 1234567 → "1.2M") */
  export function formatTokens(n?: number | null): string {
    return formatNumber(n);
  }
  ```

**1.3. Update `packages/types/src/index.ts`**
- Add barrel export: `export * from './utils/formatters.js';`
- Ensures all formatters are available via `import { formatNumber } from '@tracepilot/types'`

**1.4. Update types package.json exports**
- Add subpath export for direct imports (optional but good practice):
  ```json
  "exports": {
    ".": "./src/index.ts",
    "./utils/formatters": "./src/utils/formatters.ts"
  }
  ```

### Phase 2: Update UI Package

**2.1. Replace `packages/ui/src/utils/formatters.ts` with re-exports**
- Replace entire file content with:
  ```typescript
  /**
   * Re-exports from @tracepilot/types for backwards compatibility.
   * All formatting utilities have been moved to @tracepilot/types.
   */
  export * from '@tracepilot/types';
  ```
- This ensures **zero breaking changes** for existing UI components

**2.2. Update `packages/ui/src/index.ts`**
- Verify that `formatters` utilities are exported (if they were before)
- Ensure barrel export includes re-exported formatters

**2.3. Verify UI package dependencies**
- Confirm `@tracepilot/types` is already in `packages/ui/package.json` dependencies (it should be)

### Phase 3: Update CLI Package

**3.1. Remove duplicate `formatTokens` from CLI utils**
- In `apps/cli/src/commands/utils.ts`:
  - Remove lines 105-112 (the `formatTokens` function)
  - Add import: `import { formatTokens } from '@tracepilot/types';`
  - Keep all other CLI-specific utilities (UUID_REGEX, getSessionStateDir, findSession, parseWorkspace, streamEvents, fileExists)

**3.2. Update CLI imports**
- Search for any direct imports of `formatTokens` from './utils'
- All should automatically work after step 3.1 (named export maintained)

**3.3. Verify CLI package dependencies**
- Confirm `@tracepilot/types` is in `apps/cli/package.json` dependencies

### Phase 4: Update Desktop Package

**4.1. Verify Desktop imports**
- Desktop currently imports from `@tracepilot/ui` (e.g., `import { toErrorMessage } from '@tracepilot/ui'`)
- These should continue working unchanged due to re-exports in Phase 2.1

**4.2. Optional: Update to direct imports**
- Could update Desktop to import from `@tracepilot/types` instead:
  ```typescript
  // Before: import { formatDuration, toErrorMessage } from '@tracepilot/ui';
  // After:  import { formatDuration, toErrorMessage } from '@tracepilot/types';
  ```
- This is **optional** - re-exports provide compatibility either way

### Phase 5: Testing & Validation

**5.1. TypeScript Type Checking**
- Run `pnpm typecheck` in root to verify no type errors
- Run `pnpm --filter @tracepilot/types typecheck`
- Run `pnpm --filter @tracepilot/ui typecheck`
- Run `pnpm --filter @tracepilot/desktop typecheck`
- Run `pnpm --filter @tracepilot/cli typecheck`

**5.2. Unit Tests**
- Run `pnpm --filter @tracepilot/ui test` (should pass - formatters have tests)
- Run `pnpm --filter @tracepilot/desktop test`
- Tests should pass unchanged due to re-exports

**5.3. CLI Functional Testing**
- Test `pnpm --filter @tracepilot/cli start list` command
- Verify token counts display correctly with `formatTokens`
- Test `pnpm --filter @tracepilot/cli start show <session-id>`
- Verify formatting is consistent

**5.4. Desktop App Testing**
- Build and run desktop app: `pnpm --filter @tracepilot/desktop dev`
- Navigate to Analytics view - verify number formatting (uses `formatNumber`)
- Navigate to Session Detail - verify duration formatting (uses `formatDuration`)
- Check Timeline view - verify tool call formatting
- Verify error messages display correctly (uses `toErrorMessage`)

**5.5. Integration Testing**
- Create a test session with large token counts (>1M tokens)
- Verify CLI shows "1.2M tokens" format
- Verify Desktop Analytics shows same "1.2M" format
- Confirm consistency across both interfaces

### Phase 6: Documentation & Memory Storage

**6.1. Update code comments**
- Add JSDoc to `packages/types/src/utils/formatters.ts` explaining this is the canonical location
- Add deprecation notice in UI re-export file (soft deprecation, not breaking)

**6.2. Store memory**
- Use `store_memory` tool to record:
  - Subject: "formatting utilities"
  - Fact: "All formatting utilities (formatDuration, formatNumber/formatTokens, formatCost, toErrorMessage, etc.) are in @tracepilot/types/utils/formatters. Import from @tracepilot/types, not @tracepilot/ui."
  - Citations: packages/types/src/utils/formatters.ts

**6.3. Update migration notes**
- Document that formatters moved from UI to types package
- Note that re-exports maintain backwards compatibility

## Code Changes Summary

### Files Created/Modified:

**Created:**
1. `packages/types/src/utils/formatters.ts` (moved from UI package)

**Modified:**
2. `packages/types/src/index.ts` - Add formatters export
3. `packages/types/package.json` - Add exports subpath (optional)
4. `packages/ui/src/utils/formatters.ts` - Replace with re-exports
5. `apps/cli/src/commands/utils.ts` - Remove formatTokens, import from types

**Unchanged (verified):**
- All 21 files that import formatters - work via re-exports
- All Desktop components - continue importing from `@tracepilot/ui`
- All tests - pass unchanged

### Lines of Code Impact:
- **Removed duplication**: ~10 lines (formatTokens function)
- **New code**: ~5 lines (import + re-export statements)
- **Net change**: Reduces effective codebase by ~5 lines, consolidates 2 implementations into 1

## Risk Assessment & Mitigation

### Risks:

1. **Import Resolution Issues**
   - Risk: TypeScript may not resolve re-exports correctly
   - Mitigation: Use `export *` which TypeScript handles well; verify with typecheck

2. **Circular Dependency**
   - Risk: types → ui → types cycle
   - Mitigation: This actually **breaks** existing cycle (ui won't depend on types for formatters anymore internally)

3. **Build/Bundle Size**
   - Risk: Importing formatters into types increases bundle size
   - Mitigation: Types package is source-only (no build), tree-shaking works normally

4. **Test Failures**
   - Risk: Tests may fail due to import changes
   - Mitigation: Re-exports maintain compatibility; run full test suite before/after

### Mitigation Strategy:
- Make changes incrementally with typecheck after each phase
- Maintain re-exports for full backwards compatibility
- Run comprehensive test suite at each phase
- Test both CLI and Desktop apps manually

## Success Criteria

✅ **Functionality:**
- CLI `list` and `show` commands display correctly formatted numbers
- Desktop Analytics view shows correctly formatted metrics
- All formatting functions work identically to before

✅ **Code Quality:**
- Zero code duplication between CLI and UI formatters
- Single source of truth in `@tracepilot/types`
- Clear, maintainable import paths

✅ **Testing:**
- All existing tests pass (`pnpm -r test`)
- All type checks pass (`pnpm -r typecheck`)
- Manual testing confirms no regressions

✅ **Architecture:**
- `@tracepilot/types` contains all shared utilities
- `@tracepilot/ui` focuses on components and UI-specific logic
- CLI and Desktop share formatting utilities without duplication

## Testing Checklist

### Automated Tests:
- [ ] `pnpm typecheck` (root) - All packages type-check
- [ ] `pnpm --filter @tracepilot/types typecheck`
- [ ] `pnpm --filter @tracepilot/ui typecheck`
- [ ] `pnpm --filter @tracepilot/ui test` - All UI tests pass
- [ ] `pnpm --filter @tracepilot/desktop typecheck`
- [ ] `pnpm --filter @tracepilot/desktop test` - All Desktop tests pass
- [ ] `pnpm --filter @tracepilot/cli typecheck`

### Manual CLI Testing:
- [ ] CLI builds successfully
- [ ] `tracepilot list` shows correctly formatted token counts
- [ ] `tracepilot show <session>` displays formatted metrics
- [ ] Large numbers (>1M) display as "1.2M" format
- [ ] Small numbers (<1K) display as plain numbers

### Manual Desktop Testing:
- [ ] Desktop app builds successfully
- [ ] Navigate to Session List - verify session metrics display
- [ ] Navigate to Session Detail → Overview tab - verify token counts
- [ ] Navigate to Analytics Dashboard - verify all number formatting
- [ ] Navigate to Tool Analysis view - verify duration formatting
- [ ] Verify Timeline views display correctly formatted durations
- [ ] Test error scenarios - verify `toErrorMessage` works correctly
- [ ] Check Metrics tab - verify cost formatting ($X.XX format)

### Integration Testing:
- [ ] Create/import a new session via Desktop
- [ ] View same session in CLI - verify formatting consistency
- [ ] Session with >1M tokens displays identically in both CLI and Desktop
- [ ] Duration formatting matches between CLI and Desktop
- [ ] Cost calculations display with same precision

### Regression Testing:
- [ ] Existing sessions display correctly
- [ ] Search functionality works (uses formatted numbers)
- [ ] Replay feature displays correctly formatted timestamps
- [ ] Export functionality preserves correct formatting
- [ ] Session comparison view shows correctly formatted metrics

## Rollback Plan

If issues are discovered:

1. **Immediate rollback:**
   - Restore `packages/ui/src/utils/formatters.ts` to original content
   - Restore `apps/cli/src/commands/utils.ts` with formatTokens function
   - Delete `packages/types/src/utils/formatters.ts`
   - Revert `packages/types/src/index.ts` changes

2. **Partial rollback:**
   - Keep formatters in types package
   - Keep both implementations (UI and Types) temporarily
   - Update UI to use Types internally, maintain external API

## Future Enhancements

After this consolidation, consider:

1. **Add more shared utilities to types package:**
   - Color utilities (currently in `agentTypes.ts`)
   - Tool call utilities (currently in `toolCall.ts`)
   - Timeline utilities (currently in `timelineUtils.ts`)

2. **Create comprehensive formatting test suite:**
   - Add tests in types package for all formatters
   - Test edge cases (null, undefined, negative numbers, very large numbers)

3. **Add formatting customization:**
   - Support locale-specific formatting
   - Support user preferences for number formats
   - Add configuration for date/time formats

## Conclusion

This consolidation:
- ✅ Eliminates code duplication
- ✅ Improves architecture (separates concerns)
- ✅ Maintains backwards compatibility (zero breaking changes)
- ✅ Provides clear path for future utility consolidation
- ✅ Improves maintainability (one place to update formatting logic)
- ✅ Enables CLI to access all formatting utilities without depending on UI package

**Estimated Effort:** 1-2 hours
**Risk Level:** Low (re-exports maintain compatibility)
**Impact:** High (better architecture, eliminated duplication, improved maintainability)
