# TracePilot Code Quality Improvement Plan

## Executive Summary

After comprehensive analysis of the TracePilot codebase, most major technical debt items have been addressed in recent refactoring efforts (2026-03-17). However, a critical CSS/theming issue remains that causes visual bugs in light theme and incomplete design system coverage.

## Identified Issue: Incomplete Design System & Theme-Breaking Colors

### Problem Statement

The design system in TracePilot is well-architected with 65+ CSS custom properties, but has gaps that cause:

1. **Theme-breaking hardcoded colors**: Several components use `rgba(255, 255, 255, ...)` values that render incorrectly in light theme
2. **Missing CSS variable definitions**: Three variables are referenced with fallbacks but never defined: `--fg-muted`, `--fg-subtle`, `--text-on-emphasis`
3. **Inconsistent usage**: Some components still use fallback patterns instead of relying on properly defined tokens

### Affected Components (REVISED)

**Critical (Theme-Breaking)**:
1. **ToolAnalysisView.vue:447** - `.heatmap-count` uses `color: rgba(255, 255, 255, 0.85)` which is illegible on light backgrounds

**Undefined Variables (Need Mapping)**:
2. **SessionTimelineView.vue:108,116** - Uses undefined `--fg-muted` and `--fg-subtle` with fallback hex values
3. **SessionLauncherView.vue:1754,1761** - Uses undefined `--fg-muted` and `--fg-default`
4. **SessionSearchView.vue:1420** - Uses undefined `--fg-secondary` with fallback
5. **ConversationTab.vue:779** - Uses undefined `--fg-secondary` with fallback
6. **chart-shared.css:71** - Uses undefined `--text-on-emphasis` with fallback (will be defined)
7. **TimeRangeFilter.vue:151** - Uses undefined `--text-on-emphasis` with fallback (will be defined)

**Hardcoded Colors (Need CSS Variables)**:
8. **TodoDependencyGraph.vue:769,964** - `rgba(255, 255, 255, 0.2)` borders in filter chips and legend (opacity too high for `--border-muted`)
9. **SessionSearchView.vue:1736** - Filter chip remove button uses `rgba(255, 255, 255, 0.15)` for hover

**Out of Scope (Intentionally Kept)**:
- **SetupWizard.vue:594** - `.spinner-white` is intentionally white for colored button backgrounds (NOT a bug)
- **TodoDependencyGraph.vue:32-36** - JavaScript `STATUS_COLOR` object (requires different approach, documented as limitation)
- **SessionListView.vue:265** - Theme-specific override in light theme selector (correct pattern)

### Impact

**User Experience**:
- Visual bugs when switching to light theme (white text on white backgrounds)
- Inconsistent visual appearance across views
- Reduced accessibility in certain lighting conditions

**Developer Experience**:
- Developers uncertain whether to use fallback pattern or defined variables
- Risk of introducing more theme-breaking colors
- Incomplete design system makes it harder to maintain visual consistency

## Solution Design

### Approach

**Phase 1: Define Missing CSS Variables**
1. Add `--fg-muted`, `--fg-subtle`, `--text-on-emphasis` to the design system in `styles.css`
2. Define both dark and light theme values
3. Ensure semantic naming aligns with existing token patterns

**Phase 2: Replace Hardcoded Colors**
1. Replace all `rgba(255, 255, 255, ...)` instances with appropriate CSS variables
2. Map each usage to the semantically correct token
3. Ensure theme-awareness for both dark and light modes

**Phase 3: Update Component References**
1. Remove fallback values from CSS variable references (since variables will now be defined)
2. Update components to use the newly defined variables
3. Ensure consistency across all affected components

### Semantic Mapping (REVISED)

Based on existing design system pattern, agent review feedback, and actual usage:

| Current Usage | Semantic Intent | Mapping Strategy | Dark Theme Value | Light Theme Value |
|---------------|----------------|------------------|------------------|-------------------|
| `rgba(255, 255, 255, 0.85)` (heatmap text) | High contrast text on colored backgrounds | NEW: `--text-on-emphasis` | `rgba(255, 255, 255, 0.95)` | `rgba(255, 255, 255, 0.95)` |
| `var(--fg-muted, #8b949e)` | Muted/secondary text | Use existing: `--text-secondary` | `#a1a1aa` (already defined) | `#52525b` (already defined) |
| `var(--fg-subtle, #6e7681)` | Tertiary text | Use existing: `--text-tertiary` | `#71717a` (already defined) | `#71717a` (already defined) |
| `var(--fg-secondary, ...)` (3 usages) | Secondary text | Use existing: `--text-secondary` | `#a1a1aa` (already defined) | `#52525b` (already defined) |
| `var(--fg-default)` (1 usage) | Primary text | Use existing: `--text-primary` | `#fafafa` (already defined) | `#18181b` (already defined) |
| `rgba(255, 255, 255, 0.2)` (borders in TodoDependencyGraph) | Structural borders | Use existing: `--border-default` | `rgba(255, 255, 255, 0.10)` | `rgba(0, 0, 0, 0.10)` |
| `rgba(255, 255, 255, 0.15)` (hover bg in SessionSearchView) | Hover state overlay | NEW: `--state-hover-overlay` | `rgba(255, 255, 255, 0.12)` | `rgba(0, 0, 0, 0.08)` |

### Rationale for Variable Names (REVISED)

- **`--text-on-emphasis`**: For white/light text on colored emphasis backgrounds (buttons, badges). Same value in both themes since emphasis colors are similar. Distinct from `--text-inverse` which is dark text on light backgrounds.
- **No new `--text-muted` or `--text-faint`**: Map all undefined `--fg-*` variables to existing, well-defined `--text-*` variables. This maintains consistency and avoids token proliferation.
- **`--state-hover-overlay`**: Renamed from `--hover-overlay` to follow `--category-variant` pattern. Adjusted opacity values based on agent feedback - original had `0.08`/`0.04` which was too subtle; revised to `0.12`/`0.08` for better visibility while remaining subtle.
- **Note on SetupWizard.vue**: After agent review, the spinner at line 594 is intentionally white for colored button backgrounds. **REMOVED from scope** - this is not a bug.

## Detailed Implementation Plan

### Step 1: Update Design System Tokens (styles.css)

**File**: `/home/runner/work/TracePilot/TracePilot/apps/desktop/src/styles.css`

**Changes to `:root` block (dark theme, after line 35 in text section)**:
```css
  /* --- Text --- */
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-tertiary: #71717a;
  --text-placeholder: #52525b;
  --text-link: #818cf8;
  --text-inverse: #09090b;                            /* Dark text for use on light backgrounds */
  --text-on-emphasis: rgba(255, 255, 255, 0.95);      /* NEW: Light text for use on colored emphasis backgrounds (badges, buttons) */
```

**Add new Interaction States section (after line 96, before Z-Index section)**:
```css
  /* --- Interaction States --- */
  --state-hover-overlay: rgba(255, 255, 255, 0.12);   /* NEW: Subtle overlay for hover states */
```

**Changes to `:root[data-theme="light"]` block (after line 154 in text section)**:
```css
  --text-on-emphasis: rgba(255, 255, 255, 0.95);      /* Same as dark - always high contrast on emphasis colors */
```

**Add to light theme block (after other overrides)**:
```css
  --state-hover-overlay: rgba(0, 0, 0, 0.08);         /* Inverted and slightly more visible for light theme */
```

### Step 2: Fix ToolAnalysisView.vue

**File**: `/home/runner/work/TracePilot/TracePilot/apps/desktop/src/views/ToolAnalysisView.vue`

**Line 447 - Replace**:
```css
/* Before */
.heatmap-count {
  color: rgba(255, 255, 255, 0.85);
}

/* After */
.heatmap-count {
  color: var(--text-on-emphasis);
}
```

### Step 3: Fix SessionTimelineView.vue

**File**: `/home/runner/work/TracePilot/TracePilot/apps/desktop/src/views/SessionTimelineView.vue`

**Line 108 - Replace** `--fg-muted` usage:
```css
/* Before */
color: var(--fg-muted, #8b949e);

/* After */
color: var(--text-secondary);
```

**Line 116 - Replace** `--fg-subtle` usage:
```css
/* Before */
color: var(--fg-subtle, #6e7681);

/* After */
color: var(--text-tertiary);
```

### Step 4: Fix SessionLauncherView.vue

**File**: `/home/runner/work/TracePilot/TracePilot/apps/desktop/src/views/orchestration/SessionLauncherView.vue`

**Line 1754 - Replace** undefined `--fg-muted`:
```css
/* Before */
color: var(--fg-muted);

/* After */
color: var(--text-secondary);
```

### Step 5: Fix chart-shared.css

**File**: `/home/runner/work/TracePilot/TracePilot/apps/desktop/src/styles/chart-shared.css`

**Line 71 - Replace**:
```css
/* Before */
color: var(--text-on-emphasis, #fff);

/* After */
color: var(--text-on-emphasis);
```

### Step 6: Fix TimeRangeFilter.vue

**File**: `/home/runner/work/TracePilot/TracePilot/apps/desktop/src/components/TimeRangeFilter.vue`

**Line 151 - Replace**:
```css
/* Before */
color: var(--text-on-emphasis, #fff);

/* After */
color: var(--text-on-emphasis);
```

### Step 7: Fix SessionLauncherView.vue Additional Instance

**File**: `/home/runner/work/TracePilot/TracePilot/apps/desktop/src/views/orchestration/SessionLauncherView.vue`

**Line 1761 - Replace** undefined `--fg-default`:
```css
/* Before */
color: var(--fg-default);

/* After */
color: var(--text-primary);
```

### Step 8: Fix SessionSearchView.vue Additional Instances

**File**: `/home/runner/work/TracePilot/TracePilot/apps/desktop/src/views/SessionSearchView.vue`

**Line 1420 - Replace** undefined `--fg-secondary`:
```css
/* Before */
color: var(--fg-secondary, #8b949e);

/* After */
color: var(--text-secondary);
```

**Line 1736 - Replace** hardcoded hover overlay:
```css
/* Before */
.filter-chip-remove:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.15);
}

/* After */
.filter-chip-remove:hover {
  opacity: 1;
  background: var(--state-hover-overlay);
}
```

### Step 9: Fix ConversationTab.vue

**File**: `/home/runner/work/TracePilot/TracePilot/apps/desktop/src/views/tabs/ConversationTab.vue`

**Line 779 - Replace** undefined `--fg-secondary`:
```css
/* Before */
color: var(--fg-secondary, #a0a0a0);

/* After */
color: var(--text-secondary);
```

### Step 10: Fix TodoDependencyGraph.vue

**File**: `/home/runner/work/TracePilot/TracePilot/apps/desktop/src/components/TodoDependencyGraph.vue`

**CRITICAL REVISION** (based on agent feedback): Use `--border-default` instead of `--border-muted` to maintain visibility. The original `0.2` opacity is too strong, but `--border-muted` at `0.06` would be too subtle. `--border-default` at `0.10` is a good middle ground.

**Line 769 - Replace** in filter chip:
```css
/* Before */
.filter-chip.active.pending {
  background: rgba(161, 161, 170, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  color: #a1a1aa;
}

/* After */
.filter-chip.active.pending {
  background: var(--neutral-subtle);
  border-color: var(--border-default);   /* Changed from --border-muted per agent review */
  color: var(--neutral-fg);
}
```

**Line 964 - Replace** in legend swatch:
```css
/* Before */
.legend-swatch.pending {
  background: rgba(161, 161, 170, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

/* After */
.legend-swatch.pending {
  background: var(--neutral-subtle);
  border-color: var(--border-default);   /* Changed from --border-muted per agent review */
}
```

**Note**: JavaScript `STATUS_COLOR` object at lines 32-36 contains hardcoded colors for SVG nodes. This requires accessing CSS variables from JavaScript using `getComputedStyle()`, which is beyond the scope of this CSS-focused improvement. Documented as a known limitation for future work.

## Testing Strategy

### Visual Testing Checklist

Test in **both dark and light themes** by toggling theme in settings:

1. **ToolAnalysisView** - Heatmap cells
   - Navigate to any session → Tool Analysis tab
   - Verify heatmap cell counts are readable in both themes
   - Check that text has good contrast on colored cells

2. **SessionTimelineView** - Timeline labels
   - Navigate to any session → Timeline view
   - Verify timeline phase labels are visible in both themes
   - Check label contrast and readability

3. **SessionLauncherView** - Launch form
   - Navigate to Orchestration → Launch Session
   - Verify all form labels are readable in both themes

4. **Chart Labels** - Shared chart components
   - Navigate to Analytics Dashboard
   - Navigate to Tool Analysis
   - Verify all chart axis labels and legends are readable in both themes

5. **TimeRangeFilter** - Date picker buttons
   - Navigate to Session Search
   - Open time range filter
   - Verify selected date button text is readable in both themes

6. **SetupWizard** - First-run experience
   - (Only testable on first run or after factory reset)
   - Verify wizard border styling looks correct in both themes

7. **TodoDependencyGraph** - Filter chips and legend
   - Navigate to any session → Todos tab → Graph view
   - Click "Pending" filter
   - Verify filter chip styling in both themes
   - Check legend swatch styling

8. **SessionSearchView** - Search filters
   - Navigate to Session Search
   - Add multiple filters
   - Hover over filter remove buttons
   - Verify hover effect is visible but subtle in both themes

### Automated Testing

While this change is primarily visual, we can validate:

1. **CSS variable definitions exist**: Use grep to verify all referenced variables are defined
2. **No hardcoded rgba(255, 255, 255) in affected files**: Use grep to verify removal
3. **Type checking passes**: Run `pnpm -r typecheck`
4. **Existing tests still pass**: Run `pnpm --filter @tracepilot/ui test` and `pnpm --filter @tracepilot/desktop test`

### Browser DevTools Testing

1. Open DevTools in both themes
2. Inspect computed styles on affected elements
3. Verify CSS variables resolve correctly
4. Check for any `undefined` or fallback values still being used

## Integration Considerations

### Design System Consistency

- **Aligns with existing patterns**: All new variables follow the established `--text-*` and `--hover-*` naming conventions
- **Maintains semantic meaning**: Variable names clearly indicate their purpose and usage context
- **Theme-aware**: All variables have appropriate values for both dark and light themes

### Backward Compatibility

- **No breaking changes**: This change only adds new variables and updates internal usage
- **No API changes**: Component props and slots remain unchanged
- **No behavior changes**: Only visual rendering is affected

### Future-Proofing

- **Complete design system**: Developers can now rely on CSS variables for all color needs
- **Prevents regression**: New code won't accidentally introduce hardcoded colors
- **Documentation**: Variables are well-named and self-documenting

## Risk Assessment

### Low Risk Factors

1. **CSS-only changes**: No logic or data flow modifications
2. **Additive changes**: Adding new CSS variables doesn't break existing code
3. **Isolated scope**: Changes affect styling only, not functionality
4. **Reversible**: Can easily revert if issues are found

### Potential Issues & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Incorrect color mapping | Low | Medium | Manual visual testing in both themes before commit |
| Missing edge cases | Low | Low | Comprehensive grep search for all rgba(255, ...) patterns |
| Contrast issues | Low | Medium | Test with browser accessibility tools, verify WCAG contrast |
| Regression in untested areas | Low | Low | Full visual scan of all major views in both themes |

## Implementation Order

1. **Add CSS variable definitions** (styles.css) - Foundation
2. **Fix critical theme-breaking colors** (ToolAnalysisView) - Highest visible impact
3. **Fix undefined variable references** (SessionTimelineView, SessionLauncherView) - Remove fallbacks
4. **Fix remaining hardcoded colors** (All other components) - Complete coverage
5. **Visual testing** - Both themes, all affected views
6. **Automated validation** - Grep verification, type checking, tests

## Expected Outcomes

### Quantifiable Improvements (REVISED)

- **7 components fixed** (ToolAnalysisView, SessionTimelineView, SessionLauncherView, chart-shared, TimeRangeFilter, TodoDependencyGraph, SessionSearchView, ConversationTab)
- **12 specific color/variable replacements** across 7 files
- **2 new CSS variables added** (`--text-on-emphasis`, `--state-hover-overlay`)
- **7 undefined variable references fixed** (4× `--fg-*` variants + 2× `--text-on-emphasis` fallbacks)
- **100% theme coverage** - All critical components work correctly in both light and dark themes

### Qualitative Improvements

- **Visual consistency**: All text and UI elements use design system tokens
- **Better light theme support**: Fixes visual bugs that make certain UI elements unreadable
- **Complete design system**: No gaps in token coverage for common use cases
- **Developer confidence**: Clear guidance on which CSS variables to use
- **Maintainability**: Future changes can rely on a complete, consistent design system

## Validation Checklist

After implementation, verify:

- [ ] All new CSS variables are defined in both `:root` and `:root[data-theme="light"]`
- [ ] No `rgba(255, 255, 255, ...)` instances remain in affected files
- [ ] All components render correctly in dark theme (default)
- [ ] All components render correctly in light theme (test thoroughly)
- [ ] No undefined CSS variables with fallbacks remain
- [ ] Text contrast meets WCAG AA standards in both themes
- [ ] TypeScript compilation passes
- [ ] Existing test suites pass
- [ ] No console warnings about undefined CSS variables

## Files to Modify (REVISED)

1. `apps/desktop/src/styles.css` - Add 2 new variable definitions (dark + light theme)
2. `apps/desktop/src/views/ToolAnalysisView.vue` - Replace 1 hardcoded color
3. `apps/desktop/src/views/SessionTimelineView.vue` - Replace 2 undefined variables
4. `apps/desktop/src/views/orchestration/SessionLauncherView.vue` - Replace 2 undefined variables
5. `apps/desktop/src/styles/chart-shared.css` - Remove fallback from defined variable
6. `apps/desktop/src/components/TimeRangeFilter.vue` - Remove fallback from defined variable
7. `apps/desktop/src/components/TodoDependencyGraph.vue` - Replace 2 instances of hardcoded borders
8. `apps/desktop/src/views/SessionSearchView.vue` - Replace 2 instances (undefined variable + hardcoded hover)
9. `apps/desktop/src/views/tabs/ConversationTab.vue` - Replace 1 undefined variable

**Total Changes**: 9 files, ~15 specific line changes

**Removed from original plan** (based on agent review):
- `SetupWizard.vue:594` - Spinner is intentionally white, not a bug

## Timeline Estimate

- **Design System Updates**: 30 minutes
- **Component Fixes**: 1-2 hours
- **Visual Testing**: 1 hour (both themes, all views)
- **Documentation**: 30 minutes
- **Total**: 3-4 hours

## Success Criteria

1. ✅ All undefined CSS variables are properly defined
2. ✅ Zero hardcoded `rgba(255, 255, 255, ...)` colors in UI components
3. ✅ Light theme renders correctly without visual bugs
4. ✅ All existing tests pass
5. ✅ No TypeScript compilation errors
6. ✅ Visual inspection confirms consistency across all affected views
7. ✅ Accessibility contrast ratios maintained or improved

## Alternative Approaches Considered

### Alternative 1: Complete Design System Overhaul
**Pros**: Would address all 67+ hardcoded colors mentioned in tech debt report
**Cons**: Much larger scope (2-3 days), higher risk, harder to test comprehensively
**Decision**: Rejected - Too broad for this iteration

### Alternative 2: Just Add Fallbacks
**Pros**: Minimal changes, very safe
**Cons**: Doesn't fix root cause, perpetuates incomplete design system
**Decision**: Rejected - Doesn't provide real value

### Alternative 3: Migrate to Tailwind Colors Only
**Pros**: Leverage existing Tailwind infrastructure
**Cons**: Breaks existing design system patterns, massive refactor, loses semantic tokens
**Decision**: Rejected - Too disruptive, loses benefits of semantic tokens

### Selected Approach: Targeted CSS Variable Completion
**Pros**: Surgical fix, low risk, high value, maintains existing patterns, fixes real bugs
**Cons**: Doesn't address all color issues (but significantly improves the situation)
**Decision**: Selected - Best balance of effort, risk, and impact

## Alignment with Tech Debt Report

This plan addresses the following items from the Technical Debt Report (§7 and §12):

- **P0 #5**: "Fix hardcoded colors breaking light theme — especially `rgba(255,255,255,...)` in ToolAnalysisView:403"
- **P2 #29**: "Fix undefined CSS variables (`--fg-muted`, `--fg-subtle`, `--text-on-emphasis`)"
- **P1 #15** (partial): "Replace 67+ hardcoded hex colors with CSS variable references" - This plan addresses the subset that breaks theme functionality

## Post-Implementation Actions

1. **Store memory**: Document the new CSS variables in repository memory for future reference
2. **Update tech debt report**: Mark items #5 and #29 as resolved
3. **Consider follow-up**: Create issue for comprehensive hardcoded color audit (remaining ~50+ instances)
4. **Document patterns**: Add examples to design system docs showing when to use `--text-on-emphasis` vs `--text-inverse`

---

## Agent Review Summary

This plan was reviewed by 3 specialized Opus 4.5 agents focusing on approach, implementation, and design system coherence. Key findings incorporated:

### Critical Issues Found & Addressed

1. **SetupWizard.vue spinner removal**: Agents correctly identified that `.spinner-white` at line 594 is intentional white styling for colored backgrounds, not a bug. **Removed from scope**.

2. **TodoDependencyGraph.vue border visibility**: Original plan used `--border-muted` (0.06 opacity) which would make borders nearly invisible. **Revised to use `--border-default`** (0.10 opacity) as a better balance.

3. **Hover overlay opacity adjustment**: Original values (`0.08`/`0.04`) deemed too subtle. **Increased to `0.12`/`0.08`** for better user feedback.

4. **Variable naming consistency**: Renamed `--hover-overlay` to **`--state-hover-overlay`** to follow the established `--category-variant` naming pattern.

5. **Additional undefined variables**: Agents identified `--fg-secondary` and `--fg-default` usage not in original plan. **Added to scope**.

6. **Semantic mapping clarity**: Removed confusing `--text-muted`/`--text-faint` intermediate variables. **Directly map to existing tokens** (`--text-secondary`, `--text-tertiary`).

### Known Limitations Documented

- **JavaScript color constants**: `TodoDependencyGraph.vue` lines 32-36 define colors in JavaScript for SVG rendering. These require a different refactoring approach (accessing CSS variables via `getComputedStyle()`). Out of scope for this CSS-focused improvement.

### Agent Consensus

All three agents agreed:
- The core problem is correctly identified and worth solving
- The surgical approach is appropriate (vs. complete overhaul)
- The semantic mapping to existing variables is sound
- The revised plan addresses all critical issues raised
- Risk assessment is accurate and mitigations are appropriate
