# tracepilot-core

Core library for parsing, modelling, and analysing GitHub Copilot CLI
sessions. Every other TracePilot crate (indexer, export, orchestrator, tauri-
bindings) depends on this one.

The long-form architecture + "how to add a new event type" notes live in the
crate-level rustdoc on `src/lib.rs`. Build and view with:

```bash
cargo doc -p tracepilot-core --no-deps --open
```

## Public API

Top-level modules re-exported from `src/lib.rs`:

| Module       | Purpose                                                             |
| ------------ | ------------------------------------------------------------------- |
| `session`    | Session discovery — scan, resolve, filter session directories       |
| `parsing`    | Event parsing pipeline, diagnostics, workspace/DB parsers           |
| `models`     | Domain types: events, summaries, conversations                      |
| `turns`      | Turn reconstruction state machine                                   |
| `summary`    | Orchestrates all parsers → `SessionSummary`                         |
| `analytics`  | Cross-session aggregation (tokens, tools, code impact)              |
| `error`      | Crate-wide `Error` / `Result` types                                 |
| `ids`        | Session / event ID helpers                                          |
| `constants`  | Stable wire / directory constants                                   |
| `utils`      | Low-level helpers (path, time, serde)                               |

Error model: one `thiserror` enum per crate, flattened at the IPC boundary.
See ADR [0005](../../docs/adr/0005-error-model-thiserror-per-crate.md).

## Workspace dependencies

None — this crate is the root of the Rust workspace's dependency tree. It is
a dependency of `tracepilot-indexer`, `tracepilot-export`,
`tracepilot-orchestrator`, `tracepilot-tauri-bindings`, and `tracepilot-bench`.

## Layout

- `src/lib.rs` — crate docs + module declarations.
- `src/session/` — discovery (scan, resolve, filter).
- `src/parsing/` — `events.rs` (raw → typed dispatch), `diagnostics.rs`,
  workspace/DB/checkpoint parsers.
- `src/models/` — `event_types/`, `summary`, `conversation`.
- `src/turns/` — state machine that groups events into `ConversationTurn`s.
- `src/summary/` — builds a full `SessionSummary` from parsed inputs.
- `src/analytics/` — aggregations across many sessions.

## Features

| Feature     | Purpose                                               |
| ----------- | ----------------------------------------------------- |
| `dhat-heap` | Swaps the global allocator for dhat heap profiling    |

```bash
cargo test -p tracepilot-core --features dhat-heap
```

## Related ADRs

- [0001 — Tauri + Vue + Rust workspace](../../docs/adr/0001-tauri-vue-rust-workspace.md)
- [0003 — SQLite WAL, per-feature databases](../../docs/adr/0003-sqlite-wal-per-feature-databases.md)
- [0005 — Error model: `thiserror` per crate](../../docs/adr/0005-error-model-thiserror-per-crate.md)
