# TracePilot — Future Improvements & Out-of-Scope Tech Debt

This report captures architectural and code quality improvements identified during the tech debt cleanup that were out of scope for the initial cleanup pass. They are listed in approximate priority order.

---

## 1. Decompose Large Timeline Components

**Files:** `AgentTreeView.vue` (~900 lines), `TurnWaterfallView.vue` (~800 lines), `NestedSwimlanesView.vue` (~750 lines)

These timeline visualisation components contain rendering logic, interaction handlers, layout math, and styling all in single files. Each should be broken into:
- A container component (layout + data fetching)
- Render sub-components (individual rows, bars, labels)
- A composable for layout math (`useWaterfallLayout`, `useSwimlanePlacement`)
- Extracted shared tooltip/popover logic

**Impact:** Easier testing, better code navigation, reusable pieces for future views.

---

## 2. Decompose Large View Components

**Files:** `SettingsView.vue` (~1100 lines, 37+ inline styles), `IndexingLoadingScreen.vue` (~600 lines), `SetupWizard.vue` (~500 lines)

These views mix form logic, validation, API calls, and presentation in a single component. Recommendations:
- **SettingsView:** Extract each settings section (Appearance, Indexing, Updates, About) into separate tab components. Convert 37+ inline styles to scoped CSS classes.
- **IndexingLoadingScreen:** Extract progress bar, log viewer, and status display into sub-components.
- **SetupWizard:** Extract each wizard step into its own component with shared step navigation via a composable.

---

## 3. Split Large Rust Modules

**Files:** `index_db.rs` (~1865 lines), `tauri-bindings/lib.rs` (~1063 lines)

- **index_db.rs:** Split into sub-modules: `schema.rs` (migrations), `write.rs` (insert/update), `read.rs` (queries), `fts.rs` (full-text search), `types.rs` (structs).
- **tauri-bindings/lib.rs:** Group commands into modules by domain: `session_commands.rs`, `indexing_commands.rs`, `config_commands.rs`, `analytics_commands.rs`. Keep the handler registration in `lib.rs`.

**Impact:** Better code navigation, easier to locate and modify specific queries/commands.

---

## 4. Structured Error Types Across Tauri IPC

**Current state:** Most Tauri commands return `Result<T, String>` with ad-hoc error strings. The frontend handles errors inconsistently.

**Recommendation:**
- Define a shared `TracePilotError` enum in `tracepilot-core` with variants for each error category (NotFound, IndexError, ConfigError, ParseError, etc.)
- Implement `Serialize` so it can cross the IPC boundary as structured data
- Frontend can then pattern-match on error types for appropriate user feedback

---

## 5. Add Tests for Untested Components

**Current coverage gaps:**
- No tests for any analytics views (AnalyticsDashboardView, ToolAnalysisView, CodeImpactView, ModelComparisonView)
- No tests for timeline components (AgentTreeView, TurnWaterfallView, NestedSwimlanesView)
- No tests for SessionComparisonView
- No integration tests for Tauri commands
- No tests for the CLI commands (only the version-analyzer lib has indirect coverage)

**Recommendation:** Start with snapshot tests for analytics views (they're mostly presentational), then add interaction tests for SessionComparisonView and timeline components.

---

## 6. Event Caching for Pagination Performance

**Current state:** Session events are loaded all-at-once. Large sessions (5000+ events) cause noticeable lag.

**Recommendation:** Implement cursor-based pagination in the Rust backend and virtual scrolling in the frontend EventsTab. The indexer already stores event metadata that could support this.

---

## 7. Accessibility (A11Y) Improvements

**Current gaps:**
- Most interactive SVG charts lack ARIA labels and keyboard navigation
- Colour-only indicators (red/green status) need pattern/icon alternatives
- Tab navigation order is inconsistent in some views
- Missing `role` attributes on custom widgets (dropdowns, modals)

---

## 8. Remaining Inline Style Cleanup

**Current state:** ~37 inline styles in SettingsView.vue, ~28 in ModelComparisonView.vue, ~15 in SessionListView.vue toolbar.

These were excluded from the initial cleanup to limit scope. Each view should have its inline styles converted to scoped CSS classes with meaningful names.

---

## 9. Feature Flags / Progressive Disclosure

Some views may not be relevant to all users (e.g., Session Replay, Export). Consider:
- A feature flag system (simple JSON config) to show/hide sidebar items
- "Coming soon" states rather than stub views

---

## 10. Lint Baseline & Progressive Fixing

**Current state:** `pnpm lint` reports ~2200 errors and ~2900 warnings (pre-existing). Most are import ordering, naming conventions, and complexity warnings.

**Recommendation:** Establish a lint baseline and enforce "no new warnings" in CI. Progressively fix existing warnings module-by-module.

---

*Generated during TracePilot tech debt cleanup session. Each item is independent and can be tackled incrementally.*
