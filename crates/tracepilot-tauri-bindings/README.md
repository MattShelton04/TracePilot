# tracepilot-tauri-bindings

Tauri IPC command layer bridging the Vue frontend to `tracepilot-core`,
`tracepilot-indexer`, `tracepilot-export`, and `tracepilot-orchestrator`.
Every Tauri command the app exposes is declared here; the frontend typed
wrappers in `@tracepilot/client` are generated from this crate via
[specta](https://github.com/oscartbeaumont/tauri-specta).

IPC contract + drift detection: ADR
[0002 — IPC contract via specta-generated bindings](../../docs/adr/0002-ipc-contract-specta-bindings.md).

## Public API

- `pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry>` — the only entry
  point callers use. Registers managed state, spawns the bridge event
  forwarder, and contributes every IPC command.
- `pub const IPC_COMMAND_NAMES: &[&str]` — canonical command-name list.
  Cross-checked against `@tracepilot/client`'s `IPC_COMMANDS` in CI.
- `pub mod config` — `create_shared_config()` plus config-state wrappers.
- `pub mod error` — `BindingsError` (flattens each downstream crate's error
  into a single `serde`-able shape for the frontend; see ADR 0005).
- `pub mod events` — IPC event-name constants.
- `pub mod types` — managed-state type aliases (`SearchSemaphore`,
  `SharedOrchestratorState`, `TurnCache`, `EventCache`, …).

Commands are organised by domain under `commands/`:

| Submodule                    | Commands                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| `commands::session`          | Session list, detail, turns, events, todos, checkpoints        |
| `commands::search`           | FTS search, indexing progress, facets                          |
| `commands::analytics`        | Analytics, tool analysis, code impact                          |
| `commands::config_cmds`      | App config, agent defs, backups, templates, versions           |
| `commands::orchestration`    | Worktrees, repos, launcher, system deps                        |
| `commands::state`            | DB size, session count, update checks, git info                |
| `commands::logging`          | Log file path, export                                          |

## Features

| Feature       | Default | Purpose                                                          |
| ------------- | ------- | ---------------------------------------------------------------- |
| `copilot-sdk` | on      | Forwards to `tracepilot-orchestrator/copilot-sdk`                |

This crate never references `copilot_sdk` types directly — everything goes
through `orchestrator::bridge::manager::BridgeManager`.

## Workspace dependencies

- `tracepilot-core`
- `tracepilot-indexer`
- `tracepilot-export`
- `tracepilot-orchestrator`

## Layout

- `src/lib.rs` — `init()` plugin builder + managed-state setup.
- `src/commands/` — one module per IPC domain.
- `src/helpers.rs`, `src/validators.rs` — shared command-level helpers.
- `src/cache.rs`, `src/broadcast.rs` — LRU caches + event-broadcast plumbing.
- `src/config.rs` — shared config read/write + `create_shared_config()`.
- `src/error.rs` — `BindingsError` envelope + `From` impls per crate.
- `src/events.rs` — event-name constants (`SDK_BRIDGE_EVENT`, …).
- `src/ipc_command_names.rs` — `IPC_COMMAND_NAMES` source of truth.
- `src/specta_exports.rs` — `#[doc(hidden)]`; invoked by the binding
  generator in `apps/desktop/src-tauri`.

## Related ADRs

- [0002 — IPC contract via specta-generated bindings](../../docs/adr/0002-ipc-contract-specta-bindings.md)
- [0005 — Error model: `thiserror` per crate + IPC envelope](../../docs/adr/0005-error-model-thiserror-per-crate.md)
- [0011 — Tauri capability scoping](../../docs/adr/0011-tauri-capability-scoping.md)
- [0012 — Filesystem trust boundary](../../docs/adr/0012-filesystem-trust-boundary.md)
