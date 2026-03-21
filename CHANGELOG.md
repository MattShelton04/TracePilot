# Changelog

All notable changes to TracePilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Lean event metadata cache (v2)**: Replaced heavyweight blob cache with metadata-only `session_events` table storing byte offsets for surgical disk reads — DB size reduced from **1.07 GB to ~50 MB** (98% reduction)
- **On-demand event data**: New `get_event_data` command fetches a single event's payload via O(1) byte-offset seek instead of full-file parsing
- **In-memory LRU turn cache**: 10-session LRU cache for reconstructed conversation turns eliminates SQLite turn blob storage (saved 176 MB)
- **Per-event byte offsets**: `parse_typed_events_with_offsets()` tracks byte position and line length for every event during JSONL parsing
- **Tool call ID indexing**: Partial index on `tool_call_id` enables O(1) tool result lookups via byte-offset seek
- **Migration 7**: Drops v1 heavy tables (`session_turns`, old `session_events`), recreates lean schema with `byte_offset`, `line_length`, `tool_call_id` columns, adds `events_cached` flag, auto-VACUUMs to reclaim disk space
- **Incremental JSONL parser**: `parse_events_jsonl_from_offset()` enables byte-offset checkpointing for append-only event files
- **ReindexDecision enum**: Sessions are classified as Skip/FullReindex/IncrementalAppend for smarter reindex scheduling
- Structured logging system with `tauri-plugin-log` — captures all Rust (`tracing::*!`) and frontend logs to rotating log files
- **Settings → Logs & Diagnostics** section: view log directory, open in explorer, export all logs to a single file, and configure log level
- Frontend error logging: `ErrorBoundary` and global error handler now write to log file (not just devtools console)
- Per-target log filtering to suppress noisy third-party crate output (tao, wry, reqwest, etc.)
- Developer log viewing via stdout during `cargo tauri dev` and webview devtools console

### Changed
- Events tab now returns `{}` for event data payloads (metadata only); full data loaded on demand via `get_event_data`
- Turns are no longer stored in SQLite — served from in-memory LRU cache backed by disk parsing
- Session detail views remain **10-100x faster** for cached sessions (lean SQL query vs re-parsing MB of JSON)
- Bumped `CURRENT_ANALYTICS_VERSION` to 5 (triggers full reindex to populate lean event cache on first launch)
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
