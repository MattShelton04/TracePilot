# TracePilot — Implementation Roadmap

> This document outlines the phased implementation plan for TracePilot, from MVP to a fully-featured,
> well-tested, modular desktop + CLI application for visualizing and auditing GitHub Copilot CLI sessions.

---

## Overview

TracePilot is structured as a Rust + TypeScript monorepo with four layers:

1. **Rust Core** (`crates/`) — parsing, indexing, export, health scoring
2. **CLI** (`apps/cli/`) — terminal interface for quick session inspection
3. **Desktop** (`apps/desktop/`) — Tauri + Vue 3 rich GUI
4. **Shared Packages** (`packages/`) — Vue components, TS types, client wrapper

Each phase builds on the prior, with clear deliverables and testing gates.

---

## Phase 1: Core Parsing & CLI MVP ✅

**Goal:** A working CLI that can list, search, and inspect any Copilot CLI session.

**Status: COMPLETE** — 9 commits on `Matt/Phase_1_Core_Parsing_and_CLI_MVP`, 35 tests passing.

### 1.1 — Rust Core: Complete Parsers ✅
- [x] `workspace.yaml` parser — fully tested with edge cases (missing fields, date formats)
- [x] `events.jsonl` streaming parser — typed event enum for all **24 event types** (expanded from original 17)
- [x] `session.db` reader — todos, todo_deps, custom table discovery (generic reader via PRAGMA)
- [x] `checkpoints/` parser — read `index.md` and individual checkpoint files (with path traversal protection)
- [x] `rewind-snapshots/index.json` parser — snapshot metadata and git state
- [x] ~~`vscode.metadata.json` parser~~ — Deferred (not present in real session data)
- [x] Conversation turn builder — state machine grouping flat events into logical turns
- [x] Shutdown metrics extractor — parse `session.shutdown` into structured metrics (last event for resumed sessions)

### 1.2 — Rust Core: Session Summary Builder ✅
- [x] `load_session_summary()` — single function combining workspace.yaml + event count + shutdown metrics
- [x] Context enrichment from `session.start` event when workspace.yaml fields are missing
- [x] 4 integration tests

### 1.3 — Rust Core: Error Handling ✅
- [x] `TracePilotError` enum using `thiserror` in `tracepilot-core`
- [x] Variants: `SessionNotFound`, `ParseError`, `IoError`, `DatabaseError`, `YamlError`, `JsonError`
- [x] Library crates use `TracePilotError`; binary crates can use `anyhow`

### 1.4 — Indexer: Local Index Database ✅
- [x] Schema migration system (version table + 2 numbered migrations, transactional DDL)
- [x] Index `workspace.yaml` metadata + shutdown metrics + enriched columns
- [x] FTS5 over conversation content (user messages, assistant messages, truncated to 100KB)
- [x] Incremental indexing via workspace.yaml mtime comparison
- [x] FTS DELETE trigger for safe re-indexing (INSERT ON CONFLICT DO UPDATE)
- [ ] File watcher for live session updates — **Deferred to Phase 2**

### 1.5 — CLI: Full Command Set ✅
- [x] `tracepilot list` — sortable, filterable (--repo, --branch, --limit, --json)
- [x] `tracepilot show <id>` — summary, --turns, --metrics, --todos, --json
- [x] `tracepilot search <query>` — grep-style search across workspace.yaml + user messages
- [x] `tracepilot index` — stub (prints message, full implementation requires NAPI-RS)
- [x] `tracepilot resume <id>` — output `gh copilot-cli --resume <id>` command
- [ ] `tracepilot health <id>` — **Deferred to Phase 4**
- [x] `--json` output for all commands
- [x] `js-yaml` for YAML parsing (replaced regex parser)
- [x] Streaming event reader for large files

### 1.6 — Testing & Review ✅
- [x] 31 Rust tests on `tracepilot-core` (error, models, parsing, turns, summary)
- [x] 4 Rust tests on `tracepilot-indexer` (migrations, search, incremental, filters)
- [x] Multi-model review by Opus 4.6, GPT 5.4, Codex 5.3 — 7 issues found and fixed
- [ ] Property-based tests (`proptest`) — Deferred to Phase 6
- [ ] Golden file test suite — Deferred to Phase 6
- [ ] CI pipeline — Phase 7

**Deliverable:** ✅ `tracepilot list`, `tracepilot show`, `tracepilot search` work reliably from the terminal.

---

## Phase 2: Desktop App — Session Explorer

**Goal:** A Tauri desktop app showing session list, detail view, and conversation timeline.

### 2.1 — Tauri Commands: Full IPC Surface
- [ ] `list_sessions` — with pagination, sorting, filtering parameters
- [ ] `get_session_detail` — full session summary + metadata
- [ ] `get_session_turns` — paginated conversation turns
- [ ] `get_session_events` — raw events with cursor pagination
- [ ] `get_session_health` — health score and flags
- [ ] `get_session_todos` — todo items and dependency graph
- [ ] `search_sessions` — FTS5 search via index DB
- [ ] `get_shutdown_metrics` — detailed model/token/cost breakdown
- [ ] Wrap all sync Rust I/O in `tokio::task::spawn_blocking`

### 2.2 — Vue Desktop: Core Views
- [ ] **Session List View** — card grid with search bar, sort controls, filters
  - Virtual scrolling for 1000+ sessions (use `vue-virtual-scroller`)
  - Filter by: repo, branch, date range, has-events, has-todos
  - Sort by: updated, created, event count, duration
- [ ] **Session Detail View** — tabbed layout:
  - Overview tab: summary, repo, branch, timestamps, health badge, quick metrics
  - Conversation tab: turn-by-turn view with collapsible tool calls
  - Events tab: raw event timeline with type-based color coding
  - Todos tab: todo list with dependency visualization
  - Metrics tab: shutdown metrics, model usage, token counts
- [ ] **Search View** — full-text search results with context snippets
- [ ] Global navigation: sidebar or top nav with breadcrumbs

### 2.3 — Vue Desktop: State Management
- [ ] Pinia store for session state (list, active session, filters)
- [ ] TanStack Query (Vue) for async data fetching with caching
- [ ] Persistent user preferences (sort order, filters, last viewed)

### 2.4 — Shared UI Components (`packages/ui`)
- [ ] `SessionCard` — summary card with health badge, repo/branch chips
- [ ] `SessionList` — virtual-scrolling card grid
- [ ] `ConversationTurn` — user/assistant message bubble with tool call accordion
- [ ] `EventTimeline` — vertical timeline with type-color-coded event nodes
- [ ] `HealthBadge` — colored score indicator (green/yellow/red)
- [ ] `MetricsPanel` — token/cost/duration summary cards
- [ ] `TodoGraph` — dependency-aware todo checklist

### 2.5 — Styling & Theming
- [ ] Tailwind CSS setup with custom TracePilot design tokens
- [ ] Dark theme (default, GitHub-inspired palette)
- [ ] Light theme option
- [ ] Responsive layout (works well at 1024px+)

### 2.6 — Testing Gate
- [ ] Vue component tests with `@vue/test-utils` + Vitest
- [ ] Tauri command integration tests
- [ ] Storybook or Histoire for component development/documentation
- [ ] Visual regression testing for key views

**Deliverable:** Desktop app shows session list → click to detail → browse conversation turns with tool calls.

---

## Phase 3: Analytics & Visualization

**Goal:** Rich analytics dashboards showing usage patterns, costs, and productivity insights.

### 3.1 — Analytics Engine (Rust)
- [ ] Aggregate metrics across sessions: total tokens, total cost, session count per day
- [ ] Per-model usage breakdown: requests, tokens (input/output), estimated cost
- [ ] Tool usage statistics: frequency, avg duration, failure rate per tool
- [ ] Code change metrics: lines added/removed over time, files modified frequency
- [ ] Session duration analysis: avg, median, p95, outliers
- [ ] Productivity heuristics: turns-to-completion, tool-call-to-turn ratio

### 3.2 — Visualization Components (Vue)
- [ ] **Usage Dashboard** — aggregated stats across all sessions
  - Token usage over time (line chart)
  - Model distribution (pie/donut chart)
  - Sessions per day/week (bar chart)
  - Cost estimation (if model pricing is available)
- [ ] **Session Timeline** — hierarchical swimlane view:
  - Lane 1: User turns (messages)
  - Lane 2: Assistant responses
  - Lane 3: Tool executions (with duration bars)
  - Lane 4: Subagent lifecycles
  - Zoomable, pannable timeline control
- [ ] **Tool Analysis View**
  - Tool call frequency heatmap
  - Average execution time per tool
  - Tool failure rates
- [ ] **Code Impact View**
  - Files modified across sessions (treemap)
  - Lines added/removed trends
  - Repository activity summary

### 3.3 — Charting Library Integration
- [ ] Evaluate and integrate: Apache ECharts (via `vue-echarts`) or D3.js
- [ ] Responsive chart sizing
- [ ] Export charts as PNG/SVG

### 3.4 — Testing Gate
- [ ] Analytics computation unit tests (Rust)
- [ ] Chart component snapshot tests
- [ ] Performance benchmarks for aggregation over 500+ sessions

**Deliverable:** Dashboard view with charts showing usage patterns, cost breakdown, and productivity metrics.

---

## Phase 4: Health Scoring & Anomaly Detection

**Goal:** Automatically detect problematic sessions and surface actionable insights.

### 4.1 — Health Scoring Engine (Rust)
- [ ] Composite health score (0.0–1.0) based on weighted heuristics:
  - Missing `session.shutdown` event (abnormal termination)
  - Extremely high event count (runaway session)
  - High error/failure rate in tool executions
  - Unusually high token consumption relative to turns
  - Session duration outliers (too short = abandoned, too long = stuck)
  - Compaction without meaningful progress
- [ ] Configurable thresholds via TracePilot config file
- [ ] Health trend tracking across sessions (is quality improving?)

### 4.2 — Secret/Sensitive Data Detection
- [ ] Regex-based scanner for common secret patterns in event data:
  - API keys, tokens, passwords, connection strings
  - PII patterns (emails, phone numbers)
- [ ] Flag sessions containing potential secrets
- [ ] Redaction support for export (mask secrets in output)

### 4.3 — UI Integration
- [ ] Health badge on every session card (color-coded)
- [ ] Health detail panel with individual flag explanations
- [ ] "Sessions needing attention" filtered view
- [ ] Anomaly alerts / notifications

### 4.4 — Testing Gate
- [ ] Health scoring unit tests with synthetic edge-case sessions
- [ ] Secret detection tests with known patterns
- [ ] False-positive rate assessment

**Deliverable:** Every session gets a health score; anomalies and secrets are automatically flagged.

---

## Phase 5: Export & Sharing

**Goal:** Export sessions in multiple formats with configurable redaction for sharing/auditing.

### 5.1 — Export Engine (Rust — `tracepilot-export`)
- [ ] **Markdown export** — conversation-style document with:
  - Session metadata header
  - Turn-by-turn conversation with tool calls
  - Metrics summary footer
  - Optional: include/exclude tool call details
- [ ] **JSON export** — full structured session data
- [ ] **CSV export** — tabular event/metrics data for spreadsheet analysis
- [ ] **HTML export** — self-contained styled report (single file)

### 5.2 — Redaction Pipeline
- [ ] Configurable redaction rules (regex patterns + built-in presets)
- [ ] Path redaction (replace absolute paths with relative)
- [ ] Content redaction (mask matched patterns with `[REDACTED]`)
- [ ] Preview mode: show what would be redacted before export

### 5.3 — CLI Export Commands
- [ ] `tracepilot export <id> --format md --output session.md`
- [ ] `tracepilot export <id> --format json --redact`
- [ ] `tracepilot export-all --format csv --output sessions.csv`

### 5.4 — Desktop Export UI
- [ ] Export button on session detail view
- [ ] Format picker dialog
- [ ] Redaction preview
- [ ] Batch export for selected sessions

### 5.5 — Testing Gate
- [ ] Export round-trip tests (export → parse → compare)
- [ ] Redaction coverage tests
- [ ] Large session export performance test

**Deliverable:** Export any session as Markdown, JSON, CSV, or HTML with optional secret redaction.

---

## Phase 6: Advanced Features

**Goal:** Power-user features that make TracePilot indispensable for Copilot CLI power users.

### 6.1 — Session Comparison
- [ ] Side-by-side diff of two sessions (structure, metrics, outcomes)
- [ ] "Similar sessions" finder (same repo, similar prompts)
- [ ] Session evolution view (same task across multiple attempts)

### 6.2 — Session Replay
- [ ] Step-through conversation replay with timeline scrubber
- [ ] Highlight what the assistant was "thinking" at each step
- [ ] Show tool call inputs/outputs inline
- [ ] Playback speed control

### 6.3 — Custom Queries & Filters
- [ ] Advanced query builder UI for complex session filtering
- [ ] Save and name custom filter presets
- [ ] SQL-like query language for power users: `sessions where repo = "X" and tokens > 10000`

### 6.4 — Session Annotations
- [ ] Add personal notes/tags to sessions (stored in TracePilot's own DB, not modifying source)
- [ ] Star/favorite sessions
- [ ] Custom labels and categories

### 6.5 — Plugin / Extension System
- [ ] Define plugin API for custom visualizations
- [ ] Plugin: Git integration (show actual diffs made during session)
- [ ] Plugin: Cost calculator (with model pricing configuration)
- [ ] Plugin: Team analytics (aggregate across users, requires shared index)

### 6.6 — Performance & Polish
- [ ] Lazy loading for all large data (events, turns)
- [ ] Virtual scrolling everywhere (session list, event list, turn list)
- [ ] Background indexing with progress indicator
- [ ] Keyboard shortcuts for navigation
- [ ] Command palette (Ctrl+K) for quick actions

### 6.7 — Testing Gate
- [ ] End-to-end Playwright tests for desktop app
- [ ] Performance benchmarks: app startup <2s, session list render <500ms
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Cross-platform testing (Windows, macOS, Linux)

**Deliverable:** Session replay, comparison, annotations, and a plugin system.

---

## Phase 7: Distribution & CI/CD

**Goal:** Automated builds, releases, and a smooth install experience.

### 7.1 — CI/CD Pipeline
- [ ] GitHub Actions workflow:
  - `cargo test` + `cargo clippy` + `cargo fmt --check`
  - `pnpm typecheck` + `pnpm test` + `pnpm lint`
  - Build desktop app for Windows, macOS, Linux
  - Build CLI for npm distribution
- [ ] Release automation:
  - Semantic versioning with changelogs
  - GitHub Releases with signed binaries
  - Tauri updater integration (auto-update)

### 7.2 — CLI Distribution
- [ ] npm package: `npm install -g tracepilot`
- [ ] Standalone binary (optional, via `pkg` or Rust rewrite of CLI)
- [ ] Homebrew formula (macOS)
- [ ] Scoop manifest (Windows)

### 7.3 — Desktop Distribution
- [ ] Windows: MSI installer + portable .exe
- [ ] macOS: .dmg with code signing
- [ ] Linux: AppImage + .deb

### 7.4 — Documentation
- [ ] User guide in `docs/`
- [ ] API reference for Rust crates (generated via `cargo doc`)
- [ ] Architecture Decision Records (ADRs) in `docs/decisions/`
- [ ] Contributing guide (`CONTRIBUTING.md`)

**Deliverable:** One-command install on all platforms, automated releases.

---

## Quality Standards (All Phases)

These standards apply throughout development:

| Area | Standard |
|------|----------|
| **Rust tests** | ≥80% coverage on library crates; property-based tests for parsers |
| **Vue tests** | Component tests for all shared UI components; view integration tests |
| **CLI tests** | Integration tests for every command; snapshot tests for output |
| **Linting** | `cargo clippy` clean; ESLint/Biome for TypeScript; `rustfmt` enforced |
| **Type safety** | `vue-tsc --noEmit` clean; no `any` types except explicit escape hatches |
| **Documentation** | Doc comments on all public Rust items; JSDoc on exported TS functions |
| **Performance** | Virtual scrolling for lists >100 items; lazy load events/turns |
| **Security** | Read-only access to session data; secrets never logged; CSP enforced |
| **Accessibility** | Keyboard navigable; screen reader labels; sufficient contrast |

---

## Architecture Principles

1. **Rust does the heavy lifting** — All parsing, indexing, aggregation, and health scoring in Rust. TypeScript/Vue only for presentation.
2. **Single source of truth** — `tracepilot-core` is the canonical parser. CLI, desktop, and future surfaces all consume the same data model.
3. **Read-only by default** — TracePilot never writes to `~/.copilot/session-state/`. All TracePilot data (index DB, preferences, annotations) lives in `~/.copilot/tracepilot/`.
4. **Progressive disclosure** — Glance (session card) → Scan (detail tabs) → Commit (raw events, analytics). Each level reveals more detail.
5. **Offline-first** — Everything works locally with no network. The local index DB enables instant search.
6. **Modular crates** — Each Rust crate has a single responsibility and can be used independently.

---

## Current Status

| Phase | Status | Notes |
|-------|--------|-------|
| **Phase 1: Core Parsing & CLI MVP** | ✅ **Complete** | 9 commits, 35 tests, 4,000+ lines |
| Phase 2: Desktop App — Session Explorer | 🔄 In Progress | |
| Phase 3: Analytics & Visualization | ⬜ Planned | |
| Phase 4: Health Scoring & Anomaly Detection | ⬜ Planned | |
| Phase 5: Export & Sharing | ⬜ Planned | |
| Phase 6: Advanced Features | ⬜ Planned | |
| Phase 7: Distribution & CI/CD | ⬜ Planned | |

### Phase 1 Deliverables (Completed)

| Component | Status | Details |
|-----------|--------|---------|
| TracePilotError enum | ✅ | 6 variants with thiserror, Result alias |
| Rust models (24 event types) | ✅ | All types validated against 53+ real sessions |
| Complete parsers | ✅ | events.jsonl, workspace.yaml, session.db, checkpoints, rewind-snapshots |
| Turn reconstruction | ✅ | State machine: 8,273 turns across 53 sessions |
| Session summary builder | ✅ | Single entry point with context enrichment |
| Indexer + FTS5 | ✅ | Schema migrations, incremental sync, conversation search |
| CLI commands | ✅ | list, show, search, resume, index (stub) |
| CLI display flags | ✅ | --turns, --metrics, --todos, --json |
| Multi-model review fixes | ✅ | 7 issues fixed (FTS, tool calls, path traversal, etc.) |
| Rust tests | ✅ | 31 core + 4 indexer = 35 tests |

| **Next up** | **Phase 2 — Desktop App: Session Explorer** |
