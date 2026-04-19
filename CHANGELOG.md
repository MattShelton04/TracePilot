# Changelog

All notable changes to TracePilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project loosely adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.3] - 2026-04-19

### Added
- **Pop-out session windows** — open any session in its own dedicated window by dragging a tab out of the strip, or Ctrl+clicking a session in the list. Multi-tab session viewing with drag-to-reorder, keyboard navigation, context menu, and tab state persisted across restarts
- **Session File Explorer** — new Explorer tab in session detail lets you browse and view all files inside a session's state directory directly in the app, with type-aware rendering for Markdown, code, JSONL, YAML, TOML, and more; binary and SQLite files shown as placeholders; path traversal protected
- **System prompt visibility** — `system.message` events (e.g. injected system prompts) now appear as a collapsible panel above session events in the conversation view
- **Structured checkpoint rendering** — checkpoints with the standard XML schema now render with collapsible sections, section icons, and a raw/structured toggle; the checkpoint list is redesigned as a compact vertical timeline with expand-all; compaction events link directly to their associated checkpoint

### Changed
- **Session export now on by default** — the Export button is now accessible directly from the session detail panel without enabling a feature flag; new presets (Full Archive, Minimal Team Log, Agent Context, Full-Fidelity Backup), raw zip export option, and richer subagent metadata in Markdown output
- **Session indexing performance** — session event parsing now uses an LRU cache (keyed on file size + mtime) to eliminate redundant re-parses; reindex is debounced within a 2-minute window; FTS health and browse-facet results are cached, significantly reducing latency when navigating between views
- **Reduced SQLite allocation pressure** — SQL placeholder string generation now uses a single pre-allocated buffer instead of hundreds of heap allocations per batch; search filter helpers updated to match
- **Session launcher supports complex prompts** — the `--interactive` prompt argument is now reliably encoded on all platforms using PowerShell stop-parsing / Base64 decode, supporting prompts with quotes, backslashes, and newlines that previously caused launch failures
- **Tech debt: major codebase decomposition** — IPC hardening and Tauri capability scoping (main vs viewer windows), `runAction`/`runMutation` codemod across all 14 Pinia stores, `tauri-specta` type binding generation, `PageShell` layout adoption across 13 views, and comprehensive security hardening in the Rust backend (input validation, error scrubbing, safe path handling)

### Fixed
- Subagent model attribution corrected; a warning badge is shown when a subagent's reported model doesn't match the session model
- Rich tool rendering compatibility with real session data; several display regressions resolved

## [0.6.2] - 2026-04-12

### Added
- **AI Tasks** (experimental) — define reusable task presets with context-aware prompts, dispatch them through a Copilot CLI orchestrator, and monitor runs from dedicated dashboard, detail, and preset-management views. Enable in **Settings → Experimental**. Very rough implementation (not recommended yet)
- **Live session steering via Copilot SDK** (experimental) — connect TracePilot to an active Copilot CLI session and send follow-up messages from the chat view. Enable in **Settings → Experimental**. Prone to bugs - not recommended for use yet.

### Changed
- **Copilot CLI v1.0.24 support** — added coverage for new session fields including reasoning tokens, request IDs, and subagent performance metrics, improving compatibility and analytics fidelity on newer sessions
- Search and indexing are more robust — CLI search now includes assistant and tool content, while index DB maintenance and opening safeguards reduce bloat and improve refresh reliability

### Removed
- Deprecated `exportSession()` client API — use `exportSessions()` instead (same functionality, accepts a single config)

## [0.6.1] - 2026-03-31

### Added
- **Skills Manager** — create, edit, and manage Copilot CLI skills from the desktop; import from a local path, file, or any GitHub repository (including private repos via the `gh` CLI); IDE-style editor with live Markdown preview, YAML frontmatter editing, and an integrated asset browser. Enable in **Settings → Features**
- **MCP Server Manager** — add, configure, and health-check MCP servers with full Copilot CLI config compatibility; import server definitions from file or GitHub; browse available tools with expandable input schemas. Enable in **Settings → Features**
- TracePilot App Automation skill — built-in Copilot CLI `SKILL.md` for automating the desktop app via WebView2 CDP, with launch, connect, and smoke-test e2e scripts

### Fixed
- Session overview and chat now auto-refresh when background subagents complete; `read_agent` calls are visible inline and in-progress durations no longer show 0 ms
- Search facet and stats queries silently discarded results on SQLite row errors; errors now propagate correctly
- CLI showed a raw stack trace when `~/.copilot/session-state` was absent; replaced with a clean, actionable error message
- Chat scrollbar visibility; light-mode chart hover styling
- 9 missing CSS design token variables that caused silent visual regressions across multiple views

## [0.6.0] - 2026-03-29

### Added
- **Session Export/Import** (experimental) — export sessions to JSON (lossless `.tpx.json`), Markdown, or CSV with preset configurations, granular section selection, privacy-aware redaction (paths, secrets, PII), and live preview. Import `.tpx.json` archives with conflict resolution. Enable in **Settings → Features**
- **Conversation Chat overhaul** — subagent activity now renders as interactive cards with slide-out detail panels instead of inline tool dumps; progressive disclosure collapses tool-heavy turns; cross-turn subagent aggregation groups child activity under the originating agent; intent and memory shown as inline pills
- **Parallel session indexing** — sessions now index concurrently via Rayon with an optimized release profile and parser preallocation, significantly reducing initial and incremental indexing time
- **4.8× faster search indexing** — bulk FTS5 write strategy eliminates per-row trigger overhead for large reindexes (41 s → 9.3 s on 275 sessions / 327K rows)
- **Theme-aware shell renderer** — PowerShell and terminal tool output now follows your active theme instead of a fixed dark palette
- **Performance monitoring infrastructure** — tracing spans across hot Rust paths, IPC timing instrumentation, perf budgets, and bundle analysis CI workflow
- **Update check on startup** is now enabled by default for new installations — disable in **Settings → Updates**

### Changed
- Consolidated structured logging across the entire desktop app; silent catch blocks now surface warnings via `logWarn`
- Smoother loading screen animations tuned for faster indexing runs
- CSS design system: hardcoded colors replaced with theme tokens, refined micro-interactions and animations
- Search browse presets streamlined; duplicate search calls on pagination reset and view navigation eliminated

### Fixed
- FTS turn attribution now correctly matches reconstructor turn boundaries
- Missing or corrupt `workspace.yaml` no longer causes FK constraint errors during search indexing
- Markdown export: proper newline spacing between blockquotes; links open externally
- Shared formatters hardened against non-finite numeric inputs
- Chart tooltips restored; search first-run empty state properly styled

## [0.5.1] - 2026-03-26

### Added
- **Search overhaul**: tool results indexing (2.5× more searchable content), session-grouped results with collapsible headers, and FTS health status bar
- **Token/cost attribution improvements** with session activity display (#133)
- **BranchSelector** with inline search, custom values, and default reset (#128)
- Replay turn-load failure surfacing with retry support (#115)

### Changed
- Consolidated shared utilities (formatters, chart geometry, SQLite helpers, error handling) into `@tracepilot/types` (#136, #140, #149, #118)
- Typed `IndexerError` replaces `anyhow::Result` in tracepilot-indexer (#110)
- Extracted `useAsyncGuard` composable for race-condition-safe async (#152)
- Split monolithic test file and `types/index.ts` into focused modules (#116, #106)

### Fixed
- FTS wildcard queries and integrity checks (#155)
- Session start detection (#156) and Copilot path warnings (#159)
- Ctrl+K no longer hijacks focus while typing in inputs (#111)
- Timeline overlap detection (#109)

## [0.5.0] - 2026-03-24

### Added
- **Search browse mode** with presets (All Errors, User Messages, Tool Calls) and event-level deep-linking to exact tool calls (#87)
- **Unified Session View** in Agent Tree with failure reasons and expandable outputs (#86)
- **Worktree favourites** (#85)
- **Accessibility**: focus trap, ARIA semantics, and keyboard navigation in search palette and tabs (#102)

### Changed
- **Security hardening**: tightened CSP and trimmed Tauri capabilities (#98, #102)
- **Typed error handling**: all Tauri commands return structured `BindingsError` instead of raw strings (#102)
- **Modular Rust backend**: split monolithic `lib.rs` into domain command modules (#102)
- Read-only DB connections for all query operations (#87)
- Significant deduplication: shared composables, formatters, chart styles, and SQL helpers (#81, #88, #90, #91, #93, #96)

### Fixed
- Race conditions in preferences, search facets, and session detail loads via generation tokens (#98)
- Turn model attribution no longer inherits from subagent child tool calls (#86)
- FTS query sanitisation for special characters (#87)
- Setup wizard restart when shutdown midway through (#101)
- External link handling, CLI argument validation, TypeScript/Rust type alignment (#98, #103)

## [0.4.0] - 2026-03-23

### Added
- **Full-text search** with global search palette (`Ctrl+K` / `⌘K`), dedicated search view with content-type filters, facets, BM25 relevance ranking, and deep-link to matching conversation turn (#78)
- Auto-indexing of search content after session indexing; manual "Rebuild Search Index" button in **Settings → Data & Storage** (#78)
- **Session replay overhaul**: transport bar with play/pause/step controls and playback speed, event ticker, step navigator sidebar, and rich per-step content rendering. Currently an experimental feature (#58)
- **In-app auto-updater** with progress bar and one-click relaunch for installed builds; install-type-aware update instructions detect source, installed, or portable and show appropriate steps. Will go-live when repo becomes public (#62)
- **Launcher template system overhaul**: new default templates (Multi Agent Code Review, Write Tests), emoji icons, dismissable defaults, and usage tracking (#66)
- **Content width presets** (Standard, Wide, Full Width, Custom) and **UI scale slider** in **Settings → Appearance** (#71)
- **Markdown rendering** in conversation messages, replay content, and tool results — opt-in via Settings (#72)
- **Session Plan card** on Overview tab with collapsible Markdown rendering; expandable checkpoint content with inline Markdown preview (#73)
- **One-click CLI interactive session** launch with prompt from the desktop app (#77)
- Structured logging system with `tauri-plugin-log` — captures all Rust (`tracing::*!`) and frontend logs to rotating log files (#59)
- **Settings → Logs & Diagnostics** section: view log directory, open in explorer, export all logs to a single file, and configure log level (#59)
- Frontend error logging: `ErrorBoundary` and global error handler now write to log file (not just devtools console) (#59)
- Per-target log filtering to suppress noisy third-party crate output (tao, wry, reqwest, etc.) (#59)
- **Session data optimization**: LRU turn cache (instant repeat visits), freshness-based auto-refresh (skip redundant fetches), server-computed argument summaries, stripped `transformedUserMessage` from IPC (#67)
- Command Centre: repository count in hero card, 5-minute data cache with background refresh (#66)
- `pnpm start` convenience command for quick clone-and-run setup (#62)

### Changed
- App-wide **toast notification system** replaces inline messages and `alert()` calls; styled confirm dialogs replace browser `confirm()`; consistent loading spinners and error states with retry across all views (#70)
- **Session list cards redesigned** with icon-based stats and restructured toolbar layout (#76)
- Config Injector improvements: batch backup, backupable-files picker, backup diff preview for restores (#61, #75)
- User messages visually separated in Compact conversation mode (#75)
- Removed "Settings are stored locally" stub banner from Settings page

### Fixed
- Chart layout fixes in Code Impact view; comma formatting for large numbers and costs across all analytics views (#75)
- Config Injector "Reset All Defaults" now correctly re-syncs model dropdowns (#61)
- Worktree create modal now shows repo dropdown and auto-loads branches in All Worktrees mode (#77)
- Factory reset no longer leaves a ghost `config.toml` that skips the setup wizard on relaunch
- **Security hardening**: path traversal prevention for template IDs, parameterized SQL limits, 1 MB file size cap on template reads, env var name validation in shell commands (#69)

## [0.3.0] - 2026-03-21

### Added
- Orchestration feature (preview): launch Copilot CLI sessions, manage git worktrees, and inject config — all from the desktop app (#48)
- Config injection: set default models for Copilot CLI subagents (explore, task, code-review, general-purpose) to increase their effectiveness (#48)
- Git worktree management with repo registry persistence, disk usage tracking, branch listing, and lock/unlock support (#54)
- Session incident tracking with health scoring incidents displayed in overview tab and analytics dashboard (#50)
- Compaction and rate limit event rendering in conversation view (#52)
- What's New improvements: sidebar version link reopens modal, "View Release Notes" button in Settings, update notification moved to sidebar footer (#55)
- External link support via tauri-plugin-opener with Tauri/browser fallback (#55)
- Automated Windows installer and standalone exe builds in release workflow (#53)
- Feature flags system with experimental features toggle in Settings (#49)
- Time range filter enhancements for analytics views (#50)

### Changed
- Decomposed SettingsView into 8 focused sub-components for maintainability (#49)
- Decomposed SetupWizard into step components with extracted navigation composable (#49)
- Refactored data access layer: centralised database queries and preferences storage with `prefsStore.whenReady` for reliable config hydration at startup (#51)
- Improved CLI tool reliability and command utilities (#47)

### Fixed
- Terminal instances no longer shut down when the application exits — new 3-tier detach strategy (`CREATE_BREAKAWAY_FROM_JOB` → WMI `Win32_Process.Create` → graceful `CREATE_NEW_CONSOLE` fallback) (#56)
- Agent Tree and Todo dependency graph rendering bugs (#52)
- External links now open in system browser instead of failing silently (#55)
- What's New modal no longer shows "Updated from v0.0.0" when manually opened (#55)

## [0.2.0] - 2026-03-19

### Added
- Session explorer with searchable, filterable card grid and full-text search (SQLite FTS5)
- Conversation viewer with three modes (Chat, Compact, Timeline) and subagent attribution
- 19 specialized tool renderers (code diffs, grep results, shell output, SQL, web search, etc.)
- Analytics dashboard with token usage, sessions per day, cost trends, and model distribution
- Tool analysis with invocation frequency, success rates, and day × hour activity heatmap
- Code impact analysis with file type breakdown, most-modified files, and additions/deletions over time
- Model comparison with per-model token stats, cost breakdown, and radar charts
- Cost tracking: Copilot premium request cost + wholesale API cost with configurable prices
- Todo dependency graph visualisation
- Session comparison with normalization modes (raw, per-turn, per-minute)
- Active session detection with terminal resume capability
- Dark, light, and system themes with indigo accent
- Setup wizard with directory validation and live indexing progress
- Single source of truth versioning (workspace Cargo.toml → all crates + Tauri app)
- Update detection: opt-in GitHub API check with 24-hour caching
- "What's New" modal shown automatically on version change
- Manual update check and git info display in Settings
- CI/CD workflows for testing, linting, and automated GitHub releases
- Conventional commits enforcement via lefthook and git-cliff changelog generation
- Version bump script for monorepo-wide releases
