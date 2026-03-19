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

## 11. Split `index_db.rs` (1,858 lines — Highest Priority)

**Files:** `crates/tracepilot-indexer/src/index_db.rs` (1,858 lines)

This single file contains schema migrations, the 400-line `upsert_session()` method (analytics extraction + 5 child table UPSERTs via SAVEPOINT), 3 analytics query methods (170+ lines each), SQL helpers, and tests. Split into:

- **`migrations.rs`** — Schema definitions (4 migrations) + versioned migration runner
- **`writer.rs`** — `upsert_session()` (analytics extraction + 5 child table UPSERTs via SAVEPOINT)
- **`reader.rs`** — `list_sessions()`, `search()`, `get_session_path()`, `session_count()`, `all_indexed_ids()`, `prune_deleted()`, `needs_reindex()`
- **`analytics_queries.rs`** — `query_analytics()` (170 lines, 7 SQL statements), `query_tool_analysis()` (125 lines), `query_code_impact()` (133 lines)
- **`sql_helpers.rs`** — `build_date_repo_filter()`, `query_day_tokens/sessions/cost()`, `query_model_distribution()`, `compute_duration_stats()`

**Impact:** Each sub-module becomes independently testable with a clear single responsibility. Schema migrations can be reviewed without scrolling past 1,400 lines of query logic.

**Recommendation:** Start by extracting `migrations.rs` (lowest coupling), then `analytics_queries.rs` (self-contained read-only functions), then tackle the writer/reader split last since they share the `IndexDb` struct.

---

## 12. Split `tauri-bindings/lib.rs` (1,055 lines)

**Files:** `crates/tracepilot-tauri-bindings/src/lib.rs` (1,055 lines)

All 25 Tauri commands live in a single file. Split into domain modules:

- **`session_commands.rs`** — 7 commands: `list_sessions`, `get_session_detail`, `get_session_turns`, `get_session_events`, `get_session_todos`, `get_session_checkpoints`, `get_shutdown_metrics`
- **`indexing_commands.rs`** — 4 commands: `search_sessions`, `reindex_sessions`, `reindex_sessions_full`, `get_session_count`
- **`analytics_commands.rs`** — 3 commands: `get_analytics`, `get_tool_analysis`, `get_code_impact`
- **`config_commands.rs`** — 3 commands: `check_config_exists`, `get_config`, `save_config`
- **`utility_commands.rs`** — 8 commands: `validate_session_dir`, `get_db_size`, `is_session_running`, `factory_reset`, `get_tool_result`, `resume_session_in_terminal`, `check_for_updates`, `get_git_info`
- Keep **`lib.rs`** as a thin handler registration file (response DTOs + `generate_handler![]` macro)

**Impact:** New commands can be added to the correct module without scrolling through 1,000+ lines. Domain boundaries become explicit.

**Recommendation:** Note that every command needs 3 registrations: `#[tauri::command]` in its module, `generate_handler![]` in `lib.rs`, and `.commands(&[])` in `build.rs`. Document this in a `CONTRIBUTING.md` or module-level doc comment to prevent registration mismatches.

---

## 13. Split `analytics/aggregator.rs` (950 lines)

**Files:** `crates/tracepilot-core/src/analytics/aggregator.rs` (950 lines)

Three independent compute functions share a file but have no internal dependencies on each other. Split into:

- **`dashboard.rs`** — `compute_analytics()`
- **`tools.rs`** — `compute_tool_analysis()`
- **`code_impact.rs`** — `compute_code_impact()`

**Impact:** Each analytics domain can evolve independently. Adding a new metric to tool analysis won't create merge conflicts with dashboard changes.

**Recommendation:** The in-memory analytics path is currently only used by benchmarks — the Tauri app uses IndexDb queries exclusively. Consider marking these functions as CLI-only or deprecating them in favour of the indexer path (see §14).

---

## 14. Resolve Dual Analytics Path

**Files:**
- `crates/tracepilot-core/src/analytics/aggregator.rs` — In-memory computation from raw events
- `crates/tracepilot-indexer/src/index_db.rs` — Pre-computed at index time, stored in SQLite

Two parallel analytics systems exist. The Tauri app only uses the indexer path. The core aggregator is only exercised by benchmarks.

**Impact:** Maintaining two divergent analytics implementations increases the risk of inconsistent results and doubles the surface area for analytics bugs.

**Recommendation:** Choose one of the following strategies:
1. **Mark core aggregator as the "offline/CLI" path** with clear documentation explaining when each path is used and why
2. **Remove core aggregator** and have the CLI use the index DB directly
3. **Keep both but ensure they produce identical results** — currently there are no tests verifying parity between the two paths

---

## 15. Unify Error Handling Strategy

**Files:**
- `crates/tracepilot-core/src/error.rs` — `thiserror` (`TracePilotError` with 6 variants)
- `crates/tracepilot-indexer/src/` — `anyhow` (ad-hoc error strings)
- `crates/tracepilot-tauri-bindings/src/lib.rs` — Converts everything to `Result<T, String>` for IPC

**Impact:** Ad-hoc error strings make it impossible for the frontend to programmatically distinguish between "session not found" and "database locked". Users see raw error text instead of actionable messages.

**Recommendation:** Define a shared `TracePilotError` enum with `Serialize` support so structured errors can cross the IPC boundary. The frontend can then pattern-match on error types (e.g., show a retry button for transient DB errors, a "not found" message for missing sessions). Migrate the indexer from `anyhow` to the shared error type incrementally.

---

## 16. Decide on `tracepilot-export` Crate

**Files:** `crates/tracepilot-export/`

Currently a stub — only `render_json()` works. `export_session()` returns `bail!("not yet implemented")`. The `ExportFormat` enum declares Markdown, Json, and Csv variants but only Json has an implementation.

**Impact:** The crate adds to compile time and cognitive overhead without delivering value for two of its three declared formats.

**Recommendation:** Either implement Phase 2 (Markdown and Csv export) or remove the crate to reduce noise. If keeping it, add `#[cfg(feature = "export")]` gating so it doesn't compile by default until the remaining formats are complete.

---

## 17. Extract `upsert_session()` Analytics Logic

**Files:** `crates/tracepilot-indexer/src/index_db.rs` — `upsert_session()` (~400 lines)

The `upsert_session()` method loads a session, extracts analytics, computes health scores, builds FTS content, and writes to 5 tables — all in one method. This makes it difficult to test the analytics extraction logic in isolation.

**Impact:** Any change to analytics extraction risks breaking the database write path. Unit testing requires a full SQLite database even for pure computation logic.

**Recommendation:** Extract the analytics extraction into a separate testable pure function that takes a `SessionLoadResult` and returns a structured `SessionAnalytics` value. The `upsert_session()` method then becomes a thin orchestrator: load → extract → write. The pure function can be tested without a database.

---

## 18. Split `event_types.rs` (572 lines)

**Files:** `crates/tracepilot-core/src/models/event_types.rs` (572 lines)

This file combines:
- `SessionEventType` enum (36 variants) with strum derives
- `KNOWN_EVENT_TYPES` constant array
- Display/Serialize implementations
- ~25 typed data structs (`ShutdownData`, `UserMessageData`, `ToolExecStartData`, etc.)

**Impact:** Adding a new event type requires editing a 572-line file and navigating past unrelated struct definitions.

**Recommendation:** Split into:
- **`event_type_enum.rs`** — `SessionEventType` enum + `KNOWN_EVENT_TYPES` constant + Display/Serialize impls
- **`session_lifecycle_data.rs`** — `ShutdownData`, `SessionStartData`, and related lifecycle structs
- **`tool_execution_data.rs`** — `ToolExecStartData`, `ToolExecEndData`, `ToolResultData`, and related structs
- **`agent_data.rs`** — Agent-related event data structs
- **`model_data.rs`** — Model-related event data structs

Re-export everything from a `mod.rs` to keep the public API unchanged.

---

*Generated during TracePilot tech debt cleanup session. Each item is independent and can be tackled incrementally.*
