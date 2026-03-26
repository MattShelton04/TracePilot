# Changelog

All notable changes to TracePilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project loosely adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Search content coverage**: tool results now indexed (2.5× more searchable content), including grep output, file reads, and command results
- **Search browse presets**: quick-access cards for common content-type filters
- **Session-grouped results**: collapsible session headers with repo, branch, and match count
- **FTS health diagnostics**: integrity check, row counts, and sync status available via backend commands

### Changed
- Wildcard queries normalized safely (`*foo`, `foo**`, bare `*` no longer crash FTS5)

### Fixed
- `fts_integrity_check` always reported failure (query_row misuse with FTS5 commands)
- Session group headers now prioritize session name over repo/branch badges

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
