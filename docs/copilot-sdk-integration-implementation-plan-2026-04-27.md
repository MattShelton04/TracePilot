# Copilot SDK integration implementation plan

> Date: 2026-04-27
>
> Source audit: [copilot-sdk-integration-audit-2026-04-27.md](copilot-sdk-integration-audit-2026-04-27.md)

## Goal

Make TracePilot's Copilot SDK integration reliable across reloads, explicit about process/session ownership, safe for multiple concurrent steered sessions, capable of realtime streaming and actionable input alerts, and integrated with the session launcher for SDK-backed headless sessions.

## Non-goals for the first implementation pass

- Multi-user collaboration or distributed locking. TracePilot is a single-user desktop app.
- Supporting multiple active bridge clients/connections at the same time. The first pass should keep one active bridge client connected by either stdio or TCP, and make that limitation explicit.
- Replacing historical JSONL parsing. SDK events are for live orchestration; JSONL remains the durable audit source.
- Removing the raw JSON-RPC model workaround before the upstream Rust SDK is fixed.

This non-goal is **not** a limit on sessions. Supporting multiple concurrent SDK-tracked sessions on the one active bridge is a core goal. The design must allow many sessions to be created, resumed, streamed, alerted on, and steered independently, with per-session state and tests. The stdio/TCP difference is only about the bridge transport and process ownership:

- **Stdio:** TracePilot's bridge owns one private SDK/CLI process, and that process may own many SDK-created/resumed sessions.
- **TCP / `--ui-server`:** TracePilot's bridge connects to one external UI-server at a time, and that server may expose/own many sessions, including a foreground TUI session.
- **Out of scope for this pass:** running two bridge clients simultaneously, such as one stdio client plus one TCP client, or two TCP UI-server connections at the same time.

## Phase 0: safety spikes and contracts

### Tasks

1. Document the SDK lifecycle contract in code comments and a small ADR:
   - renderer reload must not imply SDK disconnect,
   - explicit disconnect must stop the client and clear tracked runtime handles,
   - app process restart uses persisted registry plus best-effort resume.
2. Add non-mutating tests around current bridge behavior:
   - `connect()` while already connected currently disconnects first,
   - `disconnect()` clears sessions/event tasks,
   - `list_sessions()` marks only locally tracked sessions as active.
3. Add mock/spike tests for event reducer inputs using captured/synthetic SDK events:
   - `assistant.message_delta`,
   - `assistant.reasoning_delta`,
   - `assistant.usage`,
   - `session.idle`,
   - `permission.requested`,
   - `external_tool.requested`.
4. Run an intentional manual SDK spike in a scratch repo:
   - create session,
   - stream a harmless prompt,
   - trigger/observe user input if possible,
   - record exact event order in an internal fixture.

### Deliverables

- A short ADR or design note for lifecycle semantics.
- Test fixtures for live SDK event shapes.
- Confirmed event order notes for streaming and idle/error boundaries.

### Done statements

- Engineers can state precisely what happens on renderer reload, explicit disconnect, app close, app crash, stdio mode, and TCP mode.
- No implementation phase depends on guessed event shapes.

## Phase 1: backend lifecycle and hydration

### Tasks

1. Make `BridgeManager::connect()` idempotent:
   - if already connected with the same mode/config, return `Ok(())` and emit/current status without clearing sessions,
   - if a different mode/config is requested, require explicit `disconnect()` or add an explicit `reconnect()` command.
2. Remove or replace frontend `beforeunload` SDK disconnect:
   - do not call `sdkDisconnect()` for normal renderer refresh,
   - if needed, only disconnect on explicit user action or Tauri app shutdown where the user expects the SDK to stop.
3. Add hydration IPC:
   - `sdk_hydrate()` returns `BridgeStatus`, tracked session handles, connection mode/url, metrics, and live session states,
   - `sdk_list_tracked_sessions()` can be a smaller command if preferred.
4. Update frontend startup:
   - call `sdk_hydrate()` before `autoConnect()`,
   - if backend is already connected, apply status and sessions without reconnecting,
   - only call `connect()` when backend is disconnected and the feature is enabled.
5. Add tests:
   - renderer-reload simulation preserves tracked sessions,
   - autoConnect does not clear backend sessions when already connected,
   - explicit disconnect still clears runtime state.

### Deliverables

- Idempotent bridge connection behavior.
- Refresh-safe frontend SDK store hydration.
- Regression tests for reload semantics.

### Done statements

- Pressing Ctrl+R in the desktop webview does not disconnect the SDK bridge or clear tracked sessions.
- The frontend can recover the list of sessions already tracked in the backend after reload.
- Explicit disconnect still stops/clears the bridge.

## Phase 2: persisted SDK session registry

### Tasks

1. Add a persistent registry type:
   - `session_id`,
   - `origin`,
   - `connection_mode`,
   - `cli_url`,
   - `working_directory`,
   - `model`,
   - `reasoning_effort`,
   - `agent`,
   - `desired_state`,
   - `runtime_state`,
   - `linked_at`,
   - `last_seen_at`,
   - `last_event_id`,
   - `last_error`.
2. Choose storage:
   - use SQLite via `rusqlite`, which is already an unconditional dependency of `tracepilot-orchestrator`,
   - avoid a JSON-first registry unless SQLite is blocked by a concrete packaging/runtime issue.
3. Write registry updates from backend operations:
   - create,
   - resume/link,
   - unlink,
   - destroy,
   - disconnect,
   - event-driven state changes.
4. Add recovery flow:
   - on startup/hydrate, load registry,
   - mark unknown stale sessions as `unknown`,
   - auto-resume only sessions with `desired_state = tracked` and safe origin (`launcher-sdk` or explicit user opt-in),
   - present manual recovery for ambiguous/manual-linked sessions.
5. Add registry maintenance:
   - prune destroyed/stale records,
   - expose "forget session" action,
   - never store secrets.

### Deliverables

- Durable SDK session registry.
- Recovery UI/state for restart after crash/app close.
- Tests for registry writes and recovery decisions.

### Done statements

- A TracePilot-launched SDK session can be rediscovered after app restart.
- A manually linked session is not silently resumed after restart unless the policy says it should be.
- The registry makes no secret-bearing writes.

## Phase 3: live SDK session state reducer

### Tasks

1. Add backend reducer state keyed by `session_id`:
   - status,
   - current turn ID,
   - streaming assistant text,
   - reasoning text,
   - tool executions/progress,
   - usage/quota snapshot,
   - pending permission request,
   - pending user-input request,
   - last event ID/timestamp,
   - error/shutdown details.
2. Implement the reducer as a backend-owned subscriber to the bridge event broadcast:
   - create an internal reducer receiver during bridge/plugin setup,
   - update `Arc<RwLock<SdkLiveStateStore>>` from that receiver,
   - record reducer subscriber lag separately,
   - keep this receiver alive so session forwarders do not stop solely because the frontend/Tauri event subscriber was dropped.
3. Emit compact `sdk-session-state-changed` events after reducer updates.
4. Add IPC:
   - `sdk_get_session_state(session_id)`,
   - `sdk_list_session_states()`.
5. Keep raw `SDK_BRIDGE_EVENT` for debugging.
6. Update frontend store:
   - store `sessionStatesById`,
   - replace ad-hoc `recentEvents` dependency for feature logic,
   - retain `recentEvents` as debug buffer.
7. Add fixtures/tests for reducer transitions:
   - start -> turn_start -> delta -> usage -> idle,
   - tool progress/partial/complete,
   - permission requested/resolved,
   - user input requested/resolved,
   - error/shutdown.

### Deliverables

- Live state reducer in Rust.
- Frontend session-state store keyed by session ID.
- Tests for all core event transitions.

### Done statements

- UI can render live assistant streaming without waiting for JSONL refresh.
- UI can tell whether a session is idle, running a tool, waiting for input, errored, or shut down from SDK state.
- Raw event forwarding remains available for debug.

## Phase 4: realtime streaming UI

### Tasks

1. Add live response display in the conversation/steering area:
   - stream `assistant.message_delta`,
   - stream `assistant.reasoning_delta` or summaries where available,
   - show tool progress and partial output.
2. Reconcile live state with JSONL detail refresh:
   - overlay live in-progress turn,
   - remove/replace overlay once persisted JSONL/indexed detail catches up,
   - use `last_event_id` or turn ID to avoid duplicates.
3. Surface usage/quota live:
   - show `assistant.usage` increments,
   - update quota panel after usage events.
4. Add degraded-state UI:
   - event lag/drops warning,
   - stale reducer warning,
   - reconnect required banner.

### Deliverables

- Live streaming conversation UI for SDK-linked sessions.
- Reconciliation logic between SDK live state and durable JSONL detail.
- Metrics/degraded stream indicators.

### Done statements

- Sending through the SDK shows response text streaming in TracePilot before the JSONL refresh completes.
- When persisted session data catches up, the UI does not duplicate the live turn.
- Event lag is visible to the user when it affects a linked session.

## Phase 5: actionable SDK alerts

### Tasks

1. Add new alert types:
   - `sdk-user-input-required`,
   - `sdk-permission-required`,
   - `sdk-session-error`,
   - `sdk-session-idle`,
   - `sdk-bridge-degraded`,
   - `sdk-event-lag`.
2. Add alert scope:
   - `sdk-steered`,
   - `monitored` / open sessions (tabs, popups, and current route; this is the current `monitored` behavior),
   - `all running`,
   - with `sdk-steered` or `monitored` as the safer default.
3. Register SDK user-input handlers for SDK-created/resumed sessions:
   - store pending request in backend reducer/registry,
   - emit state change + alert,
   - wait for frontend response/cancel/timeout,
   - return `UserInputResponse`.
4. Handle `permission.requested`:
   - expose pending permission requests,
   - offer approve/deny UI consistent with CLI semantics,
   - time out explicitly rather than hanging silently.
5. Update Alert Center:
   - alerts deep-link to the exact session and pending request,
   - native notification actions include alert/session identity where supported,
   - add "mute session" and burst caps for `all running`.
6. Keep legacy polling:
   - retain JSONL `ask_user` polling only for non-SDK sessions or compatibility,
   - label it as delayed/historical.

### Deliverables

- SDK-scoped alerts and pending-action UI.
- User input response path through SDK handler.
- Permission request alert/action path.
- Safer scope/burst behavior.

### Done statements

- When an SDK-steered session asks for input, TracePilot alerts immediately and provides a place to answer.
- Alerts for SDK sessions are not dependent on 10-second JSONL polling.
- A large set of unrelated running sessions cannot spam the user by default.

## Phase 6: concurrent session support

### Tasks

1. Replace global frontend send state:
   - `sendingMessage` -> `sendingBySessionId`,
   - `lastError` -> session-scoped errors where useful,
   - abort controls keyed by session ID/current turn.
2. Add backend concurrency tests:
   - multiple sessions created/resumed,
   - simultaneous sends to different sessions,
   - destroy/unlink while other sessions stream,
   - event burst with per-session metrics.
3. Add frontend tests:
   - sending in one tab does not disable another tab,
   - two linked sessions maintain separate drafts/sent logs,
   - same session in two views shows consistent linked state.
4. Add soft steering ownership:
   - show which session is linked,
   - warn when the same session is being steered from multiple windows/tabs,
   - do not implement heavy locking unless a real conflict appears.

### Deliverables

- Per-session steering state.
- Multi-session backend/frontend tests.
- Clear UX for same-session multi-view steering.

### Done statements

- Two SDK-linked sessions can be messaged independently from different tabs without UI cross-blocking.
- Destroying/unlinking one session does not disrupt another session's live state.

## Phase 7: popout and multi-window integration

### Tasks

1. Decide popout steering model:
   - recommended: popouts do not create SDK connections; they call backend/main-owned store through IPC and receive state events.
2. Add steering UI to popout session views, or add explicit "Open in main to steer" affordance if steering remains main-only.
3. Sync session drafts/linked state across main and viewer windows using backend/store state.
4. Ensure alert scope includes viewer windows without duplicating alert watchers.
5. Add tests/manual checks for:
   - main tab + popout for same session,
   - two popouts for different SDK sessions,
   - popout close cleanup.

### Deliverables

- Popout-compatible SDK steering or an explicit limitation.
- Cross-window linked-state consistency.

### Done statements

- Opening a session in a popout does not create a competing bridge lifecycle.
- The user can understand and control whether a popout can steer the session.

## Phase 8: SDK-backed headless launcher

### Tasks

1. Split launcher execution modes:
   - terminal CLI launch,
   - SDK headless launch.
2. Reuse existing validation/worktree/env/model/reasoning prompt logic.
3. Implement backend `sdk_launch_session(config)` or extend `launch_session` with explicit dispatch:
   - create the session with per-session `working_directory` from the launcher config,
   - only connect the bridge if it is disconnected,
   - do not reconnect or pass a new client-level `cwd` solely because the launcher config specifies a different repository directory,
   - create SDK session with cwd/model/reasoning/agent/system message,
   - send initial prompt if provided,
   - register input/permission handlers,
   - persist registry with `origin = launcher-sdk`,
   - return `LaunchedSession` with `session_id` and no misleading terminal PID.
4. Update types:
   - add `sessionId?: string`,
   - add `launchMode: "terminal" | "sdk"`,
   - make PID optional or mode-specific.
5. Extend reasoning-effort support:
   - update TypeScript launcher state from `"low" | "medium" | "high"` to include `"xhigh"`,
   - add `xhigh` to launcher UI where the installed CLI supports it,
   - keep backend validation permissive enough for SDK/CLI additions while still preventing injection.
6. Enable UI:
   - Headless toggle,
   - Launch Headless button,
   - post-launch navigation to live session view.
7. Keep CLI `-p/--prompt` as a separate terminal/script option if needed, but do not use it as the primary integrated headless path.

### Deliverables

- SDK-backed headless launch path.
- Updated launcher UI and types.
- Registry/live-state integration for launched sessions.

### Done statements

- The launcher can start a Copilot session without opening a terminal.
- The launched session appears immediately in TracePilot with live streaming, alerts, and steering.
- Terminal launch remains available and unchanged for users who want a visible CLI.

## Phase 9: TCP/UI-server robustness

### Tasks

1. Add UI-server registry state:
   - detected servers,
   - launched-by-TracePilot servers,
   - active target,
   - readiness status,
   - last error/probe time.
2. After `sdk_launch_ui_server`, poll detection/status until ready or timeout.
3. Let the user choose among multiple detected servers.
4. Add health checks for active TCP target.
5. Gate hidden/preview CLI flags:
   - prefer a readiness/connection attempt with classified errors over parsing `copilot --help`,
   - use `copilot --version` only as a diagnostic or known-minimum-version hint unless an upstream compatibility table exists,
   - show version-sensitive warning if `--ui-server` is unavailable or hidden.
6. Keep single active bridge connection in this phase, but make reconnecting explicit and non-destructive unless confirmed.

### Deliverables

- Robust UI-server detect/launch/connect flow.
- Clear UI for multiple servers and active target.
- TCP health state.

### Done statements

- Launching a UI server from TracePilot either connects when ready or reports a clear timeout/failure.
- Connecting to one server does not accidentally discard sessions without explicit confirmation.

## Phase 10: event coverage, diagnostics, and upstream cleanup

### Tasks

1. Add typed coverage for live SDK events in TracePilot core where they should be durable:
   - `assistant.message_delta`,
   - `assistant.reasoning_delta`,
   - `assistant.usage`,
   - `session.idle`,
   - `pending_messages.modified`,
   - `tool.execution_partial_result`,
   - `tool.execution_progress`,
   - `permission.requested`,
   - `external_tool.requested`.
2. Add diagnostics comparing known parser events against pinned SDK parser events.
3. Add UI/debug panel:
   - raw recent SDK events,
   - per-session metrics,
   - lag/dropped counters,
   - reducer state.
4. Add per-session metrics in backend:
   - events forwarded,
   - lag occurrences,
   - events dropped,
   - last event timestamp,
   - reducer errors.
5. Contribute upstream Rust SDK fixes for snake_case model method names:
   - `session.model.getCurrent`,
   - `session.model.switchTo`,
   - verify agent/workspace camelCase methods.
6. Keep TracePilot's raw RPC workaround as the TCP-mode solution until a fixed SDK revision is pinned and tests prove it is unnecessary.

### Deliverables

- Event coverage tests.
- Diagnostics/debug UI.
- Cleaner SDK method compatibility story.

### Done statements

- New SDK/CLI event types are easy to detect in tests and diagnostics.
- Event drops/lag can be attributed to a session.
- The raw RPC workaround is documented, tested, and eventually removable.

## Suggested implementation order

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 5
6. Phase 4
7. Phase 6
8. Phase 8
9. Phase 7
10. Phase 9
11. Phase 10

This order prioritizes correctness and recoverability first. Realtime UI and headless launch become much easier once lifecycle, registry, and live session state exist.

Phase 5 depends on Phase 3's `sdk-session-state-changed` events and reducer state being available. It is intentionally before the full realtime conversation UI because actionable alerts can be built on compact state changes without first completing every streaming display surface.

## Cross-cutting test matrix

| Scenario | Expected result |
|---|---|
| Main webview Ctrl+R during linked stdio session | Backend remains connected; tracked session survives; frontend rehydrates. |
| Explicit SDK disconnect | Client stops; sessions/event tasks clear; registry marks runtime stopped without deleting history. |
| App restart after SDK-launched session | Registry loads; session is recoverable or clearly marked stale. |
| Two linked sessions send concurrently | Sends are independent; per-session state updates; no global UI lock. |
| `assistant.message_delta` stream | Live UI updates incrementally; JSONL refresh reconciles without duplicate. |
| `ask_user`/user input request | Immediate alert; user can answer in TracePilot; SDK receives response. |
| `permission.requested` | Alert/action appears; approve/deny propagates; timeout is explicit. |
| TCP UI server launched from TracePilot | Readiness is detected; connection succeeds or clear timeout appears. |
| Event broadcast lag | Metrics increment; session/debug UI shows degraded stream. |
| Popout for SDK-linked session | No duplicate bridge owner; state remains consistent with main window. |

