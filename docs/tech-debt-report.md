# TracePilot Technical Debt & Improvement Report

**Generated**: 2026-03-15
**Last Updated**: 2026-03-17 — Rust backend optimization pass applied (see §1.1); lint baseline captured (see §1.2)
**Scope**: Full codebase audit — Rust backend (4 crates), Vue/TypeScript frontend (desktop app + shared packages), infrastructure
**Codebase size**: ~7,300 lines Rust, ~16,000 lines TS/Vue, ~1,400 lines global CSS
**Review process**: Initial analysis by 6 parallel Opus 4.6 agents; reviewed by Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex, and Gemini 3 Pro; findings consolidated and corrected.

> **Confidence notes**: Counts marked with `~` are approximate. Line numbers are best-effort and may drift as the codebase evolves. All P0/P1 items were verified against source; P2/P3 items are high-confidence but less rigorously spot-checked.

---

### 1.2 Biome Lint Baseline (captured at setup)

Baseline captured with `pnpm lint` (`biome check .`) against 325 files. New code should not introduce new violations.

| Category | Count |
|----------|-------|
| Errors   | 2,190 |
| Warnings | 2,991 |
| Infos    | 283   |

Top contributors:
- `lint/complexity/noCommaOperator` — 1,788 warnings (generated/vendor code)
- `assist/source/organizeImports` — 169 errors
- `lint/suspicious/noDoubleEquals` — 105 errors
- `lint/correctness/noUnusedVariables` — 592 warnings
- `lint/correctness/noUnusedImports` — 118 warnings
- `lint/complexity/useOptionalChain` — 107 warnings
- `lint/style/noNonNullAssertion` — 58 warnings
- `lint/suspicious/noExplicitAny` — 43 warnings

Scripts: `pnpm lint` (check), `pnpm lint:fix` (auto-fix).
Pre-commit hook added to `lefthook.yml` — staged TS/JS/JSON files are checked on each commit.

---

### 1.1 Rust Backend Optimization (2026-03-17)

The following debt items were addressed in a backend optimization pass:

| Item | Status | Details |
|------|--------|---------|
| Double event parsing in `analytics/loader.rs` | ✅ Fixed | `load_single_full_session()` now uses `load_session_summary_with_events()` — single parse |
| Dead code: `count_events()`, `extract_shutdown_data()` | ✅ Removed | Dead functions and test migrated to `extract_combined_shutdown_data()` |
| 4× duplicated SQLite open in `session_db.rs` | ✅ DRY'd | Extracted `open_readonly()` and `table_exists()` helpers |
| Duplicated resolve logic in `discovery.rs` | ✅ DRY'd | `resolve_session_path()` delegates to `resolve_session_path_in()` |
| Manual temp dir in discovery tests | ✅ Fixed | Replaced with `tempfile::tempdir()` |
| Silent error swallowing in `summary/mod.rs` | ✅ Fixed | `if let Ok` → `match` + `tracing::warn` on failure |
| Unused `anyhow` dep in tracepilot-core | ✅ Removed | |
| Two-pass event iteration in indexer | ✅ Fixed | Merged FTS content + tool stats into single pass |
| Vec\<String\> + join for FTS content | ✅ Fixed | Streaming into single String with early 100KB cutoff |
| Opaque 7-tuple in indexer model metrics | ✅ Fixed | Named `ModelMetricsRow` struct |
| Unbounded IN clause in `prune_deleted()` | ✅ Fixed | Temp table approach with transactional atomicity |
| No transaction batching in reindex | ✅ Fixed | 100-session batch transactions amortize WAL fsyncs |
| Config panics on missing HOME/USERPROFILE | ✅ Fixed | `home_dir()` now returns `Option<PathBuf>` |
| Silent TOML parse failure in config | ✅ Fixed | `tracing::warn` on parse error |
| Unused `tracepilot-export` dep | ✅ Removed | From both tauri-bindings and desktop crates |
| No benchmarks | ✅ Added | `tracepilot-bench` crate: 15 Criterion benchmarks + `scripts/bench.ps1` |

**Review**: All changes reviewed by Opus 4.6, GPT 5.4, GPT 5.3 Codex, and Gemini 3 Pro. Zero issues from Opus/Codex/Gemini; GPT caught a config fallback safety issue (fixed).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Rust Backend — tracepilot-core](#2-rust-backend--tracepilot-core)
3. [Rust Backend — tracepilot-indexer](#3-rust-backend--tracepilot-indexer)
4. [Rust Backend — tracepilot-export](#4-rust-backend--tracepilot-export)
5. [Rust Backend — tracepilot-tauri-bindings](#5-rust-backend--tracepilot-tauri-bindings)
6. [Desktop App — Vue Components & Architecture](#6-desktop-app--vue-components--architecture)
7. [Desktop App — CSS & Styling (Deep Dive)](#7-desktop-app--css--styling-deep-dive)
8. [Shared TypeScript Packages](#8-shared-typescript-packages)
9. [CLI App](#9-cli-app)
10. [Project Infrastructure](#10-project-infrastructure)
11. [Cross-Cutting Concerns](#11-cross-cutting-concerns)
12. [Prioritized Action Items](#12-prioritized-action-items)
13. [Appendix: Review Corrections](#13-appendix-review-corrections)

---

## 1. Executive Summary

TracePilot is a well-architected monorepo with clean separation between Rust backend crates and TypeScript frontend packages. The design system foundation (65+ CSS tokens, dark/light theming, accessibility) is strong. However, the rapid development pace has left several categories of technical debt:

### Critical Issues (P0)
- **No CI/CD pipeline** — zero automated quality gates
- **Tracing subscriber never initialized** — all ~8 `tracing::warn!` calls are no-ops in production
- **Tauri error handling** — ~37 instances of `.map_err(|e| e.to_string())` discarding error context
- **~~Desktop app bypasses backend search~~** — *(Resolved: client-side session list filtering is intentional for instant feedback; backend FTS5 is used for deep content search in SessionSearchView)*
- **Hardcoded colors** — 67+ hex values bypassing the design system, some breaking light theme

### High-Impact Improvements (P1)
- **Tauri managed state** — fresh DB connection opened per command invocation
- **Code duplication** — agent color maps ×3, formatting functions not using existing shared utils, SQLite helpers ×4, `truncate_utf8` ×2
- **Test coverage gaps** — 0 tests for tauri-bindings (13 commands), CLI (5 commands), export crate, 25/38 Vue production files
- **Stringly-typed data** — session IDs, timestamps, status fields, shutdown types should be newtypes/enums
- **CSS paradigm conflict** — 4 styling strategies coexist (global BEM, Tailwind, scoped CSS, inline styles) with conflicting values
- **Wire `ErrorBoundary.vue`** — defined and tested but never mounted; add global `app.config.errorHandler`
- **IPC command-name drift risk** — no contract tests between Rust command registry and TS client string commands
- **Session-detail tab failures are silent** — errors only `console.error`'d, no user-visible error state

### Scope for Normalization (P2–P3)
- **Component splitting** — 3 timeline views are 1,000+ line monoliths (split when perf pain measured)
- **156 inline styles** should become CSS classes
- **Missing spacing/typography tokens** — 15+ unique font sizes, raw pixel values everywhere
- **Missing composables** — replay logic, chart layout, comparison logic
- **36 STUB comments** in frontend awaiting real implementations
- **No LICENSE file** — legal risk for any open-source or distribution plans

---

## 2. Rust Backend — tracepilot-core

**4,889 lines across 22 files** (~60% test code in `turns/mod.rs`)

### 2.1 Code Duplication

| Severity | Issue | Location | Fix |
|----------|-------|----------|-----|
| 🟠 High | SQLite `Connection::open_with_flags` repeated 4× identically | `parsing/session_db.rs:40,83,119,146` | Extract `fn open_readonly(path) -> Result<Connection>` |
| 🟠 High | "table exists" SQL check repeated 3× | `parsing/session_db.rs:50,92,156` | Extract `fn table_exists(conn, name) -> bool` |
| 🟠 High | `resolve_session_path` / `resolve_session_path_in` near-identical | `session/discovery.rs:86-125` | Delegate to `resolve_session_path_in(prefix, &default_dir())` |
| 🟠 High | `typed_data_from_raw()` — 11 match arms with identical clone-heavy pattern | `parsing/events.rs:102-139` | Macro or helper: `try_deserialize::<T, F>(data, constructor)` |
| 🟡 Medium | "find tool call in current/finalized turns" repeated 4× | `turns/mod.rs:91,162,198,224` | Extract `fn find_tool_call_in_any(...)` |
| 🟡 Medium | Date key computation repeated 3× | `analytics/aggregator.rs:50,421`, `analytics/loader.rs:133` | Add `SessionSummary::date_key()` method |
| 🟡 Medium | Duplicate sample JSONL test data | `parsing/events.rs:191`, `summary/mod.rs:178` | Shared `#[cfg(test)]` fixture module |

### 2.2 Error Handling

| Severity | Issue | Location |
|----------|-------|----------|
| 🟡 Medium | `unwrap_or(false)` hides SQLite errors silently | `parsing/session_db.rs:56,98,162` |
| 🟡 Medium | Event-parse failures silently swallowed | `summary/mod.rs:81` — `if let Ok(...)` with no warning |
| 🟢 Low | Hardcoded fallback home directories (`C:\Users\default`, `/tmp`) | `session/discovery.rs:18-25` |

### 2.3 Type System Issues

| Severity | Issue | Location | Fix |
|----------|-------|----------|-----|
| 🟠 High | Stringly-typed `status` in `ToolTransaction` | `models/tool_transaction.rs:15` | ~~Enum `ToolStatus::Success \| Failure \| Unknown`~~ **RESOLVED: ToolTransaction removed (dead code)** |
| 🟠 High | Stringly-typed `shutdown_type` | `models/event_types.rs:153`, `models/session_summary.rs:44` | Enum `ShutdownType::Routine \| Error \| ...` |
| 🟠 High | Stringly-typed `category` in `HealthFlag` | `health/mod.rs:18` | Enum `HealthCategory::Size \| ErrorRate \| ...` |
| 🟡 Medium | `RewindSnapshot::timestamp` is `Option<String>` not `DateTime<Utc>` | `parsing/rewind_snapshots.rs:22` | Parse to `DateTime<Utc>` |
| 🟡 Medium | `TodoItem::created_at/updated_at` are `Option<String>` | `parsing/session_db.rs:18-19` | Parse to `DateTime<Utc>` |

### 2.4 Performance Concerns

| Severity | Issue | Location | Fix |
|----------|-------|----------|-----|
| 🟠 High | Double-clone on deserialization failure in `typed_data_from_raw` | `parsing/events.rs:104-137` | Use ownership-consuming `from_value` pattern |
| 🟡 Medium | `load_single_full_session` parses events twice | `analytics/loader.rs:69-92` | Use `load_session_summary_with_events` instead |
| 🟡 Medium | `TurnToolCall` (14 fields) clones 5+ `Option<String>` per creation | `models/conversation.rs` | Consider `Arc<str>` for shared IDs |

### 2.5 Dead Code

| Item | Location | Notes |
|------|----------|-------|
| `count_events()` | `parsing/events.rs:86` | Public but never called anywhere |
| `ToolTransaction` struct | `models/tool_transaction.rs` | ~~Exported, never instantiated or used~~ **RESOLVED: Removed** |
| `col_count` dead variable | `parsing/session_db.rs:181,192` | `let _ = col_count;` silences warning |
| TODO: health heuristics | `health/mod.rs:47` | ~~Module is a stub with 1 check and 0 tests~~ **RESOLVED: Enhanced with diagnostics-based heuristics and 6 tests** |

> **Correction**: `read_todo_deps()` was initially listed as dead code but is actually consumed by tauri-bindings. It is NOT dead code.

### 2.6 Missing Abstractions

- **No `trait SessionSource`** — tightly coupled to filesystem paths; blocks in-memory testing, remote backends
- **No `Serialize` on `TypedEvent`/`TypedEventData`** — consumers must go through `.raw` for serialization
- **`pub use types::*` glob re-export** in `analytics/mod.rs:22` pollutes namespace

### 2.7 Test Gaps

- ❌ No tests for `health::compute_health`
- ❌ No tests for `analytics::loader::load_full_sessions`
- ❌ No integration test for full pipeline (discovery → parsing → summary → analytics)
- ⚠️ Discovery tests use non-deterministic temp dirs instead of `tempfile::tempdir()`
- ⚠️ No negative tests for `read_custom_table` SQL injection safety

### 2.8 Documentation Gaps

- `ConversationTurn` — 10/13 fields undocumented
- `SessionSummary` — fields lack descriptions of `None` vs `Some(0)` semantics
- `analytics/types.rs` — 16 public structs with zero field documentation
- `ModifiedFileEntry.additions` is misnamed — means "modification count", not "lines added" (`analytics/aggregator.rs:474`)

---

## 3. Rust Backend — tracepilot-indexer

**~1,840 lines across 2 files**

### 3.1 Code Duplication (Cross-Crate)

| Severity | Issue | Location |
|----------|-------|----------|
| 🔴 Critical | Duplicate home-directory resolution | `indexer/lib.rs:15-19` vs `core/discovery.rs:14-27` |
| 🔴 Critical | Duplicate `truncate_utf8` with different signatures | `tauri-bindings/lib.rs:53-65` vs `index_db.rs:1388-1397` |
| 🟠 High | `IndexedSession` ≈ `SessionListItem` — nearly identical structs | `index_db.rs:144` vs `tauri-bindings/lib.rs:7` |
| 🟠 High | `prune_deleted` + `live_ids` pattern duplicated | `indexer/lib.rs:31-33` vs `67-68` |
| 🟡 Medium | Analytics fallback pattern repeated 3× | `tauri-bindings/lib.rs:414-516` |

### 3.2 Database Layer Issues

| Severity | Issue | Location |
|----------|-------|----------|
| 🟡 Medium | `LIMIT` uses string interpolation instead of parameter binding | `index_db.rs:681` |
| 🟡 Medium | `reindex_all` transaction is fragile — errors logged but loop continues | `indexer/lib.rs:34-43` |
| 🟡 Medium | `reindex_incremental` has no transaction wrapping (inconsistent with `reindex_all`) | `indexer/lib.rs:60-96` |
| 🟢 Low | Migrations are forward-only, no rollback support | `index_db.rs:1155-1188` |
| ✅ | SQL injection properly prevented with parameterized queries everywhere | All query functions |

### 3.3 Performance

| Severity | Issue | Location |
|----------|-------|----------|
| 🟠 High | N+1 query in `search_sessions` — disk I/O per FTS result | `tauri-bindings/lib.rs:320-334` |
| 🟠 High | Full `events.jsonl` re-parsed on every paginated events request | `tauri-bindings/lib.rs:212-213` |
| 🟡 Medium | `prune_deleted` loads all IDs into memory instead of SQL `DELETE WHERE NOT IN` | `index_db.rs:733` |

### 3.4 Test Coverage

- ✅ `index_db.rs`: 17 tests covering migrations, upsert, FTS, filtering, analytics — good
- ❌ `lib.rs`: 0 tests for `reindex_all` and `reindex_incremental` orchestration
- ❌ Entire crate: No tests for error recovery paths

---

## 4. Rust Backend — tracepilot-export

**~23 lines across 3 files — entirely placeholder**

- `export_session()` immediately `bail!`s with "not yet implemented"
- `render_markdown()` returns a hardcoded string
- `render_json()` is a trivial `serde_json::to_string_pretty` wrapper
- `ExportFormat::Csv` variant exists with no implementation
- Listed as dependency in `tracepilot-tauri-bindings` but **never imported or used**
- `Cargo.toml` declares unused dependencies: `chrono`, `thiserror`, `serde`
- **Zero tests**

**Recommendation**: Either implement or remove from the workspace. Currently adds build time for zero functionality.

---

## 5. Rust Backend — tracepilot-tauri-bindings

**~538 lines, 13 Tauri commands, 0 tests**

### 5.1 Critical Issues

| Severity | Issue | Details |
|----------|-------|---------|
| 🔴 Critical | All errors flattened to `String` | ~37 `.map_err(\|e\| e.to_string())` — destroys error type info, makes frontend error handling impossible |
| 🔴 Critical | No input validation | `session_id: String` — no UUID format check; `offset/limit` — overflow risk; `query: String` — raw FTS5 syntax |
| 🟠 High | No Tauri managed state | Every command opens fresh DB connection via `IndexDb::open_or_create()` — should use `tauri::State<Mutex<IndexDb>>` |
| 🟠 High | Zero test coverage | 13 commands with complex fallback logic completely untested |
| 🟠 High | Silent file deletion in `reindex_sessions_full` | `let _ = std::fs::remove_file(...)` for DB/WAL/SHM files ignores errors — can mask corruption |
| 🟡 Medium | `eprintln!` instead of `tracing` | Lines 428, 463, 498 — inconsistent with rest of codebase |
| 🟡 Medium | Duplicate sort logic | Session sorting identical in `list_sessions:161` and `search_sessions:338` |

### 5.2 Recommended Architecture

```rust
// Instead of: Result<T, String> with .map_err(|e| e.to_string())
// Define:
#[derive(Debug, Serialize)]
enum TauriError {
    SessionNotFound(String),
    DatabaseError(String),
    ParseError(String),
    // ...
}
impl From<TracePilotError> for TauriError { ... }
impl From<anyhow::Error> for TauriError { ... }

// Instead of: opening DB per command
// Use: Tauri managed state
fn main() {
    tauri::Builder::default()
        .manage(AppState { db: Mutex<IndexDb> })
        .invoke_handler(...)
}
```

---

## 6. Desktop App — Vue Components & Architecture

**48 source files, ~14,600 LOC application code**

### 6.1 Oversized Components (Must Split)

| Component | Total Lines | Script | CSS | Recommended Split |
|-----------|-------------|--------|-----|-------------------|
| `TurnWaterfallView.vue` | 1,298 | ~455 | 575 | Toolbar, row renderer, detail panel, legend |
| `AgentTreeView.vue` | 1,146 | ~330 | 484 | Tree renderer, node detail, toolbar, legend |
| `NestedSwimlanesView.vue` | 1,058 | ~255 | 591 | Lane renderer, phase grouper, toolbar, legend |
| `SettingsView.vue` | 809 | — | 322 | 7+ section components |
| `SessionReplayView.vue` | 769 | — | 350 | Transport bar, scrubber, step list, detail |
| `AnalyticsDashboardView.vue` | 587 | — | — | 4 chart section components |
| `ConversationTab.vue` | 460 | — | — | 3 view modes → 3 components |

### 6.2 Code Duplication

| Severity | Issue | Location |
|----------|-------|----------|
| 🔴 Critical | Agent/subagent color maps duplicated 3× (similar but not identical) | `AgentTreeView:106`, `NestedSwimlanesView:88`, `TurnWaterfallView:75` |
| 🔴 High | `fmtTokens()`, `fmtCost()`, `fmtDate()` duplicated across views | `AnalyticsDashboardView`, `SessionComparisonView`, `CodeImpactView` |
| 🟡 Medium | Chart layout constants pattern repeated across 4 views | Multiple chart views |

> **Note**: Shared formatters (`formatRelativeTime`, `formatDuration`, etc.) already exist in `@tracepilot/ui/utils/formatters.ts` and are exported. The debt is not "create shared formatters" — it is **adopt the existing shared formatters** in views that define local duplicates.

### 6.3 Frontend Architecture Debt (NEW — identified during review)

| Severity | Issue | Details |
|----------|-------|---------|
| ~~🔴 Critical~~ | ~~**Desktop app bypasses backend search**~~ | *(Resolved: intentional design — session list uses client-side filtering for instant keystroke feedback; backend FTS5 serves deep content search in SessionSearchView. Not tech debt.)* |
| 🟠 High | **Redundant session loading** | Multiple components independently fetch the session list: `App.vue`, `SessionListView`, `ExportView`, `SessionComparisonView`, `analytics` store. Causes duplicate IPC/disk work and race potential. Should centralize session bootstrap. |
| 🟠 High | **Session-detail tab failures are silent** | `stores/sessionDetail.ts` catches failures for turns/events/todos/checkpoints/metrics and only `console.error`s — does NOT set user-visible error state. Users get partially broken tabs with no indication. |
| 🟡 Medium | **Wrong default path in Settings** | `SettingsView.vue:44` shows `~/.copilot/sessions/` but actual path is `~/.copilot/session-state/`. Concrete product bug. |
| 🟡 Medium | **Export contract drift** | `@tracepilot/types` defines minimal `ExportConfig`; `ExportView.vue` models additional options (anonymize, timestamps, tool calls, checkpoints). When export is implemented, the contract won't match. |

### 6.3 State Management Issues

- **`preferences.ts:95`** — `watch(modelWholesalePrices, { deep: true })` triggers full `save()` on every cell edit. Needs debounce.
- **`analytics.ts:56`** — `loaded` is a bare `Set<string>` (not reactive). Works in actions but could cause template bugs.
- **`SettingsView.vue:36-50`** — Significant local state never persisted. Resets on navigation.
- **`SessionReplayView.vue`** — All replay state is component-local. Should be a composable or store.

### 6.4 Error Handling

- **`ErrorBoundary.vue` is defined and tested but never used** in any parent component
- **`main.ts:18`** — empty `catch { /* ignore */ }` for corrupt localStorage
- **`sessions.ts:104`** — `catch { // Silent }` for background reindexing
- **No global error handler** — `app.config.errorHandler` never set

### 6.5 Dead Components

| Component | Status |
|-----------|--------|
| `ThemeToggle.vue` | Never imported — `AppSidebar.vue` has its own inline toggle |
| `ErrorBoundary.vue` | Defined + tested but never mounted in the component tree |
| `StubView.vue` | Not referenced in router (all routes have real views) |

### 6.6 STUB Comments (36 instances)

Concentrated in: `SessionReplayView` (mock replay data), `SessionComparisonView` (mock comparison), `ExportView` (mock export), `SettingsView` (15 stubs — most settings aren't persisted), `HealthScoringView` (mock health data).

### 6.7 Test Coverage

**34% coverage by file count** — 13/38 production files have tests.

Missing tests for: `SessionListView`, `SessionDetailView`, `SessionTimelineView`, `SessionComparisonView`, `SessionReplayView`, `ExportView`, `SettingsView`, `HealthScoringView`, all 5 tab views, `sessionDetail` store, router.

### 6.8 TypeScript Quality

- ✅ 100% Composition API with `<script setup lang="ts">`
- ✅ All `defineProps` use generic type syntax
- ⚠️ 37 `as any` in test files for store assignment — should use `DeepPartial<T>` fixtures
- ⚠️ 1 production `any` in `AgentTreeView.vue:618` (template ref — acceptable)

### 6.9 Performance Concerns

- **Timeline monoliths** — 1,000+ line components render entire tree on any state change. No `v-memo`, no virtualized lists for sessions with 100+ turns.
- **`ConversationTab.vue:91`** — `turn.assistantMessages.filter(m => m.trim())` called inline in `v-for` 3× (should be computed)
- **`TimeRangeFilter.vue:30-34`** — watch re-dispatches to store on every keystroke (needs debounce)

### 6.10 Accessibility

✅ **Strong foundation**: ARIA roles on sidebar, breadcrumb, loading states, charts, tables, replay scrubber.

⚠️ **Gaps**: Session cards missing `aria-label`, `<th>` elements missing `scope="col"`, `ThemeToggle` missing `role="switch"`.

---

## 7. Desktop App — CSS & Styling (Deep Dive)

### 7.1 Current State Overview

| Metric | Value | Assessment |
|--------|-------|------------|
| Global CSS file | 1,435 lines (43.7 KB) | ⚠️ Large, contains component-specific styles |
| Components with scoped styles | 25/56 (100% scoped when present) | ✅ |
| Inline styles | 156 total | ❌ Very high |
| CSS variables defined | ~65 | ✅ Well-organized |
| Hardcoded hex colors in .vue files | 67+ | ❌ Bypasses design system |
| Unique font-size values | 15+ | ❌ No typography scale enforced |
| `@keyframes spin` duplications | 3 | ⚠️ |
| Hardcoded z-index values | 6 | ⚠️ |

### 7.2 The Four-Paradigm Problem

The codebase simultaneously uses:

1. **Global BEM-ish classes** in `styles.css` (`.card`, `.badge-*`, `.btn-*`, `.data-table`, `.stat-card-*`)
2. **Tailwind CSS v4 utility classes** (`flex`, `gap-2`, `text-xs`, `rounded-md`, `px-3 py-2`)
3. **Scoped `<style scoped>` blocks** — 25 components, ranging from 6 to 591 lines
4. **Inline styles** — 130 static `style=""` + 26 dynamic `:style=`

Additionally, `styles.css:1384-1406` defines **hand-rolled utility classes** (`.flex`, `.gap-1`, `.mt-1`, etc.) that **duplicate and conflict with Tailwind** (e.g., `.mb-4` = `14px` in global CSS vs Tailwind's `1rem`).

### 7.3 Design Token Inventory

**Well-tokenized domains** (defined in `styles.css:10-110`):

| Domain | Token Count | Examples |
|--------|-------------|---------|
| Canvas/backgrounds | 5 | `--canvas-default`, `--canvas-subtle`, `--canvas-inset`, `--canvas-overlay`, `--canvas-raised` |
| Border | 5 | `--border-default`, `--border-muted`, `--border-subtle`, `--border-accent`, `--border-glow` |
| Text | 6 | `--text-primary` through `--text-inverse` |
| Semantic colors | 24 | `--accent-*`, `--success-*`, `--warning-*`, `--danger-*`, `--done-*`, `--neutral-*` (4 each) |
| Shadows | 5 | `--shadow-sm/md/lg`, `--shadow-glow-accent/success` |
| Layout | 4 | `--sidebar-width`, `--header-height`, `--content-max-width` |
| Radius | 5 | `--radius-sm` (6px) through `--radius-full` (9999px) |
| Transitions | 3 | `--transition-fast` (100ms), `--transition-normal` (180ms), `--transition-slow` (280ms) |
| Z-Index | 5 | `--z-sidebar` (40) through `--z-tooltip` (80) |
| Gradients | 3 | `--gradient-accent`, `--gradient-card`, `--gradient-surface` |

**Missing token domains**:

| Domain | Current State | Recommendation |
|--------|--------------|----------------|
| **Spacing** | Raw `px` values everywhere (14px, 20px, 6px, etc.) | Define `--space-1` through `--space-8` or rely fully on Tailwind's spacing |
| **Typography / font-size** | 15+ unique `rem` values, typography classes exist but underused | Define `--text-xs` through `--text-xl` or enforce Tailwind `text-*` classes |
| **Font-weight** | Hardcoded 400/500/600/700 | Define `--font-normal/medium/semibold/bold` |
| **Line-height** | Various hardcoded values | Standardize with Tailwind or tokens |

### 7.4 Hardcoded Colors Audit

**In JS/template (inline styles and computed values):**
- `AgentTreeView:106-110`, `NestedSwimlanesView:88-91`, `TurnWaterfallView:75-79` — identical agent color maps: `#6366f1`, `#22d3ee`, `#a78bfa`, `#f472b6`, `#fbbf24`
- `AnalyticsDashboardView` — 11 instances of `#6366f1`, `#818cf8`, `#a78bfa` in SVG charts
- `CodeImpactView:204-205`, `ToolAnalysisView:204-205` — `#34d399` (success), `#fb7185` (danger)
- `SessionComparisonView:433-498` — `#6366f1`, `#a78bfa`, `#27272a`, `#3f3f46`, `#fafafa`, `#a1a1aa`
- `ToolAnalysisView:83-91` — JS-computed `rgba(99, 102, 241, ...)` for heatmap

**In scoped CSS:**
- `AnalyticsDashboardView:565` — gradient with `#6366f1, #a78bfa`
- `SettingsView:764` — gradient with `#6366f1, #818cf8`
- `ToolAnalysisView:330` — `color: #a1a1aa` (should be `--text-secondary`)
- `ToolAnalysisView:403` — `color: rgba(255, 255, 255, 0.85)` — **breaks light theme**

### 7.5 Inline Style Hotspots

| Component | Inline Styles | Worst Patterns |
|-----------|---------------|----------------|
| `SettingsView.vue` | ~42 | `width: 80px; text-align: center; font-size: 0.75rem` repeated |
| `SessionComparisonView.vue` | ~20 | `text-align: right` on every table cell |
| `HealthScoringView.vue` | ~8 | `flex: 1`, `text-align: right`, `font-weight: 600` |
| `TodosTab.vue` | ~7 | Micro-adjustments |
| `ToolCallDetail.vue` | ~15 | `color: var(--text-tertiary)` on every label |

### 7.6 Undefined CSS Variables

| Variable | Used In | Status |
|----------|---------|--------|
| `var(--fg-muted, #8b949e)` | `SessionTimelineView:112` | ❌ Not defined — should be `--text-secondary` |
| `var(--fg-subtle, #6e7681)` | `SessionTimelineView:119` | ❌ Not defined — should be `--text-tertiary` |
| `var(--text-on-emphasis, #fff)` | `TimeRangeFilter:107` | ❌ Not defined — add to token system |

### 7.7 Duplicated CSS

| Issue | Locations |
|-------|-----------|
| `@keyframes spin` defined 3× | `LoadingOverlay.vue:33`, `SessionListView.vue:160`, `ExportView.vue:526` |
| `.gradient-value` defined 2× (different gradients!) | `styles.css:1352` vs `AnalyticsDashboardView:564` |
| `.mb-4` defined with 3 different values | `styles.css:1399` (14px), `AnalyticsDashboardView:523` (20px), `ToolAnalysisView:319` (20px) |
| Legend dot styling duplicated | `CodeImpactView` (`.chart-legend-dot`) vs `ToolAnalysisView` (`.legend-dot`) |

### 7.8 Theming

- **Dark theme** = default (`:root` block)
- **Light theme** = `[data-theme="light"]` override
- ✅ All semantic tokens properly re-mapped in light theme
- ✅ `prefers-reduced-motion: reduce` and `prefers-contrast: more` media queries
- ⚠️ Two separate theme toggle implementations (`ThemeToggle.vue` + `AppSidebar.vue`)
- ❌ Hardcoded `rgba(255, 255, 255, ...)` values will break in light theme

### 7.9 Responsive Design

Minimal — only 3 breakpoints exist:
- `@media (max-width: 1200px)` — grid collapse (`styles.css:1506`)
- `@media (max-width: 900px)` — single-column + bottom-bar (`styles.css:1511`)
- `@media (max-width: 768px)` — `NestedSwimlanesView.vue:1173` only

**Not responsive**: stat card grids, export layout (fixed 340px), sidebar (fixed 240px), chart SVGs (fixed coordinates), settings forms.

Note: Lower severity for a Tauri desktop app, but window resizing still matters.

---

## 8. Shared TypeScript Packages

### 8.1 `@tracepilot/types` (403 lines, 27 interfaces)

**Strengths**: Clean barrel export, consistent optional fields, good JSDoc.

**Issues**:
| Severity | Issue | Details |
|----------|-------|---------|
| 🟠 High | `HealthFlag.severity` incompatible scales | Line 107: `"info" \| "warning" \| "error"` vs line 282: `"warning" \| "danger"` |
| 🟡 Medium | `TodoItem.status` typed as `string` | Should be `'done' \| 'in_progress' \| 'blocked' \| 'pending'` literal union |
| 🟡 Medium | `ComparisonResult.sessionA/B` are identical anonymous objects | Extract to named `ComparisonSessionSnapshot` interface |
| 🟡 Medium | No discriminated unions for events | `SessionEvent.data` is `Record<string, unknown>` — could be discriminated on `eventType` |
| 🟢 Low | 7 types never directly imported by consumers | `TodoDep`, `TodoItem`, `CodeChanges`, `ModelMetricDetail`, `ProductivityMetrics`, `SessionDurationStats`, `ReplayState` |

### 8.2 `@tracepilot/client` (193 lines)

**Issues**:
| Severity | Issue |
|----------|-------|
| 🟠 High | Zero tests — critical IPC bridge untested |
| 🟠 High | No error handling layer — raw `invoke()` with no try/catch, retry, or error normalization |
| 🟡 Medium | `getHealthScores()` and `exportSession()` are permanent stubs returning mocks even in Tauri |
| 🟡 Medium | No caching strategy — every call hits the backend |
| 🟡 Medium | 46 KB mock data file (`mock/index.ts`) should be extracted to JSON or test-fixtures package |
| 🟢 Low | Unnecessary `SessionHealth` re-export from types package |

### 8.3 `@tracepilot/ui` (26 components, 95 tests)

**Strengths**: Excellent accessibility (ARIA roles, keyboard nav), consistent CSS variable usage, solid prop typing, zero `any`.

**Issues**:
| Severity | Issue |
|----------|-------|
| 🟡 Medium | Duplicated `relativeTime()` in `SessionCard.vue` vs shared `formatRelativeTime()` |
| 🟡 Medium | Mixed CSS approach: inline styles + Tailwind + scoped blocks + design-system classes |
| 🟡 Medium | 12/26 components have zero tests (54% coverage) |
| 🟡 Medium | 6 components exported but never imported by any consumer |
| 🟢 Low | `SectionPanel.vue` `padding` prop accepted but never used |
| 🟢 Low | `FormSwitch.vue:55` uses hardcoded `white` instead of a design token |
| 🟢 Low | Design tokens referenced but never defined in the UI package — no fallback documentation |

### 8.4 `@tracepilot/config`

**Nearly empty skeleton**:
- Description claims "Shared TypeScript, ESLint, and Tailwind configuration presets"
- Reality: only `typescript/base.json` has content
- `eslint/` directory is empty (repo uses Biome, not ESLint)
- No `scripts`, `main`, `types`, or `dependencies` fields in `package.json`

### 8.5 Build Configuration Issues

| Severity | Issue |
|----------|-------|
| 🟡 Medium | `vue` is a `dependency` in `@tracepilot/ui` — should be `peerDependency` (risk of dual Vue instances) |
| 🟡 Medium | Missing `noUncheckedIndexedAccess` in tsconfig base |
| 🟢 Low | No `exports` field in package.json files (using legacy `main`) |
| 🟢 Low | No build step for packages — ship raw TypeScript source |

---

## 9. CLI App

**5 commands, 0 tests, ~300 lines of duplicated parsing logic**

### 9.1 Strengths
- Well-implemented commands: `list`, `show`, `search`, `resume`, `index`
- Good UX: chalk coloring, partial ID resolution, JSON output mode, streaming events

### 9.2 Issues

| Severity | Issue | Details |
|----------|-------|---------|
| 🟠 High | Zero tests | 5 commands completely untested |
| 🟠 High | `index` command is a stub | Just prints a message to use the Rust indexer |
| 🟡 Medium | Silent error swallowing | `catch { /* skip */ }` blocks in `search.ts:57`, `list.ts:45`, `utils.ts:85` |
| 🟡 Medium | Parsing logic duplicated from Rust core | ~300 lines of session discovery, workspace YAML parsing, turn reconstruction in TypeScript — drift risk |
| 🟡 Medium | README stale | Only mentions `list` and `show`, missing `search`, `resume`, `index` |
| 🟡 Medium | No `test` script in `package.json` | `pnpm -r test` silently skips CLI — workspace appears green while CLI is untested |
| 🟢 Low | `apps/cli/dist/` committed to git | 28 compiled JS files tracked despite `dist/` in `.gitignore` |

---

## 10. Project Infrastructure

### 10.1 CI/CD — 🔴 CRITICAL GAP

**No CI/CD pipeline exists.** No `.github/workflows/`, no `.gitlab-ci.yml`, nothing. This means:
- No automated testing on PRs
- No build verification
- No release pipeline
- No dependency vulnerability scanning (`cargo audit`, `npm audit`)

**Recommended phased approach**:
1. Phase 1: `cargo test`, `cargo clippy`, `pnpm test`, `biome check`, `vue-tsc --noEmit`
2. Phase 2: `cargo audit`, `npm audit`, Dependabot/Renovate
3. Phase 3: Release pipeline, artifact publishing

### 10.2 Tracing/Logging — 🔴 CRITICAL GAP

- `tracing` crate is a dependency; `tracing-subscriber` is declared in workspace
- **Zero** files call `tracing_subscriber::init()` or any subscriber setup
- All ~8 `tracing::warn!/info!` calls across Rust code are **no-ops in production**
- `eprintln!` used in tauri-bindings instead of `tracing`
- Frontend uses raw `console.log/error` (33+ instances)

### 10.3 Build System Issues

| Severity | Issue | Location |
|----------|-------|----------|
| 🟡 Medium | No `[profile.release]` — missing LTO, strip, codegen-units optimization | Root `Cargo.toml` |
| 🟢 Low | `@fontsource-variable/inter` in both root and desktop `package.json` | Redundant |
| 🟢 Low | Unused workspace deps: `clap`, `tracing-subscriber` (if unused after init) | Root `Cargo.toml` |
| 🟢 Low | `serde_yaml = "0.9"` is deprecated (archived by author) | Root `Cargo.toml:22` |

### 10.4 Scripts

- ✅ `scripts/build.ps1` — functional
- ⚠️ `scripts/dev.ps1` — just prints help text, references nonexistent `release.ps1`
- ❌ No unified test script (`cargo test && pnpm test`)
- ❌ No cross-platform scripts (`.ps1` only — Windows-only)

### 10.5 Documentation

**Strengths**: Excellent README, research docs, architecture docs, design system docs, data integration guide.

**Gaps**:
| Issue | Notes |
|-------|-------|
| No API reference | 12 Tauri IPC commands undocumented |
| No CONTRIBUTING.md | No developer onboarding guide |
| No CHANGELOG.md | No release tracking |
| No LICENSE file | Legal risk for distribution (flagged by Gemini review) |
| No SECURITY.md | No vulnerability reporting process |
| Stale README | Says Phase 3-7 "Planned" but Phase 3 analytics is complete |
| Empty directories | `docs/decisions/`, `docs/screenshots/` |
| Misplaced file | `copilot-session-viewer-report.md` in repo root (should be in `docs/`) |

### 10.6 Biome Configuration

- `biome.json` sets `noExplicitAny` to **`"warn"`** instead of `"error"` — allows `any` to slip through
- Consider upgrading critical rules from `warn` to `error` to create a hard quality gate

---

## 11. Cross-Cutting Concerns

### 11.1 Error Handling Strategy

| Layer | Approach | Quality |
|-------|----------|---------|
| Rust core | `TracePilotError` with `thiserror` — 6 typed variants | ✅ Good |
| Rust indexer | `anyhow::Result` with context | ✅ Acceptable |
| Tauri bridge | `.map_err(\|e\| e.to_string())` — all context lost | ❌ Critical |
| TS client | Raw `invoke()` — no error types | ⚠️ Needs work |
| Vue components | No global handler, empty catches | ⚠️ Needs work |

**Recommendation**: Define structured error types at the Tauri boundary that serialize to JSON. The frontend should be able to distinguish error categories (not found, DB error, parse error, etc.).

### 11.2 Type Safety Across Boundaries

The Rust → Tauri → TypeScript pipeline has type drift:
- `event_count`: `Option<i64>` (SQLite) → `Option<usize>` (Rust) → `number | undefined` (TS)
- Timestamps: `DateTime<Utc>` (Rust) → `Option<String>` (index DB) → `string | undefined` (TS)
- Status fields: Enums in TS, strings in Rust
- Session IDs: Plain `String` everywhere — no validation at any boundary

**IPC command-name drift risk**: `@tracepilot/client` uses hardcoded string command names (e.g., `"get_session_detail"`) while the Rust command registry is a separate list. No contract test or codegen ensures they stay in sync. A typo in either side silently breaks at runtime.

### 11.3 Configuration Management

- No `.env` files or environment configuration
- Hardcoded paths (`~/.copilot/session-state/`, `~/.copilot/tracepilot/index.db`) with no override
- No Tauri app data directory usage (`tauri::api::path::app_data_dir()`)

### 11.4 Concurrent Command Race Conditions

Tauri commands are async and can execute concurrently. Without managed state (single `IndexDb` instance), concurrent commands each open their own SQLite connection. While SQLite handles this via WAL mode, there's no application-level coordination for operations like `reindex_sessions_full` that delete and recreate the database while other commands may be reading.

---

## 12. Prioritized Action Items

### 🔴 P0 — Critical (Fix First)

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | **Add CI/CD pipeline** — GitHub Actions for `cargo test`, `pnpm test`, `cargo clippy`, `biome check`, `vue-tsc` | Medium | Prevents regressions |
| 2 | **Initialize tracing subscriber** — wire `tracing-subscriber` in Tauri main entry point | Small | Makes all `tracing::` calls functional |
| 3 | **Define Tauri error enum** — replace `Result<T, String>` with structured `TauriError` that serializes to JSON | Medium | Enables meaningful frontend error handling |
| ~~4~~ | ~~**Fix desktop search to use backend FTS**~~ | — | *(Resolved: client-side session list filtering is correct by design; FTS5 is for deep content search)* |
| 5 | **Fix hardcoded colors breaking light theme** — especially `rgba(255,255,255,...)` in `ToolAnalysisView:403`, `ExportView:521` | Small | Fixes visual bugs in light theme |

### 🟠 P1 — High Priority

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 6 | **Add Tauri managed state** — persistent `IndexDb` in `tauri::State<Mutex<IndexDb>>` | Small | Eliminates per-command DB connection overhead |
| 7 | **Wire `ErrorBoundary.vue`** in `App.vue` + set `app.config.errorHandler` | Small | Global error resilience (tiny effort, high payoff) |
| 8 | **Extract agent color maps** to shared constant in `constants.ts` or `@tracepilot/ui` | Small | Eliminates 3× duplication |
| 9 | **Adopt existing shared formatters** — replace local `fmtTokens`, `fmtCost`, `fmtDate` with `@tracepilot/ui/utils/formatters` | Small | Uses existing infrastructure, eliminates duplication |
| 10 | **Extract SQLite helpers** in `session_db.rs` — `open_readonly()`, `table_exists()` | Small | Eliminates 7× duplication |
| 11 | **Unify `truncate_utf8`** — single implementation in `tracepilot-core` | Small | Eliminates cross-crate duplication |
| 12 | **Add tests for tauri-bindings** — at minimum: happy-path for all 13 commands using in-memory/temp DB | Medium | Tests critical untested bridge |
| 13 | **Add tests for `@tracepilot/client`** — verify mock path, type contracts | Small | Tests critical untested IPC layer |
| 14 | **Fix session-detail silent failures** — set user-visible error state in `sessionDetail` store, not just `console.error` | Small | Users see broken tabs with no indication |
| 15 | **Replace 67+ hardcoded hex colors** with CSS variable references (provide hex→token mapping table) | Medium | Design system consistency + light theme support |
| 16 | **Resolve CSS paradigm conflict** — remove hand-rolled utilities from `styles.css:1384-1406` that conflict with Tailwind; document intended strategy: Tailwind utilities for layout, design tokens for colors, scoped CSS for complex components only | Medium | Eliminates `.mb-4` value conflicts |
| 17 | **Promote stringly-typed fields to enums** — ~~`ToolTransaction.status`~~, `shutdown_type`, `HealthFlag.category` | Small | Type safety (ToolTransaction removed) |
| 18 | **Add contract tests** between Rust Tauri commands and `@tracepilot/client` command names/payloads | Medium | Prevents silent IPC breakage |
| 19 | **Remove `apps/cli/dist/` from git** — `git rm --cached apps/cli/dist/` | Tiny | Clean VCS |
| 20 | **Fix wrong Settings path** — `SettingsView.vue:44` shows `~/.copilot/sessions/` but should be `~/.copilot/session-state/` | Tiny | Product bug |

### 🟡 P2 — Medium Priority

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 21 | **Centralize session bootstrap** — eliminate duplicate session-list fetches across App.vue, SessionListView, ExportView, ComparisonView, analytics store | Medium | Reduce IPC churn, prevent races |
| 22 | **Split timeline components** — extract toolbar, row renderer, detail panel from each 1,000+ line view | Large | Maintainability (prioritize when perf pain measured) |
| 23 | Add spacing tokens (`--space-1` through `--space-8`) or enforce Tailwind spacing | Medium | Consistent spacing |
| 24 | Add typography tokens or enforce Tailwind `text-*` classes consistently | Medium | Reduce 15+ unique font sizes |
| 25 | Extract composables: replay logic, chart layout, comparison | Medium | Reusability |
| 26 | Deduplicate `@keyframes spin` — define once in `styles.css` | Tiny | DRY |
| 27 | Fix `HealthFlag.severity` type mismatch between interfaces | Small | Type consistency |
| 28 | Narrow `TodoItem.status` to literal union type | Tiny | Compiler catches invalid values |
| 29 | Fix undefined CSS variables (`--fg-muted`, `--fg-subtle`, `--text-on-emphasis`) | Tiny | Prevents fallback issues |
| 30 | Move `vue` from deps to peerDeps in `@tracepilot/ui` | Tiny | Prevents dual Vue instances |
| 31 | Add `noUncheckedIndexedAccess` to tsconfig base | Tiny | Catches unsafe array/record access |
| 32 | Use `load_session_summary_with_events` in `load_single_full_session` | Small | Eliminates double event parsing |
| 33 | Add Cargo `[profile.release]` with LTO, strip, codegen-units=1 | Tiny | Smaller/faster binary |
| 34 | Debounce `preferences.ts` wholesale price watcher | Tiny | Prevents excessive localStorage writes |
| 35 | Address `reindex_incremental` missing transaction wrapping | Small | Performance + consistency |
| 36 | Remove or implement `tracepilot-export` crate | Small/Large | Remove dead weight or add functionality |
| 37 | Clean up `@tracepilot/config` — remove empty `eslint/`, update description | Tiny | Accuracy |
| 38 | Convert 156 inline styles to CSS classes (priority: SettingsView's ~42, ComparisonView's ~20) | Medium | Maintainability |
| 39 | Add CLI `test` script to `package.json` so `pnpm -r test` doesn't give false green | Tiny | CI honesty |
| 40 | Upgrade Biome `noExplicitAny` from `"warn"` to `"error"` | Tiny | Hard quality gate |

### 🟢 P3 — Low Priority / Polish

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 41 | Add doc comments to `ConversationTurn`, `SessionSummary`, `analytics/types.rs` fields | Small | Developer experience |
| 42 | ~~Remove dead code: `count_events()`, `ToolTransaction`, unused Vue components (`ThemeToggle`, `StubView`)~~ **Partially resolved: `ToolTransaction` removed; `count_events()` internalized** | Small | Cleanliness |
| 43 | Remove unused workspace deps (`clap`) | Tiny | Cleanliness |
| 44 | Migrate `serde_yaml` 0.9 → `serde_yml` (deprecated crate) | Small | Maintenance |
| 45 | Add LICENSE file, CONTRIBUTING.md, CHANGELOG.md, SECURITY.md | Small | Legal + onboarding |
| 46 | Update stale README phase status | Tiny | Accuracy |
| 47 | Move `copilot-session-viewer-report.md` into `docs/` | Tiny | Organization |
| 48 | Add cross-platform scripts (Makefile/justfile alongside .ps1) | Small | Contributor accessibility |
| 49 | Add `[workspace.lints]` section for shared Clippy/rustc lints | Small | Consistent lint rules |
| 50 | Add responsive breakpoints for grid layouts, sidebar, charts | Medium | Window resize handling |
| 51 | Add virtualization for timeline views with 100+ turns | Medium | Performance |
| 52 | Archive or delete `docs/design/prototypes/shared/design-system-{a,b,c}.css` | Tiny | Remove ~3,300 lines dead CSS |
| 53 | Extract 46 KB mock data to JSON file or test-fixtures package | Small | Clean separation |
| 54 | Rename `ModifiedFileEntry.additions` to `modifications` (semantic naming fix) | Tiny | Clarity |
| 55 | Add `SessionSummary::date_key()` method to eliminate 3× date computation duplication | Tiny | DRY |
| 56 | Integrate Dependabot/Renovate for automated dependency updates | Small | Maintenance |
| 57 | Address 36 STUB comments — categorize into: wire to real API, create tracking issue, or remove | Large | Feature completeness |

---

## 13. Appendix: Review Corrections

This report was reviewed by 4 models (Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex, Gemini 3 Pro). The following corrections were applied based on their feedback:

### Factual Corrections
- `.map_err(|e| e.to_string())` count corrected from "40+" to "~37" (verified by Opus, GPT 5.4, Codex)
- `tracing` call count corrected from "9" to "~8" (verified by GPT 5.4, Codex)
- `read_todo_deps()` removed from dead code list — it IS consumed by tauri-bindings (caught by Opus)
- SQLite connection duplication downgraded from "Critical" to "High" — maintainability issue, not outage risk (Codex, Opus)
- Agent color maps noted as "similar but not identical" rather than "duplicated 3×" (GPT 5.4)
- Formatter duplication recommendation changed from "create shared formatters" to "adopt existing `@tracepilot/ui` formatters" (GPT 5.4 — the shared utils already exist)

### Priority Adjustments
- **Tauri managed state** moved from P0 to P1 — real issue but not as urgent as tracing/errors/CI (GPT 5.4)
- **CSS paradigm conflict** moved from P0 to P1 — doesn't cause bugs, just maintainability debt (Opus)
- **ErrorBoundary wiring** moved from P2 to P1 — tiny effort, significant resilience gain (Opus)
- **Timeline component splitting** moved from P1 to P2 — split when perf pain is measured (GPT 5.4)
- **~~Desktop bypasses backend search~~** ~~added as P0~~ — *(Resolved: not tech debt, intentional design for session list instant filtering)*

### Newly Added Findings (from reviews)
- **~~Desktop app bypasses backend search entirely~~** — *(Resolved: not tech debt, see above)* (GPT 5.4)
- **Redundant session loading across 5+ components** — duplicate IPC/disk work (GPT 5.4)
- **Session-detail tab failures are silent** — only `console.error`, no user-visible state (GPT 5.4)
- **Wrong default path in SettingsView** — shows `sessions/` instead of `session-state/` (GPT 5.4)
- **Export contract drift** between types package and ExportView (GPT 5.4)
- **Silent file deletion in `reindex_sessions_full`** — `let _ = std::fs::remove_file(...)` (Codex)
- **IPC command-name drift risk** — no contract tests between Rust and TS (Codex, GPT 5.4)
- **No LICENSE file** — legal risk (Gemini)
- **No SECURITY.md** — no vulnerability reporting process (Gemini)
- **Biome rules set to warn instead of error** — `noExplicitAny` can slip through (Opus)
- **CLI missing `test` script** — `pnpm -r test` silently skips CLI (Codex)
- **Concurrent Tauri command race conditions** without managed state (Opus)

### Structural Changes
- CLI app promoted to its own section (§9) — was buried in infrastructure (Opus)
- Added confidence notes and review process metadata to header
- Added this corrections appendix for transparency

---

*This report was generated by 6 parallel Claude Opus 4.6 exploration agents, then reviewed by Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex, and Gemini 3 Pro. Findings were consolidated, corrected, and re-prioritized based on cross-model consensus. 50+ items across 57 action items, covering all 4 Rust crates, 6 TypeScript packages, 56 Vue components, and project infrastructure.*
