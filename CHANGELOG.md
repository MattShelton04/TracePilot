# Changelog

All notable changes to TracePilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Tool-result-only offset cache**: Stores byte offsets for `tool.execution_complete` events only (~97K rows vs 285K), enabling O(1) tool result lookups via direct file seek
- **On-demand event data**: `get_event_data` command fetches a single event's payload via byte-offset seek instead of full-file parsing
- **In-memory LRU turn cache**: 10-session LRU cache for reconstructed conversation turns eliminates SQLite turn blob storage
- **Frontend change detection**: `get_session_turns` returns `TurnsResponse { turns, eventsFileSize }` — auto-refresh skips re-rendering when nothing changed
- **Reindex benchmark test**: `bench_real_reindex` (ignored test) for measuring indexing performance against real session data
- Structured logging system with `tauri-plugin-log` — captures all Rust (`tracing::*!`) and frontend logs to rotating log files
- **Settings → Logs & Diagnostics** section: view log directory, open in explorer, export all logs to a single file, and configure log level
- Frontend error logging: `ErrorBoundary` and global error handler now write to log file (not just devtools console)
- Per-target log filtering to suppress noisy third-party crate output (tao, wry, reqwest, etc.)
- Developer log viewing via stdout during `cargo tauri dev` and webview devtools console

### Changed
- Events tab returns `{}` for data payloads (metadata only); full data loaded on demand via `get_event_data`
- Turns no longer stored in SQLite — served from in-memory LRU cache backed by disk parsing
- Index DB reduced from **14 MB → ~30 MB** (tool offsets + metadata vs full event blobs at 1+ GB)
- Eliminated double-parse of `events.jsonl` during reindex via `load_session_summary_with_preparsed()`
- Bumped `CURRENT_ANALYTICS_VERSION` to 5 (triggers full reindex on first launch)
- Removed "Settings are stored locally" stub banner from Settings page

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
