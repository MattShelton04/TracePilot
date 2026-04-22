# tracepilot-orchestrator

Session orchestration capabilities: git worktree management, Copilot CLI
launching, config injection, version management, repo registry, MCP server
config, session templates, and the SDK bridge.

Background-process / child-process rules are covered by ADR
[0004 — Background process discipline](../../docs/adr/0004-background-process-discipline.md).

## Public API

Top-level modules in `src/lib.rs`:

| Module                  | Purpose                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `worktrees`             | Create / prune / list git worktrees for parallel sessions    |
| `launcher`              | Spawn the Copilot CLI with injected config + capture output  |
| `config_injector`       | Materialise effective config files before launch             |
| `version_manager`       | Detect installed Copilot CLI version; migration diffs        |
| `repo_registry`         | Track registered repos + their worktrees                     |
| `templates`             | Session templates (prompt scaffolds, preset variables)       |
| `mcp`                   | MCP server config read/write, health checks, diffs           |
| `presets`               | Task presets: prompts, variables, variants                   |
| `task_db`               | Persistent task DB (SQLite, per ADR 0003)                    |
| `task_orchestrator`     | Task runner + scheduler                                      |
| `task_context`          | Context assembly (snippets, attributions) for task prompts   |
| `task_attribution`      | Attribution tracking across subagent turns                   |
| `task_ipc`              | IPC event wiring for task lifecycle                          |
| `task_recovery`         | Recovery / resume logic after crashes                        |
| `bridge`                | Copilot SDK bridge — JSON-RPC manager, events, status        |
| `skills`                | Skill discovery + preview                                    |
| `github`                | Minimal GitHub metadata helpers                              |
| `process`, `json_io`    | Child-process + JSON read/write utilities                    |
| `tokens`, `validation`  | Token counting + input validation                            |
| `models`, `types`       | Domain types + public type re-exports                        |

`pub use error::{OrchestratorError, Result}` and `pub use types::*`.

## Features

| Feature       | Default | Purpose                                                           |
| ------------- | ------- | ----------------------------------------------------------------- |
| `copilot-sdk` | on      | Enables the `copilot-sdk` git dep + bridge implementation         |

With `--no-default-features`, every bridge method returns
`BridgeError::NotAvailable` — useful for air-gapped CI and bisecting SDK
regressions. The bridge API shape is identical either way.

## Workspace dependencies

- `tracepilot-core` — for session types and parsing.

## Layout

- `src/lib.rs` — module declarations + re-exports.
- `src/error.rs` — `OrchestratorError` + `Result` alias.
- `src/bridge/` — Copilot SDK bridge; `manager/` contains
  `#[cfg(feature = "copilot-sdk")]`-gated code paths.
- `src/task_*/` — task orchestration submodules (DB, context, IPC, recovery, attribution, orchestrator).
- `src/worktrees.rs`, `src/launcher.rs`, `src/mcp/` — domain modules.

## Related ADRs

- [0003 — SQLite WAL, per-feature databases](../../docs/adr/0003-sqlite-wal-per-feature-databases.md)
- [0004 — Background process discipline](../../docs/adr/0004-background-process-discipline.md)
- [0005 — Error model](../../docs/adr/0005-error-model-thiserror-per-crate.md)
- [0012 — Filesystem trust boundary](../../docs/adr/0012-filesystem-trust-boundary.md)
