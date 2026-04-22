# ADR-0004: Background process discipline (Windows CREATE_NO_WINDOW, hidden_command)

Date: 2026-04-22
Status: Accepted

## Context

TracePilot spawns a lot of child processes: the Copilot CLI itself,
`git`, `where.exe` for PATH probing, MCP servers, skill runners, the
UI server used by the bridge. On Windows, every `std::process::Command`
that wraps a console executable pops a visible `conhost.exe` window
unless the creator opts out with the `CREATE_NO_WINDOW` flag
(`0x0800_0000`). Early versions of TracePilot flickered console
windows on every bridge probe — user-visible and annoying.

Related concerns that tended to be handled inconsistently per call
site:

- Wall-clock **timeouts** on captured children (a stuck `git`
  subprocess must not hang the orchestrator).
- **Bounded concurrency** for per-repo probes so the OS isn't flooded
  with hundreds of simultaneous `git` invocations on a cold start.
- Encoding — Windows console CP-437/CP-1252 vs UTF-8 stdout.

## Decision

All child processes go through the helpers in
`crates/tracepilot-orchestrator/src/process/`. Direct use of
`tokio::process::Command::new` or `std::process::Command::new` in
orchestrator / bindings code is disallowed by convention (and is
easy to grep for in review).

1. **`hidden_command(program: &str) -> tokio::process::Command`**
   (`process/hidden.rs`) is the canonical async constructor. On
   Windows it applies `.creation_flags(CREATE_NO_WINDOW)`
   (constant defined in `tracepilot_core::constants`). On other
   platforms it is a pass-through.
2. **`hidden_std_command`** is the synchronous (`std::process`)
   counterpart for rare sync code paths (e.g. `where.exe` probing).
3. **`run_with_timeout`** / **`execute_with_timeout`** / **
   `run_hidden_stdout_timeout`** (`process/timeout.rs`) wrap captured
   children with a wall-clock deadline and graceful kill-on-timeout.
   Any process whose output we consume must go through one of these.
4. **`run_async_with_limits`** (`process/timeout.rs`) adds a
   semaphore-bounded concurrency gate on top of the timeout helpers.
   Bridge discovery, MCP probes, and multi-repo fan-outs use this so
   the total number of concurrent children stays below a configured
   ceiling regardless of how many callers fire.
5. **Encoding normalisation** lives in `process/encoding.rs` so that
   Windows-encoded stdout is decoded once, near the process boundary.
6. Tests live in `process/tests.rs` and `process/tests_async_limits.rs`
   and assert both the hidden-window behaviour (where the OS exposes
   it) and the semaphore bound.

## Consequences

- **Positive**: Zero visible console flashes on Windows — the single
  seam at `hidden_command` makes regressions easy to spot in review.
- **Positive**: Every captured child has a timeout by construction;
  nobody has to remember to add one.
- **Positive**: Concurrency caps are enforced centrally. A new caller
  can't accidentally spawn 500 git processes.
- **Negative**: The helper set is large enough that newcomers need to
  learn which to pick. Mitigated by the module-level docs at the top
  of `process/mod.rs` that enumerate when to use each helper.
- **Negative**: Process helpers live in `tracepilot-orchestrator`, so
  crates that don't depend on the orchestrator cannot use them. In
  practice only the orchestrator and bindings spawn children, so this
  hasn't been a constraint.

## Alternatives considered

- **Per-call `#[cfg(windows)]` blocks at every spawn site.** Rejected
  — we tried this early on; drift was immediate and a new `cargo run
  -p tracepilot-indexer` would flash a console window until someone
  noticed in QA.
- **A cross-crate trait in `tracepilot-core`**. Rejected — process
  spawning always pulls in `tokio::process` and orchestrator-specific
  timeout policy; pulling it into `core` would pollute a crate we
  deliberately keep framework-light.
- **Rely on Tauri's sidecar API**. Rejected — Tauri sidecars are for
  bundled binaries shipped with the app, not the ad-hoc `git` /
  `where.exe` / user-installed-CLI invocations that dominate our
  traffic.

## References

- `crates/tracepilot-orchestrator/src/process/hidden.rs` —
  `hidden_command`, `hidden_std_command`, `where_exe` wrapper.
- `crates/tracepilot-orchestrator/src/process/timeout.rs` —
  `spawn_captured_child`, `execute_with_timeout`, `run_with_timeout`,
  `run_async_with_limits`.
- `crates/tracepilot-orchestrator/src/process/mod.rs` — module docs +
  public re-exports.
- `crates/tracepilot-orchestrator/src/process/encoding.rs` — stdout
  decoding.
- `crates/tracepilot-orchestrator/src/bridge/discovery.rs` — canonical
  caller using `hidden_command`.
- `crates/tracepilot-core/src/constants.rs` — `CREATE_NO_WINDOW`
  constant.
