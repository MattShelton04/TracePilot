# TracePilot — Future Improvements & Out-of-Scope Tech Debt

This report captures architectural and code quality improvements identified during the tech debt cleanup that were out of scope for the initial cleanup pass. They are listed in approximate priority order.

---

## 1. ~~Decompose Large Timeline Components~~ ✅ DONE

**Status:** Completed. Shared extractions created and integrated:
- `extractPrompt()` utility → `packages/ui/src/utils/toolCall.ts`
- `detectParallelIds()` + `toTimeSpan()` → `packages/ui/src/utils/timelineUtils.ts`
- `AGENT_COLORS` consolidation → all 3 views now import from `@tracepilot/ui`
- `useTimelineNavigation` composable → `packages/ui/src/composables/`
- `ToolDetailPanel` component → `packages/ui/src/components/`
- `TerminologyLegend` component → `packages/ui/src/components/`
- All 3 timeline components refactored to use shared extractions
- 49 new tests added (13 timelineUtils + 18 ToolDetailPanel + 5 TerminologyLegend + 13 useTimelineNavigation)

---

## 2. ~~Decompose Large View Components~~ ✅ DONE

**Status:** Completed.
- **SettingsView:** 1,225 → 172 lines. 7 section sub-components extracted to `apps/desktop/src/components/settings/` (General, DataStorage, Pricing, ToolVisualization, HealthScoring, Updates, About, Experimental)
- **IndexingLoadingScreen:** 1,287 → 688 lines. Extracted `useOrbitalAnimation` (524 lines), `useIndexingEvents` (49 lines), `useAnimatedCounters` (62 lines) composables
- **SetupWizard:** 1,019 → ~167 lines orchestrator. Extracted `useWizardNavigation` composable + 5 step components (WizardStepWelcome, WizardStepFeatures, WizardStepSessionDir, WizardStepDatabase, WizardStepReady)
- **ConversationTab:** 586 → 522 lines. Extracted `useConversationSections` composable + `ReasoningBlock` component with 23 new tests

---

## 3. ~~Split Large Rust Modules~~ ✅ PARTIALLY DONE

**Status:** `index_db.rs` decomposition completed. `tauri-bindings/lib.rs` still pending.

- **index_db.rs:** Split into `index_db/` directory module with 7 files: `mod.rs` (thin orchestrator), `types.rs`, `migrations.rs`, `helpers.rs`, `session_writer.rs`, `session_reader.rs`, `analytics_queries.rs`. Pure `extract_session_analytics()` function extracted from `upsert_session()` (tech debt §17).
- **tauri-bindings/lib.rs:** Still a single file — group commands into domain modules as a future improvement.

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

## 7. ~~Accessibility (A11Y) Improvements~~ ✅ PARTIALLY DONE

**Completed:**
- AgentTreeView SVG: Added `role="img"` and descriptive `aria-label`
- AgentTreeView: Added `sr-only` text for in-progress color-only status indicator
- NestedSwimlanesView: Added descriptive `aria-label` to all 8 `role="button"` elements
- Interactive elements have `tabindex="0"` for keyboard access

**Remaining gaps:**
- Tab navigation order is inconsistent in some views
- Missing `role` attributes on some custom widgets (dropdowns, modals)
- Additional SVG charts in other views may need ARIA labels

---

## 8. ~~Remaining Inline Style Cleanup~~ ✅ DONE

**Status:** Completed. All inline styles converted to scoped CSS classes:
- SettingsView: 37 inline styles → 17 scoped CSS classes
- ModelComparisonView: 17 inline styles → scoped CSS classes (8 dynamic `:style` kept where necessary)
- SessionListView: Toolbar inline style → `.session-toolbar` class

---

## 9. ~~Feature Flags / Progressive Disclosure~~ ✅ DONE

**Status:** Completed. Simple feature flag system implemented:
- `featureFlags` record in preferences store with `isFeatureEnabled()` / `toggleFeature()` actions
- Sidebar items gated via `featureFlag` property (ExportView, HealthScoringView, SessionReplayView)
- New `SettingsExperimental.vue` section with toggle switches for each flag
- Flags persist via localStorage

---

## 10. ~~Lint Baseline & Progressive Fixing~~ ✅ DONE

**Status:** Completed. Baseline captured and pre-commit hook added:
- Baseline: 325 files, 2,190 errors / 2,991 warnings / 283 infos (documented in `docs/tech-debt-report.md` §1.2)
- Pre-commit hook via lefthook runs `biome check` on staged files
- `pnpm lint` and `pnpm lint:fix` scripts already existed
- Future PRs will be held to "no new warnings" standard

---

## 11. ~~Split `index_db.rs` (1,858 lines — Highest Priority)~~ ✅ DONE

**Status:** Completed. Decomposed into `index_db/` directory module:
- `mod.rs` — Thin orchestrator (~70 lines): `IndexDb` struct, `open_or_create`, `begin/commit_transaction`
- `types.rs` — All types (`SessionIndexInfo`, `IndexedSession`, `IndexedIncident`, `ModelMetricsRow`, `ToolCallRow`, `ActivityRow`, `ModifiedFileRow`, `SessionAnalytics`, `SessionFileMeta`) + constants
- `migrations.rs` — `MIGRATION_1`–`MIGRATION_5` + `run_migrations()`
- `helpers.rs` — SQL filter builders, day-query functions, `compute_duration_stats`
- `session_writer.rs` — `upsert_session` (orchestrator) + pure `extract_session_analytics()` + `needs_reindex`, `prune_deleted`
- `session_reader.rs` — `list_sessions`, `search`, `session_count`, `all_indexed_ids`, `get_session_path`, `get_session_incidents`
- `analytics_queries.rs` — `query_analytics`, `query_tool_analysis`, `query_code_impact`
- All 17 existing tests pass. External callers unchanged.

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

## 17. ~~Extract `upsert_session()` Analytics Logic~~ ✅ DONE

**Status:** Completed as part of the `index_db.rs` decomposition (§11). Pure `extract_session_analytics()` function in `session_writer.rs` takes `SessionSummary`, typed events, and diagnostics → returns `SessionAnalytics` struct. Independently testable without a database. `upsert_session()` is now a thin orchestrator: load → extract → write.

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
