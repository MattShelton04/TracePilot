# On-disk path inventory and centralization plan

TracePilot reads data owned by the GitHub Copilot CLI and writes its own local state beside that data. The goal is to keep every product path shape in one place, make configured paths explicit, and avoid losing user data when a path changes.

## Single sources of truth

| Surface | Source of truth | Purpose |
| --- | --- | --- |
| Rust path shapes | `crates/tracepilot-core/src/paths.rs` | Shared constants and resolvers for Copilot-owned paths, TracePilot-owned paths, and repo-scoped skill roots. |
| Rust command names | `crates/tracepilot-core/src/constants.rs` | Default executable names for `copilot`, `git`, and `gh`, plus model/process constants. |
| User-configured runtime paths | `~/.copilot/tracepilot/config.toml` via `TracePilotConfig.paths` | Existing users' configured `sessionStateDir` and `indexDbPath` remain authoritative. |
| TypeScript UI placeholders | `packages/types/src/paths.ts` | Non-authoritative placeholders and common command names used only by UI copy/dev-mode fallbacks. |
| Frontend persisted config | `packages/types/src/defaults.ts` + backend `get_config` | TS defaults deliberately leave absolute paths empty; backend resolves absolute paths. |

## Product path inventory

| Path | Owner | Contents | Current references | Configuration and migration recommendation |
| --- | --- | --- | --- | --- |
| `~/.copilot/` | Copilot CLI | CLI home containing settings, versions, MCP config, skills, session state, and TracePilot's colocated app data. | `launcher::copilot_home`, config injector, MCP, skills, version manager, Tauri helper validation. | Resolve through `tracepilot_core::paths::CopilotPaths`. Do not allow TracePilot to relocate this globally; it belongs to Copilot CLI. |
| `~/.copilot/session-state/` | Copilot CLI | One subdirectory per session UUID. | `tracepilot_core::session::discovery`, setup wizard, CLI app, README/docs/tests. | Configurable through `TracePilotConfig.paths.sessionStateDir` because users may keep or copy sessions elsewhere. If changed, do not move data automatically because Copilot owns it; re-scan the new root and show the resulting session count. |
| `~/.copilot/session-state/<uuid>/workspace.yaml` | Copilot CLI | Workspace metadata for a session. | `tracepilot-core` discovery/summary parsers and docs. | Treat as read-only session file; file name remains centralized conceptually under session parsing. |
| `~/.copilot/session-state/<uuid>/events.jsonl` | Copilot CLI | Event stream used for conversations, telemetry, tool calls, alerts, and indexing. | `tracepilot-core` parsers, indexer, alert watcher, tests. | Read-only; no relocation independent of the session root. |
| `~/.copilot/session-state/<uuid>/session.db` | Copilot CLI | Per-session SQLite DB, currently used for todos and related state. | `tracepilot-core` DB parsers. | Read-only; no relocation independent of the session root. |
| `~/.copilot/session-state/<uuid>/plan.md` | Copilot CLI | Per-session plan artifact. | `tracepilot-export`/core docs and renderers. | Read-only; no relocation independent of the session root. |
| `~/.copilot/session-state/<uuid>/checkpoints/` | Copilot CLI | Checkpoint markdown/content snapshots. | `tracepilot-core` checkpoint parser and export. | Read-only; no relocation independent of the session root. |
| `~/.copilot/session-state/<uuid>/rewind-snapshots/` | Copilot CLI | Rewind snapshots used by Copilot CLI. | `tracepilot-core` rewind parser. | Read-only; no relocation independent of the session root. |
| `~/.copilot/settings.json` | Copilot CLI | User-editable Copilot CLI settings. | `config_injector::copilot_config`. | Path shape now comes from `tracepilot_core::paths`. TracePilot may edit only allow-listed user settings and must preserve unknown keys. Never relocate or copy. |
| `~/.copilot/config.json` | Copilot CLI | Legacy settings plus newer internal CLI-managed state; may contain `//` comments. | `config_injector::copilot_config`. | Read for compatibility; never write. Never relocate or copy. |
| `~/.copilot/mcp-config.json` | Copilot CLI | MCP server registry/config consumed by Copilot-compatible tooling. | `tracepilot-orchestrator/src/mcp/config.rs`. | Path shape comes from `CopilotPaths`. TracePilot edits this file in place; no relocation. |
| `~/.copilot/skills/` | Copilot CLI / user | Global skill directories, each with `SKILL.md` and optional assets. | `skills::discovery`, `skills::manager`. | Path shape comes from `CopilotPaths::global_skills_dir`. TracePilot may create/update/delete user-requested global skills. Do not relocate automatically. |
| `<repo>/.copilot/skills/` | Repository/user | Repo-scoped skills. | `skills::discovery`, import wizard copy, manager validation. | Path shape comes from `RepoPaths::copilot_skills_dir`. Repo content is not app data; never copy/move except explicit skill operations. |
| `<repo>/.github/skills/` | Repository/user | Alternate repo-scoped skills. | `skills::manager` validation and import wizard copy. | Path shape comes from `RepoPaths::github_skills_dir`. Treat as repo-owned. |
| `~/.copilot/pkg/universal/<version>/` | Copilot CLI | Installed Copilot CLI package version directory. | `version_manager`, config injector agent-definition commands. | Path shape comes from `CopilotPaths::pkg_universal_dir`/`version_dir`. Read and patch agent definitions only through existing guarded commands. |
| `~/.copilot/pkg/universal/<version>/definitions/` | Copilot CLI | YAML agent definitions. | `config_injector::read_agent_definitions`. | Directory name centralized as `COPILOT_DEFINITIONS_DIR`. Edits require validation and backups. |
| `~/.copilot/tracepilot/` | TracePilot | App-owned local state colocated under Copilot home. | `TracePilotConfig`, task DB, templates, presets, repo registry, backups, docs. | Path shape comes from `TracePilotPaths`. This is TracePilot-owned and can be migrated if a future setting changes the app data root. |
| `~/.copilot/tracepilot/config.toml` | TracePilot | Main persisted app config. | `tracepilot-tauri-bindings/src/config/mod.rs`. | Path comes from `TracePilotPaths::config_toml`. Keep at the default location unless a future app-data-root setting is introduced. |
| `~/.copilot/tracepilot/index.db` | TracePilot | Search/index SQLite DB derived from sessions. | `tracepilot-indexer`, `TracePilotConfig.paths.indexDbPath`, setup wizard. | Configurable. If user changes this path, copy the existing DB and SQLite sidecars (`-wal`, `-shm`) when possible, then re-open/reindex. If copy fails, leave old data in place and surface an actionable error. |
| `~/.copilot/tracepilot/index.db-wal`, `index.db-shm` | TracePilot / SQLite | SQLite WAL/SHM sidecars. | `remove_index_db_files`, SQLite runtime. | Treat as part of `index.db` for deletion/copy/backup. Never configure separately. |
| `~/.copilot/tracepilot/tasks.db` | TracePilot | AI task/orchestrator SQLite DB. | `tracepilot-orchestrator/src/task_db/mod.rs`, Tauri task helpers. | Path shape comes from `TracePilotPaths::tasks_db`. If app data root changes, copy with sidecars and migrations. |
| `~/.copilot/tracepilot/backups/database/` | TracePilot | Pre-migration DB backups. | Index DB and task DB migration code. | Path shape comes from `TracePilotPaths::database_backups_dir` relative to each DB parent. Keep with the DB being migrated. |
| `~/.copilot/tracepilot/backups/agents/` | TracePilot | Agent/config backups with metadata sidecars. | `config_injector::backup_dir`, config-injector UI. | Path shape comes from `TracePilotPaths::agent_backups_dir`. If app data root changes, copy recursively. |
| `~/.copilot/tracepilot/templates/` | TracePilot | Session launcher templates and dismissed-default marker. | `templates.rs`. | Path shape comes from `TracePilotPaths::templates_dir`. If app data root changes, copy recursively. |
| `~/.copilot/tracepilot/presets/` | TracePilot | Tauri-configured task presets. | `TracePilotConfig::presets_dir`, task preset commands. | Kept for backward compatibility. If app data root changes, copy recursively. |
| `~/.copilot/tracepilot/task-presets/` | TracePilot | Standalone/library fallback task preset directory. | `presets::io::presets_dir`. | Keep as standalone fallback unless/until the CLI/library path is migrated. Do not merge with `presets/` without an explicit migration. |
| `~/.copilot/tracepilot/jobs/` | TracePilot | File-based orchestrator IPC: manifest, heartbeat, task/context files. | `TracePilotConfig::jobs_dir`, `task_orchestrator::prompt::default_jobs_dir`. | Path shape comes from `TracePilotPaths::jobs_dir`. Jobs are transient; on app-data-root change, prefer creating a fresh jobs directory and leaving old completed jobs for cleanup. |
| `~/.copilot/tracepilot/repo-registry.json` | TracePilot | Known repository registry. | `repo_registry.rs`. | Path shape comes from `TracePilotPaths::repo_registry_json`. If app data root changes, copy atomically. |
| User repository/worktree paths | User/git | Source repositories and generated git worktrees. | Session launcher, worktree commands, repo registry, file browser. | User-provided paths must remain explicit, canonicalized, and not derived from app data roots. Never move without explicit user action. |
| OS temp directories | OS/test tooling | Profiling/test session fixtures and temporary files. | Tests/profiling helpers. | Test-only or OS-managed; do not centralize into product config. |
| Build outputs: `dist/`, `target/`, `.tauri/`, generated clients | Build tooling | Build artifacts. | package scripts, workflows, Biome excludes. | Build/test-only; centralize through package scripts/workflows, not runtime path registry. |

## Common executable inventory

| Command | Owner | Current use | Centralization recommendation |
| --- | --- | --- | --- |
| `copilot` | GitHub Copilot CLI | Session launch, SDK bridge discovery, resume commands, command previews. | Rust default is `tracepilot_core::constants::DEFAULT_CLI_COMMAND`; user override is `TracePilotConfig.general.cliCommand`; TS fallback is `DEFAULT_CLI_COMMAND`. |
| `git` | Git | Repo discovery, worktrees, branch checkout, version checks, app git metadata. | Rust default is `DEFAULT_GIT_COMMAND`. Keep user repo paths as explicit arguments, never shell-concatenate unless platform launcher requires it. |
| `gh` | GitHub CLI | Auth status and GitHub API imports. | Rust default is `DEFAULT_GH_COMMAND`. Future enhancement: expose an optional `githubCliCommand` only if users need non-standard installs. |
| `powershell`, `cmd`, `explorer`, `open`, `xdg-open`, terminal emulators | OS | Terminal/file-manager integration and Windows fallbacks. | Keep platform-specific constants contained in `tracepilot-orchestrator::process`/launcher modules. Do not expose as general user config unless a concrete use case appears. |
| `node`, `npx`, `pnpm`, `npm`, `cargo`, `vite`, `tauri`, `biome`, `tsx`, `vitest` | Development/build tooling | Package scripts, tests, examples, MCP fixture commands. | Build/test-only; keep centralized in package scripts/workflows. Runtime code should not depend on these except explicit user-configured MCP servers. |

## Architecture plan

1. Path shapes live in `tracepilot_core::paths`. Callers choose between `CopilotPaths`, `TracePilotPaths`, and `RepoPaths` instead of spelling directory names repeatedly.
2. User-selected paths stay in `TracePilotConfig.paths`. These values override defaults wherever present. `sessionStateDir` is a Copilot/session source path; `indexDbPath` is TracePilot-owned data.
3. Derived TracePilot directories (`jobs`, `presets`, backups) derive from the configured `indexDbPath` parent in the desktop app so users who place the DB elsewhere keep related TracePilot-owned state nearby.
4. TypeScript never computes authoritative absolute defaults. UI placeholders live in `packages/types/src/paths.ts`; production defaults come from backend `get_config`.
5. Command names live in constants. Only `copilot` is currently user-configurable because it is the session/resume command. `git` and `gh` should stay constants until there is a real need for custom binary paths.

## Path-change behavior

| Changed path | Ownership | Behavior |
| --- | --- | --- |
| `sessionStateDir` | Copilot CLI or user copy | Do not move contents. Validate existence, re-scan, and update config if accepted. Existing index rows become stale until reindex; reindex should reconcile the new source. |
| `indexDbPath` | TracePilot | Copy the old DB and sidecars to the new path before switching when possible. If missing or corrupt, create a new DB and reindex. Do not delete the old DB automatically. |
| Future `tracepilotRoot` | TracePilot | Copy TracePilot-owned directories recursively (`config.toml`, DBs, backups, templates, presets, repo registry). Transient `jobs/` can be recreated. Show a migration report. |
| Copilot home | Copilot CLI | Not configured by TracePilot. If Copilot changes it, TracePilot should discover via a future explicit setting/env hook rather than moving Copilot data. |
| Repo/worktree paths | User/git | Never move automatically. Worktree creation/removal remains explicit through git worktree operations. |

## Regression-prevention tests

| Area | Tests |
| --- | --- |
| Rust path registry | Unit tests in `tracepilot-core::paths` verifying derived path shapes. |
| Config defaults | `tracepilot-tauri-bindings::config` tests should verify default `sessionStateDir`, `indexDbPath`, `presets_dir`, and `jobs_dir` derive from the registry while old TOML custom paths remain unchanged through migrations. |
| Runtime callers | Targeted Rust tests for config, session discovery, indexer migrations, task DB default path, MCP config path, template/preset directories. |
| TypeScript placeholders | `packages/types` tests should verify placeholder constants and `createDefaultConfig` behavior. |
| UI regressions | Existing desktop tests for setup wizard, preferences, and session launcher should use constants or mocks, not hardcoded product paths except fixture data. |
| Migration safety | Future tests for `indexDbPath` changes should create a DB with WAL/SHM sidecars, migrate/copy, and assert old files are preserved until explicit cleanup. |

## Implementation status

This document reflects the current implementation: Rust default/derived product paths are centralized in `tracepilot_core::paths`, common Rust command names are constants, and frontend user-facing placeholders are centralized in `packages/types/src/paths.ts`. Existing user configuration remains backward compatible because `TracePilotConfig.paths` still controls runtime session and index locations.
