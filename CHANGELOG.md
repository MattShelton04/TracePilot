# Changelog

All notable changes to TracePilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

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
