# ADR-0009 — Copilot bridge lifecycle

- **Date:** 2026-04-19
- **Status:** Accepted

## Context

The **Copilot bridge** is TracePilot's in-process owner of the Copilot
SDK client — a Rust dependency that itself either spawns a private
`copilot` CLI subprocess (stdio mode) or attaches over TCP to an
already-running `copilot --ui-server` (TCP mode). Everything the
desktop app does with Copilot — starting a conversation, resuming a
session, streaming events into the UI, steering a session with a mode
change or an abort — goes through the one `BridgeManager` held behind a
`tokio::sync::RwLock` (`SharedBridgeManager`).

The bridge sits at a choke point between three independent lifetimes:

1. **A subprocess** (stdio) or **a TCP endpoint** (`--ui-server`)
   managed by the SDK crate.
2. **An IPC surface** exposed via Tauri commands, with two broadcast
   channels fanning out `BridgeEvent` and `BridgeStatus` updates to any
   number of frontend listeners.
3. **A session cache** — an in-memory map of `session_id → Arc<Session>`
   plus a parallel map of event-forwarder `JoinHandle`s — that
   represents every Copilot session the current bridge instance is
   actively steering.

These three lifetimes don't line up neatly: a user can toggle the SDK
preference while sessions are mid-turn, a frontend subscriber can lag
behind a burst of events, a TCP `--ui-server` can disappear out from
under us, and the SDK subprocess can crash. ADR-0009 documents the
state machine and guard rails that keep all of this predictable.

## Decision

1. **One manager, one state machine.** `BridgeManager` (in
   `crates/tracepilot-orchestrator/src/bridge/manager/mod.rs`) is the
   sole owner of the `copilot_sdk::Client`, the session map, the
   event-forwarder `JoinHandle`s, and the two broadcast `Sender`s. The
   public API is flat but source-split for readability — `lifecycle.rs`
   (connect / disconnect), `session_tasks.rs` (create / resume /
   destroy / steering + the event forwarder), `queries.rs`,
   `raw_rpc.rs`, `ui_server.rs`, `session_model.rs`. Every submodule
   contributes an `impl BridgeManager` block.

2. **Connection state machine.** `BridgeConnectionState` has four
   states: `Disconnected` (default), `Connecting`, `Connected`,
   `Error`. Transitions:
   - `Disconnected → Connecting → Connected` on successful
     `connect()` (stdio or TCP, chosen by whether `cli_url` is set).
   - `* → Error` with `error_message` populated on any failure during
     build / start.
   - `Connected → Disconnected` on `disconnect()`, which aborts all
     event-forwarder tasks, clears the session map, and calls
     `client.stop()` (errors are logged, not propagated — disconnect
     is always best-effort).
   - `connect()` called while already `Connected` auto-calls
     `disconnect()` first (idempotent reconnect).
   Every transition ends with `emit_status_change()`, publishing a
   `BridgeStatus` snapshot onto the `status_tx` broadcast channel.

3. **`DisabledByPreference` runtime guard (SDK-03, ADR-0007).** Bridge
   **start paths** (`connect`, `create_session`, and the fresh —
   non-cached — branch of `resume_session`) call
   `check_preference_enabled()` before doing any SDK work. When the
   `FeaturesConfig.copilot_sdk` pref is off (read through the
   `CopilotSdkEnabledReader` closure wired in at plugin setup), those
   methods return `BridgeError::DisabledByPreference`. Steering calls
   on **already-tracked** sessions (`send_message`, `abort_session`,
   `set_session_mode`, `set_session_model`, `destroy_session`,
   `unlink_session`, the read-only `queries`) are **deliberately
   ungated** — a user who flips the pref off mid-flight does not lose
   in-progress work. See ADR-0007 for the full rationale.

4. **Session cache semantics.** `resume_session` checks the local
   session map **before** the preference guard and returns a cached
   `BridgeSessionInfo` if the session is already tracked. This lets
   session-steering remain live even after a pref-off. On a fresh
   resume, the SDK's subprocess-level schema validation may reject a
   session whose `events.jsonl` was written by a different CLI version
   — the manager logs this as a recognisable warning (the CLI's
   "corrupted at line N" message) and returns it as a `Sdk` error so
   the frontend can display it faithfully without confusing the user
   into thinking their session is actually corrupted. `destroy_session`
   removes the entry, aborts the forwarder task, and calls
   `session.destroy()` (writes a `session.shutdown` event to
   `events.jsonl`). `unlink_session` is the same minus the destroy —
   used when we need to detach without touching on-disk state, e.g.
   to avoid re-triggering schema validation on re-link.

5. **Broadcast channels, metrics, and lag.** `event_tx` is sized 512,
   `status_tx` 256 (both sized during Phase 1A.6 of the wider
   tech-debt plan; earlier sizes of 16 caused `RecvError::Lagged`
   under reconnect storms). The per-session event forwarder
   (`spawn_event_forwarder`) subscribes to the SDK session's event
   stream and pushes `BridgeEvent`s onto `event_tx`. It handles three
   recv outcomes: `Ok` → forward + bump `events_forwarded`, `Closed` →
   exit loop, `Lagged(n)` → log, bump `events_dropped_due_to_lag += n`
   and `lag_occurrences += 1`, keep looping. The atomics are exposed
   as a lock-free snapshot via `BridgeManager::metrics_snapshot` /
   `BridgeMetricsSnapshot`, surfaced on the IPC as
   `sdk_bridge_metrics` for debug UI.

6. **Discovery is separate and best-effort.**
   `bridge::discovery::detect_ui_servers` probes the host for running
   `copilot --ui-server` instances by platform-specific process
   inspection. Every probe runs hidden (`CREATE_NO_WINDOW` via
   `run_async_with_limits`, per ADR-0004), is bounded by a 5 s wall
   clock, and caps captured output at 1 MiB per stream. Failures
   degrade to an empty list — discovery can never hang connect.

7. **Wire format is frozen.** `BridgeStatus` retains `sdkAvailable` as
   an always-`true` field (ADR-0007) and carries
   `enabledByPreference` so the frontend sees authoritative pref state
   instead of re-reading the preference independently. `ConnectionMode`
   serialises to bare `"stdio"` / `"tcp"` strings, unchanged from the
   pre-enum representation. `BridgeError::NotAvailable` is retained
   but unreachable in production.

## Consequences

**Good.**

- Session steering survives `copilotSdk` preference churn. The start-vs-
  steer split is encoded in code, not in hope.
- Any subscriber churn — a view unmounts mid-stream, a debug panel
  re-subscribes — is cheap (`broadcast::Receiver` clone) and never
  blocks the forwarder.
- Lag is visible to operators: a user reporting "events stop rendering"
  can be correlated against `lag_occurrences` from the metrics snapshot
  without attaching a profiler.
- Disconnect is always safe — best-effort semantics mean a dying SDK
  can't wedge TracePilot's shutdown path.

**Trade-offs.**

- The manager is behind a single `RwLock`. Steering calls that don't
  mutate state still take the read lock while acquiring a reference to
  the session `Arc`. Today this is fine (session ops are short and
  rare compared to the event forwarder's lock-free broadcast hot
  path); future scale may motivate finer-grained locking.
- Broadcast sizing is a global knob. A pathological subscriber still
  drops events rather than blocking producers — by design, but means
  we rely on the lag metrics to catch the tail.
- Schema-mismatch errors on cross-version resume surface as
  `BridgeError::Sdk("Session file is corrupted at line N")`. The
  wording comes from the SDK and is preserved verbatim so users
  searching for it find the known issue; that also means the frontend
  has to special-case the string match for presentation.

## Alternatives considered

1. **Per-session actors / mailboxes instead of `HashMap<SessionId,
   Arc<Session>>` + broadcast channel.** Rejected: adds a mailbox per
   session and re-implements back-pressure the `broadcast` channel
   already expresses. Current design is simpler and the hot path is
   just `sender.send(event)`.
2. **Store bridge state in Tauri's typemap directly.** Rejected:
   couples the orchestrator to Tauri and breaks unit tests that
   construct a `BridgeManager` in plain tokio. The
   `CopilotSdkEnabledReader` closure is the only seam that needs
   injecting; everything else stays in the orchestrator crate.
3. **Restart crashed SDK subprocesses automatically.** Rejected for
   wave 1 — an auto-restart policy can mask real CLI bugs and writes
   extra `session.shutdown` events that confuse session history.
   Manual reconnect keeps the signal clean; revisit once we have
   failure-rate data.
4. **Eagerly close sessions on `copilotSdk` pref-off.** Rejected: the
   whole point of the start-vs-steer split is that flipping the
   preference does not destroy in-flight work. See ADR-0007.

## References

- `crates/tracepilot-orchestrator/src/bridge/mod.rs` — error /
  status / config DTOs; connection mode.
- `crates/tracepilot-orchestrator/src/bridge/manager/mod.rs` — struct
  definition, metrics, preference reader, status snapshot.
- `crates/tracepilot-orchestrator/src/bridge/manager/lifecycle.rs` —
  connect / disconnect state transitions.
- `crates/tracepilot-orchestrator/src/bridge/manager/session_tasks.rs`
  — create / resume / destroy / steering + `spawn_event_forwarder`.
- `crates/tracepilot-orchestrator/src/bridge/discovery.rs` —
  `--ui-server` auto-detection.
- ADR-0004 — background-process discipline (`hidden_command`).
- ADR-0007 — Copilot SDK always compiled in, gated at runtime
  (`DisabledByPreference`, `CopilotSdkEnabledReader`).
