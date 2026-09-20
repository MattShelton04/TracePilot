# On-disk path inventory and centralization plan

TracePilot reads data owned by the GitHub Copilot CLI and writes its own local state beside that data. The goal is to keep every product path shape in one place, make configured paths explicit, and avoid losing user data when a path changes.

## Single sources of truth

| Surface | Source of truth | Purpose |
| --- | --- | --- |
| Rust path shapes | `crates/tracepilot-core/src/paths.rs` | Shared constants and resolvers for Copilot-owned paths, TracePilot-owned paths, and repo-scoped skill roots. |
| Rust command names | `crates/tracepilot-core/src/constants.rs` | Default executable names for `copilot`, `git`, and `gh`, plus model/process constants. |
| User-configured runtime paths | `~/.copilot/tracepilot/config.toml` via `TracePilotConfig.paths` | Persists `copilotHome`, `tracepilotHome`, plus derived compatibility fields `sessionStateDir` and `indexDbPath`. |
| TypeScript UI placeholders | `packages/types/src/paths.ts` | Non-authoritative placeholders and common command names used only by UI copy/dev-mode fallbacks. |
| Frontend persisted config | `packages/types/src/defaults.ts` + backend `get_config` | TS defaults deliberately leave absolute paths empty; backend resolves absolute paths. |

## Product path inventory

| Path | Owner | Contents | Current references | Configuration and migration recommendation |
| --- | --- | --- | --- | --- |
| `~/.copilot/` | Copilot CLI | CLI home containing settings, versions, MCP config, skills, session state, and TracePilot's default colocated app data. | `TracePilotConfig.paths.copilotHome`, config injector, MCP, skills, version manager. | Default path shape comes from `CopilotPaths`; users may override TracePilot's Copilot-home view in Settings. Do not move or copy contents automatically because Copilot owns this tree. |
| `~/.copilot/session-state/` | Copilot CLI | One subdirectory per session UUID. | `TracePilotConfig::session_state_dir`, session discovery/indexing/export/import commands. | Derived from `copilotHome` as `{copilotHome}/session-state` for new/UI-driven config; legacy custom `sessionStateDir` values are preserved for compatibility. Do not move data automatically because Copilot owns it; re-scan the active root and show the resulting session count. |
| `~/.copilot/session-state/<uuid>/workspace.yaml` | Copilot CLI | Workspace metadata for a session. | `tracepilot-core` discovery/summary parsers and docs. | Treat as read-only session file; file name remains centralized conceptually under session parsing. |
| `~/.copilot/session-state/<uuid>/events.jsonl` | Copilot CLI | Event stream used for conversations, telemetry, tool calls, alerts, and indexing. | `tracepilot-core` parsers, indexer, alert watcher, tests. | Read-only; no relocation independent of the session root. |
| `~/.copilot/session-state/<uuid>/session.db` | Copilot CLI | Per-session SQLite DB, currently used for todos and related state. | `tracepilot-core` DB parsers. | Read-only; no relocation independent of the session root. |
| `~/.copilot/session-state/<uuid>/plan.md` | Copilot CLI | Per-session plan artifact. | `tracepilot-export`/core docs and renderers. | Read-only; no relocation independent of the session root. |
| `~/.copilot/session-state/<uuid>/checkpoints/` | Copilot CLI | Checkpoint markdown/content snapshots. | `tracepilot-core` checkpoint parser and export. | Read-only; no relocation independent of the session root. |
| `~/.copilot/session-state/<uuid>/rewind-snapshots/` | Copilot CLI | Rewind snapshots used by Copilot CLI. | `tracepilot-core` rewind parser. | Read-only; no relocation independent of the session root. |
| `~/.copilot/settings.json` | Copilot CLI | User-editable Copilot CLI settings. | `config_injector::copilot_config`. | Path shape now comes from `tracepilot_core::paths`. TracePilot may edit only allow-listed user settings and must preserve unknown keys. Never relocate or copy. |
| `~/.copilot/config.json` | Copilot CLI | Legacy settings plus newer internal CLI-managed state; may contain `//` comments. | `config_injector::copilot_config`. | Read for compatibility; never write. Never relocate or copy. |
| `~/.copilot/mcp-config.json` | Copilot CLI | MCP server registry/config consumed by Copilot-compatible tooling. | `tracepilot-orchestrator/src/mcp/config.rs`, Tauri MCP commands. | Path shape comes from configured `copilotHome` + `CopilotPaths`. TracePilot edits this file in place; no relocation. |
| `~/.copilot/skills/` | Copilot CLI / user | Global skill directories, each with `SKILL.md` and optional assets. | `skills::discovery`, `skills::manager`. | Path shape comes from `CopilotPaths::global_skills_dir`. TracePilot may create/update/delete user-requested global skills. Do not relocate automatically. |
| `<repo>/.copilot/skills/` | Repository/user | Repo-scoped skills. | `skills::discovery`, import wizard copy, manager validation. | Path shape comes from `RepoPaths::copilot_skills_dir`. Repo content is not app data; never copy/move except explicit skill operations. |
| `<repo>/.github/skills/` | Repository/user | Alternate repo-scoped skills. | `skills::manager` validation and import wizard copy. | Path shape comes from `RepoPaths::github_skills_dir`. Treat as repo-owned. |
| `~/.copilot/pkg/<platform>/<version>/` | Copilot CLI | Installed Copilot CLI package version directory. Platform tag is `win32-x64` on Windows, `darwin-arm64`/`darwin-x64` on macOS, `linux-arm64`/`linux-x64` on Linux, falling back to `universal`. | `version_manager`, config injector agent-definition commands. | Path shape resolved dynamically via `CopilotPaths::pkg_target_dir`/`version_dir`. Read and patch agent definitions only through existing guarded commands. |
| `~/.copilot/agents/` | Copilot CLI / user | Personal `*.agent.md` definitions, discovered recursively. | `agents::discovery`, Agents editor. | Path shape comes from `CopilotPaths`. TracePilot creates, edits and deletes user-requested personal agents, always with a backup. Do not relocate automatically. |
| `<repo>/.github/agents/`, `<repo>/.claude/agents/` | Repository/user | Repo-scoped `*.agent.md` definitions, discovered recursively. | `agents::discovery`, Agents editor. | Repo content is not app data; never copy/move except explicit agent operations. |
| `~/.copilot/installed-plugins/<plugin>/**/agents/` | Plugin | Plugin-supplied agents. | `agents::discovery`. | Read-only: a plugin update overwrites them. |
| `~/.copilot/pkg/<platform>/<version>/definitions/` | Copilot CLI | Built-in `*.agent.yaml` definitions. | `agents::discovery`, `config_injector::read_agent_definitions`. | Directory name centralized as `COPILOT_DEFINITIONS_DIR`. Read for the active CLI version; edits require validation and backups, and are gated behind the `configInjector` flag because a CLI update replaces them. |
| `~/.agents/skills/` | Copilot CLI / user | The CLI's second personal skills root, listed alongside `~/.copilot/skills/` in `copilot skill --help`. | `skills::discovery::personal_skill_dirs`. | Existing skills are editable and use personal enablement settings; new skills are still created under `<COPILOT_HOME>/skills/`. |
| `<dist>/builtin-skills/`, `<dist>/builtin/` | Copilot CLI | Built-in `SKILL.md` directories shipped with the CLI. `builtin-skills/` is the current spelling; `builtin/` is the older one and both appear in recent packages. | `skills::discovery::discover_builtin_skills` via `cli_install::DistRoot::builtin_skills_dir`. | Read-only. The newest-versioned copy of each name wins. |
| `<dist>/definitions/` | Copilot CLI | Built-in `*.agent.yaml` definitions. | `agents::discovery`, `config_injector::read_agent_definitions`. | Read-only unless the `configInjector` flag is on. Exactly one distribution root contributes, so two installations cannot list every built-in agent twice. |
| `~/.copilot/tracepilot/` | TracePilot | App-owned local state colocated under Copilot home by default. | `TracePilotConfig.paths.tracepilotHome`, templates, repo registry, backups, docs. | Path shape comes from `TracePilotPaths`. Users can change this app data directory in setup or Settings; TracePilot copies known app-owned files/directories into the new root and preserves the old root. |
| `~/.copilot/tracepilot/config.toml` | TracePilot | Main persisted app config and path overrides. | `tracepilot-tauri-bindings/src/config/mod.rs`. | Bootstrap location intentionally stays at the default TracePilot config path so the app can find overrides before reading them. Runtime data can move via `tracepilotHome`; the config file itself is not relocated. |
| `~/.copilot/tracepilot/index.db` | TracePilot | Search/index SQLite DB derived from sessions. | `tracepilot-indexer`, `TracePilotConfig.paths.indexDbPath`, setup wizard. | Derived from `tracepilotHome` as `{tracepilotHome}/index.db`; users choose the directory, not this file path. `indexDbPath` remains serialized for compatibility and is normalized on save/load. |
| `~/.copilot/tracepilot/index.db-wal`, `index.db-shm` | TracePilot / SQLite | SQLite WAL/SHM sidecars. | `remove_index_db_files`, SQLite runtime. | Treat as part of `index.db` for deletion/copy/backup. Never configure separately. |
| `~/.copilot/tracepilot/backups/database/` | TracePilot | Pre-migration DB backups. | Index DB migration code. | Path shape comes from `TracePilotPaths::database_backups_dir` relative to each DB parent. Keep with the DB being migrated. |
| `~/.copilot/tracepilot/backups/agents/` | TracePilot | Agent/config backups with metadata sidecars. | `config_injector::backup_dir`, config-injector UI, `agents::write`. | Path shape comes from `TracePilotPaths::agent_backups_dir`. If app data root changes, copy recursively. |
| `~/.copilot/tracepilot/templates/` | TracePilot | Session launcher templates and dismissed-default marker. | Config-aware Tauri template commands plus `templates.rs` fallback helpers. | Derived from `tracepilotHome`; copied recursively on app data root change. |
| `~/.copilot/tracepilot/repo-registry.json` | TracePilot | Known repository registry. | Config-aware Tauri registry commands plus `repo_registry.rs` fallback helpers. | Derived from `tracepilotHome`; copied on app data root change and written atomically. |
| User repository/worktree paths | User/git | Source repositories and generated git worktrees. | Session launcher, worktree commands, repo registry, file browser. | User-provided paths must remain explicit, canonicalized, and not derived from app data roots. Never move without explicit user action. |
| OS temp directories | OS/test tooling | Profiling/test session fixtures and temporary files. | Tests/profiling helpers. | Test-only or OS-managed; do not centralize into product config. |
| Build outputs: `dist/`, `target/`, `.tauri/`, generated clients | Build tooling | Build artifacts. | package scripts, workflows, Biome excludes. | Build/test-only; centralize through package scripts/workflows, not runtime path registry. |

## Copilot CLI installation layouts

The CLI resolves its built-in skills and agent definitions relative to its own
JavaScript bundle, so a user's installation method decides where they live. A
directory holding that bundle is a *distribution root*; the resolver is
`tracepilot_core::paths::cli_install`.

| Installation method | Distribution root | Notes |
| --- | --- | --- |
| WinGet (`winget install GitHub.Copilot`) | `%LOCALAPPDATA%/copilot/pkg/<target>/<version>/` | Self-extracting executable; older builds used `<COPILOT_HOME>/pkg`. |
| Homebrew cask (`brew install --cask copilot-cli`) | `~/Library/Caches/copilot/pkg/<target>/<version>/` on macOS | Same self-extracting binary, linked from Homebrew's `bin`. |
| Install script (`curl -fsSL https://gh.io/copilot-install \| bash`) | OS cache's `copilot/pkg/<target>/<version>/` | Installs `$PREFIX/bin/copilot`; Linux defaults to `$XDG_CACHE_HOME/copilot/pkg` or `~/.cache/copilot/pkg`. |
| Direct download from `github/copilot-cli` releases | OS cache's `copilot/pkg/<target>/<version>/` | As above, from wherever the user unpacked the executable. |
| npm (`npm install -g @github/copilot`) | `<npm prefix>/node_modules/@github/copilot` (Windows) or `<npm prefix>/lib/node_modules/@github/copilot` | `@github/copilot` is a loader that spawns `@github/copilot-<platform>-<arch>`. Older releases shipped `definitions/` and `builtin/` in the package itself and ran from there. |
| `COPILOT_CLI_DIST_DIR=<dir>` | `<dir>` | Overrides the bundle directory outright. |

Older packages used `pkg/universal/<version>` instead of a platform tag, and
`pkg/tmp` is the CLI's staging area for a partly downloaded update — never a
distribution root. Current OS caches and legacy home packages are searched
together, so an old installation cannot hide an update in a new location.
Built-in agents prefer the newest complete installation (`.extraction-complete`
for extracted packages), falling back to an available incomplete root only if
none are complete. Skills retain the newest copy of each name.

A usable `COPILOT_CLI_DIST_DIR` overrides which bundle supplies both catalogs,
even if it has an older version or omits built-ins found in another installation.
An absent or assetless override falls back to ordinary discovery. Other detected
installations remain registered as read-only skill roots.

npm-style prefixes vary by Node toolchain, so `cli_install::node_global_package_dirs`
checks `npm_config_prefix`/`NVM_BIN`, the platform defaults
(`%APPDATA%\npm`, `/usr/local/lib`, `/opt/homebrew/lib`, …) and the
version-managed layouts of nvm, fnm, Volta, pnpm and Bun. If none of those
match, `cli_install::executable_dist_dirs` follows the `copilot` executable on
`PATH` through its symlinks and looks beside it, in `../libexec` and in
`../lib/node_modules/@github/copilot`. Windows npm shims also resolve the
`node_modules/@github/copilot` directory beside the shim itself.

### Environment overrides the CLI honours

| Variable | Effect on TracePilot |
| --- | --- |
| `COPILOT_HOME` | Replaces `~/.copilot` as the CLI home when TracePilot has no configured `copilotHome`, so personal skills, agents, settings and session state follow it. |
| `COPILOT_SKILLS_DIRS` | `PATH`-separated extra personal skill roots, scanned alongside `<COPILOT_HOME>/skills`. |
| `COPILOT_CLI_DIST_DIR` | Names the distribution root directly. |
| `COPILOT_PKG_CACHE_HOME`, `COPILOT_CACHE_HOME` | Additional self-extractor cache roots; each contains `pkg/<target>/<version>/`. |
| `XDG_CACHE_HOME` | Cache base used on Linux, also searched as a fallback on other platforms. |

When `TRACEPILOT_DATA_ROOT` is set, discovered roots and skill access must stay
inside that boundary, including environment overrides and linked files.
Machine-wide npm/PATH discovery is disabled. Invalid isolation settings fail
closed. Outside isolation, existing linked personal and project skills retain
their normal behavior; opening a personal skill from any registered personal
root keeps its Global scope and uses Copilot's personal enablement settings.

### Degradation contract

Discovery scans every root independently, so a user with an installation
TracePilot cannot find keeps everything else:

- A root that does not exist is skipped silently.
- A root that exists but cannot be read (a file where a directory belongs, a
  half-extracted package, a permissions error) becomes an `error` diagnostic
  for that root alone.
- No distribution root at all produces one `warning` diagnostic and an empty
  built-in list. The Skills and Agents managers render warnings as an
  information banner, separately from the "could not be loaded" list, so a
  missing CLI never reads as broken content.

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
2. User-selected roots stay in `TracePilotConfig.paths`. `copilotHome` controls where TracePilot reads/writes Copilot-owned config surfaces and derives the session source; `tracepilotHome` controls TracePilot-owned data.
3. `sessionStateDir` and `indexDbPath` are compatibility fields. New UI-driven writes derive them from `copilotHome` and `tracepilotHome`; migrations preserve legacy custom session directories to avoid losing access to Copilot-owned sessions.
4. TypeScript never computes authoritative absolute defaults. UI placeholders live in `packages/types/src/paths.ts`; production defaults come from backend `get_config`.
5. Command names live in constants. Only `copilot` is currently user-configurable because it is the session/resume command. `git` and `gh` should stay constants until there is a real need for custom binary paths.

## Path-change behavior

| Changed path | Ownership | Behavior |
| --- | --- | --- |
| `sessionStateDir` | Copilot CLI | Derived from `copilotHome` for new/UI-driven configs, with legacy custom values preserved. Do not move contents. Validate/re-scan after the active session root changes. Existing index rows become stale until reindex; reindex should reconcile the new source. |
| `tracepilotHome` | TracePilot | Copy known app-owned files (`index.db`, sidecars, repo registry) and directories (backups, templates) into the new root if absent. Preserve old data by default; cleanup should be an explicit future action with confirmation. Surface errors if copy fails. |
| `indexDbPath` | TracePilot | Derived compatibility field only. Normalize to `{tracepilotHome}/index.db` on load/save. |
| `copilotHome` | Copilot CLI | Update where TracePilot reads/writes Copilot settings, MCP config, versions, and global skills. Do not move or copy Copilot-owned data automatically. |
| Repo/worktree paths | User/git | Never move automatically. Worktree creation/removal remains explicit through git worktree operations. |

## Regression-prevention tests

| Area | Tests |
| --- | --- |
| Rust path registry | Unit tests in `tracepilot-core::paths` verifying derived path shapes. |
| Config defaults | `tracepilot-tauri-bindings::config` tests verify default homes, derived `indexDbPath`, and migration from legacy custom DB files into `tracepilotHome`. |
| Runtime callers | Targeted Rust tests for config, session discovery, indexer migrations, MCP config path, and template directories. |
| TypeScript placeholders | `packages/types` tests should verify placeholder constants and `createDefaultConfig` behavior. |
| UI regressions | Existing desktop tests for setup wizard, preferences, and session launcher should use constants or mocks, not hardcoded product paths except fixture data. |
| Migration safety | Tests for TracePilot-home changes should create DBs/sidecars and app-owned directories, save a new `tracepilotHome`, and assert old files are preserved while absent files are copied. |

## Implementation status

This document reflects the current implementation: Rust default/derived product paths are centralized in `tracepilot_core::paths`, common Rust command names are constants, frontend user-facing placeholders are centralized in `packages/types/src/paths.ts`, and runtime overrides are persisted in `TracePilotConfig.paths` inside the default `~/.copilot/tracepilot/config.toml` bootstrap file. Frontend placeholder definitions are non-authoritative; production values from backend `get_config` override them.
