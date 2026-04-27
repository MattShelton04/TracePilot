# Copilot SDK integration audit

> Date: 2026-04-27
>
> Scope: TracePilot desktop, Tauri bindings, Rust orchestrator bridge, session launcher, SDK steering UI, popout windows, and alerts.
>
> Companion plan: [copilot-sdk-integration-implementation-plan-2026-04-27.md](copilot-sdk-integration-implementation-plan-2026-04-27.md)

## Executive summary

TracePilot already has a useful Copilot SDK bridge: a single Rust `BridgeManager` owns a `copilot_sdk::Client`, can connect by stdio or TCP, can create/resume/steer/destroy sessions, forwards raw SDK events to Tauri, and exposes status, auth, quota, model, foreground-session, UI-server discovery, and broadcast metrics IPC.

The main shortcomings are lifecycle ownership and productization:

1. The SDK connection and linked session handles are in memory only. They are not persisted to disk, and the frontend currently calls `sdkDisconnect()` during `beforeunload`, so a hard webview refresh can tear down the stdio process and clear linked sessions instead of rehydrating them.
2. Multiple concurrent sessions are structurally possible in the backend, but there is no explicit concurrency contract, no multi-session stress testing, and the frontend steering UI still has global state such as one `sendingMessage` flag for all sessions.
3. SDK events are forwarded as raw events, but almost none of them are promoted into durable state or live UI. Realtime streaming is technically available through `assistant.message_delta` and `assistant.reasoning_delta`, but TracePilot still mostly waits for JSONL refreshes.
4. Stdio and TCP modes both exist, and `--ui-server` can be launched/detected, but TracePilot has one active bridge connection at a time, no durable process registry, no health monitor, and no auto-connect handshake after launching a UI server. This does not preclude multiple concurrent sessions; it means those sessions share the one active bridge transport.
5. The session launcher has a `headless` field, preview state, and disabled UI, but the Rust launcher ignores `headless`; it still always launches a terminal CLI session. The SDK bridge is not yet integrated into launcher/headless mode.
6. Alerts are currently based on session-list and JSONL turn polling, not SDK live state. They are not scoped to SDK-steered sessions, do not use the SDK user-input handler, and cannot distinguish "agent is waiting for TracePilot input" from historical `ask_user` artifacts.

The recommended direction is to make the Rust/Tauri backend the durable owner of SDK state for this single-user app: persist a lightweight SDK session registry, stop disconnecting on renderer reload, make connect idempotent, rehydrate linked sessions after refresh/restart, promote selected SDK events into live session state, and rebuild alerts around SDK-scoped live events.

## Empirical validation performed

This audit combines static code review with local validation:

- `cargo test -p tracepilot-orchestrator bridge::manager --quiet` passed: 21 tests.
- Local Copilot CLI is `GitHub Copilot CLI 1.0.36`.
- `copilot --help` advertises `--reasoning-effort` choices `low`, `medium`, `high`, and `xhigh`, plus `-p/--prompt` non-interactive mode and `-i/--interactive`. The current launcher UI only offers `low|medium|high`.
- The local `copilot-sdk` dependency is pinned to git rev `2946ba1` in `Cargo.lock`.
- The local Rust SDK source includes examples for `streaming.rs` and `user_input.rs`, confirming support for streaming deltas and `register_user_input_handler`.

I did not run a live prompt-producing SDK E2E against a real session from this audit, because that can consume quota, mutate repositories, and interact with user auth. The plan below includes safe spike tasks that should be run intentionally.

## Current architecture

### Rust/Tauri backend

`crates/tracepilot-tauri-bindings/src/lib.rs` creates a single `BridgeManager` during plugin setup and stores it as Tauri state:

- `BridgeManager::new()` creates a manager plus event/status broadcast receivers.
- A runtime preference reader gates SDK start paths through `FeaturesConfig.copilot_sdk`.
- Two background tasks forward bridge events and status changes to Tauri IPC events.
- The shared manager is `Arc<RwLock<BridgeManager>>`.

`crates/tracepilot-orchestrator/src/bridge/manager/mod.rs` owns:

- `state: BridgeConnectionState`
- `connection_mode: Option<ConnectionMode>`
- `cli_url: Option<String>`
- `client: Option<copilot_sdk::Client>`
- `sessions: HashMap<String, Arc<copilot_sdk::Session>>`
- `event_tasks: HashMap<String, JoinHandle<()>>`
- global broadcast metrics

`lifecycle.rs` implements `connect()` and `disconnect()`:

- Stdio mode is selected when `BridgeConnectConfig.cli_url` is absent.
- TCP mode is selected when `cli_url` is present.
- If already connected, `connect()` first calls `disconnect()`, which drains event tasks, clears `sessions`, stops the SDK client, resets mode/url, and emits status.

`session_tasks.rs` implements the core steering surface:

- `create_session()`
- `resume_session()`
- `send_message()`
- `abort_session()`
- `unlink_session()`
- `destroy_session()`
- `set_session_mode()`
- per-session event forwarders from SDK event subscriptions to TracePilot bridge events

`session_model.rs` has an important raw JSON-RPC workaround for TCP mode because the pinned community Rust SDK uses snake_case method names for model APIs. TCP mode bypasses the SDK with `session.model.switchTo`; stdio mode still uses the SDK method.

`queries.rs` provides session/model/auth/quota/status queries. `list_sessions()` asks the SDK/client for sessions and marks `is_active` by checking the local `sessions` map.

`ui_server.rs` can launch a visible `copilot --ui-server` terminal and can get/set foreground session through the SDK client. `discovery.rs` detects running UI-server processes by platform-specific process/port inspection.

### Frontend SDK store and steering UI

`apps/desktop/src/stores/sdk.ts` is the Pinia shell for SDK state. It composes:

- `stores/sdk/connection.ts`: connection lifecycle, settings hydration, auth/quota/models/sessions, UI-server discovery/launch.
- `stores/sdk/messaging.ts`: create/resume/send/abort/destroy/unlink/mode/model/foreground-session actions.
- `stores/sdk/settings.ts`: persisted `cliUrl` and `logLevel`.

The store listens for:

- `SDK_BRIDGE_EVENT`: appends raw `BridgeEvent` to `recentEvents`, trimmed to `MAX_SDK_EVENTS`.
- `SDK_CONNECTION_CHANGED`: applies backend status.

The main window auto-connects when the `copilotSdk` feature is enabled. Only the main window owns the connection lifecycle (`useWindowRole().isMain()`).

`useSdkSteering.ts` and `SdkSteeringPanel.vue` implement the visible steering bar:

- Linking is explicit and calls `sdk.resumeSession()`.
- Sending calls `sdk.sendMessage()`.
- Mode changes call `sdk.setSessionMode()`.
- Abort calls `sdk.abortSession()`.
- Shutdown calls `sdk.destroySession()`.
- There is intentionally no auto-resume on view mount.

Popout viewer windows render `ChildApp.vue` and `SessionDetailTabView`. `ChatViewMode.vue` hides `SdkSteeringPanel` for viewer windows (`v-if="!isViewer()"`), so popouts currently observe sessions but cannot steer them.

### Alerts system

Alerts are implemented independently of the SDK bridge:

- `stores/alerts.ts` persists alert history in localStorage.
- `stores/alertWatcher.ts` owns dedup/baseline maps for running sessions, turn counts, `ask_user` calls, and error counts.
- `useAlertWatcher.ts` watches/polls session state:
  - session-end from running-state transitions,
  - `ask_user` from periodic `getSessionTurns()` polling,
  - session errors from `session.errorCount`,
  - scope from tabs, popups, current route, or all sessions.
- `useAlertDispatcher.ts` sends in-app toasts, native notifications, taskbar attention, and sounds with a per-session/type cooldown.

Alerts do not currently consume `SDK_BRIDGE_EVENT`, `permission.requested`, `external_tool.requested`, or SDK user-input callbacks.

### Session launcher

The launcher has a `LaunchConfig.headless` field in Rust and TypeScript. The frontend `useSessionLauncher()` carries `headless` through computed launch config and preview state, but the visible controls are disabled as "Coming Soon".

`crates/tracepilot-orchestrator/src/launcher.rs` ignores `config.headless` and always launches a terminal session using shell-specific quoting. Initial prompts are passed through `--interactive`, not the SDK.

## Lifecycle and persistence findings

### Finding 1: renderer refresh currently destroys SDK state

The Rust manager would normally survive a webview reload because it is Tauri plugin state in the Rust process. However, the frontend SDK store registers:

```ts
window.addEventListener("beforeunload", () => {
  if (isMain() && connection.connectionState.value === "connected") {
    sdkDisconnect().catch(() => {});
  }
});
```

That calls backend `sdk_disconnect`, which calls `BridgeManager::disconnect()`, aborts all event tasks, clears the session map, stops the SDK client, and resets connection mode.

This means Ctrl+R/F5/hard refresh is treated like an intentional SDK shutdown. For stdio mode, that can stop the private SDK/CLI process. For TCP mode, the external UI server remains, but TracePilot loses its local client/session handles.

Even if a reload happened without `beforeunload`, the frontend starts with local `connectionState = "disconnected"` and `autoConnect()` calls `sdk_connect`. Backend `connect()` currently disconnects first when it is already connected, which also clears local session handles. So the current startup path is not rehydrate-safe.

Impact:

- linked SDK sessions are lost across refresh,
- event subscriptions are lost,
- frontend `userLinked` and `resolvedSessionId` are local and lost,
- `list_sessions()` can rediscover session metadata, but active handles are no longer guaranteed,
- a create/resume operation that succeeds just before frontend state is lost can leave confusing state.

Recommendation:

- Remove refresh-driven disconnect. Treat renderer reload as a UI lifecycle event, not an SDK lifecycle event.
- Make backend `connect()` idempotent for the same mode/config. Require explicit `sdk_reconnect` or `sdk_disconnect` for destructive reconnects.
- Add a backend `sdk_hydrate` or `sdk_list_tracked_sessions` command that returns current connection status, tracked sessions, metrics, and live session state.
- Persist a lightweight session registry so restart/crash recovery does not depend only on in-memory maps.

### Finding 2: app/process restart has no SDK registry

The SDK manager stores session handles only in memory. The CLI writes sessions to `~/.copilot/session-state`, and TracePilot can parse those JSONL files for historical analytics, but TracePilot does not persist "these sessions are currently linked/steered by TracePilot".

Lost on app process exit:

- `copilot_sdk::Client`,
- active stdio process handle,
- `Arc<Session>` handles,
- event forwarder tasks,
- last linked model/mode/working directory,
- whether a session was TracePilot-launched, user-linked, TCP-attached, or intentionally unlinked.

Recommendation:

Persist an SDK session registry in SQLite. `rusqlite` is already an unconditional orchestrator dependency, and a durable registry is core state rather than a throwaway settings blob. Suggested fields:

| Field | Purpose |
|---|---|
| `session_id` | Primary key. |
| `origin` | `launcher-sdk`, `manual-link`, `ui-server-foreground`, `terminal-resume`. |
| `connection_mode` | `stdio` or `tcp`. |
| `cli_url` | TCP server address when relevant. |
| `working_directory` | For resume/create. |
| `model` / `reasoning_effort` / `agent` | Rehydration and UI display. |
| `linked_at` / `last_seen_at` | Staleness and recovery UX. |
| `desired_state` | `tracked`, `unlinked`, `destroyed`, `do_not_rehydrate`. |
| `runtime_state` | `connecting`, `active`, `idle`, `waiting_for_input`, `error`, `shutdown`, `unknown`. |
| `last_event_id` | Delta/replay boundary. |
| `last_error` | Operator-visible diagnostics. |

The registry should not store secrets or prompt contents beyond what the CLI already stores.

### Finding 3: stdio child process ownership is opaque

In stdio mode, TracePilot asks the SDK to spawn/manage a private Copilot CLI process. TracePilot does not retain the child PID, expose it, monitor it, or distinguish "session error" from "SDK process died".

The pinned community Rust SDK rev includes `auto_restart` support in its client builder, but TracePilot does not enable it, and automatic restart would need careful semantics because session handles and event subscriptions must be rebuilt and the exact behavior should be spike-tested before use.

Recommendation:

- Add a bridge health state: `healthy`, `degraded`, `process_lost`, `reconnecting`, `stopped`.
- Periodically call a cheap status/ping method while connected, or classify transport errors on steering calls into a clearer bridge health error.
- If restart is implemented, make it explicit and stateful: stop old client, reconnect, resume registry sessions, replay recent events from JSONL, and surface partial failures.
- Include event-pipeline health in the same model. Today a session event forwarder stops if `event_tx.send(...)` reports no broadcast receivers. That can happen if the Tauri bridge-event forwarding task exits or all subscribers are dropped; the SDK session handle can remain steerable while no events reach the frontend, and no current metric records this condition.

## Multi-session and multi-window findings

### Finding 4: backend can hold multiple sessions but the contract is untested

`BridgeManager.sessions` is a `HashMap<String, Arc<copilot_sdk::Session>>`; each resumed/created session gets its own event forwarder. Steering calls take `&self`, lookup a session handle, and call the SDK session method.

This supports multiple sessions structurally, but current tests are primarily single-session/unit-level. There are no stress tests for:

- creating/resuming multiple sessions,
- simultaneous sends to different sessions,
- destroying one session while another streams events,
- broadcast lag under multi-session bursts,
- reconnect/restart with more than one tracked session.

Recommendation:

- Define a backend contract: one bridge client can own N tracked sessions for a single connection mode. That bridge may be stdio, where TracePilot owns the private CLI process, or TCP, where TracePilot attaches to one external `--ui-server`; in both cases, sessions need independent runtime state, alerts, and steering controls.
- Add mockable tests around concurrent session operations.
- Track per-session state and metrics separately from global bridge metrics.

### Finding 5: frontend steering has global state and popouts cannot steer

Frontend gaps:

- `stores/sdk/messaging.ts` has a single `sendingMessage` boolean for all sessions. If two tabs are linked, one send disables all steering inputs and shows abort controls globally.
- `SdkSteeringPanel` exists in normal chat views but is hidden in viewer windows.
- `useSdkSteering()` stores `userLinked`, `resolvedSessionId`, prompt draft, and sent log locally per component instance; those are lost on tab remount, reload, and popout boundaries.
- There is no cross-window arbitration for the same session being steered in two places.

Recommendation:

- Replace global `sendingMessage` with a per-session map: `sendingBySessionId`, `lastSendBySessionId`, `abortableTurnBySessionId`.
- Move linked/draft/sent-log state into a store keyed by session ID, backed by the backend registry where relevant.
- Let popouts request steering through main/backend instead of owning their own SDK connection.
- Add a "session is being steered from another window/tab" affordance if necessary. The app is single-user, so this can be a soft lock rather than a hard multi-user coordination system.

## Event coverage and realtime findings

### What TracePilot forwards today

The backend forwards every SDK event it receives as:

```rust
BridgeEvent {
  session_id,
  event_type,
  timestamp,
  id,
  parent_id,
  ephemeral,
  data: serde_json::Value,
}
```

That is forward-compatible: unknown events are not dropped at the bridge boundary.

### What TracePilot productizes today

Very little live SDK event data is productized:

- `recentEvents` is a frontend-only ring buffer trimmed to `MAX_SDK_EVENTS`.
- `sessionEvents(sessionId)` filters that buffer but is not a full live transcript or durable stream.
- Conversation refresh after steering still calls `detail.refreshAll()` after delays and relies on JSONL/indexed session detail.
- Bridge metrics are exposed (`sdk_bridge_metrics`) but not shown in the UI.

### SDK event support observed in pinned Rust SDK

The local Rust SDK parses these event types, among others:

- lifecycle: `session.start`, `session.resume`, `session.error`, `session.idle`, `session.info`, `session.shutdown`
- session state: `session.model_change`, `session.handoff`, `session.truncation`, `session.compaction_start`, `session.compaction_complete`, `session.snapshot_rewind`, `session.usage_info`
- user/assistant: `user.message`, `assistant.turn_start`, `assistant.intent`, `assistant.reasoning`, `assistant.reasoning_delta`, `assistant.message`, `assistant.message_delta`, `assistant.turn_end`, `assistant.usage`
- tools: `tool.user_requested`, `tool.execution_start`, `tool.execution_partial_result`, `tool.execution_complete`, `tool.execution_progress`
- agents/hooks/skills: `subagent.started`, `subagent.completed`, `subagent.failed`, `subagent.selected`, `hook.start`, `hook.end`, `skill.invoked`
- protocol v3 requests: `external_tool.requested`, `permission.requested`
- `pending_messages.modified`, `system.message`

The historical TracePilot parser recognizes many durable JSONL events, but not all of the SDK live events as first-class typed variants. Notable gaps include:

| SDK/live event | Current TracePilot status | Opportunity |
|---|---|---|
| `assistant.message_delta` | Forwarded raw, not typed in historical parser, not rendered live. | Realtime streaming assistant text. |
| `assistant.reasoning_delta` | Forwarded raw, not typed in historical parser. | Realtime reasoning-summary/progress UI where available. |
| `assistant.usage` | Forwarded raw, not typed in historical parser. | Live token/quota/cost updates before JSONL/index refresh. |
| `session.idle` | Forwarded raw, not typed in historical parser. | Accurate "turn complete / ready" state. |
| `pending_messages.modified` | Forwarded raw, not typed. | Show queued/pending user messages. |
| `tool.execution_partial_result` | Forwarded raw, not typed in historical parser. | Live tool output streaming. |
| `tool.execution_progress` | Forwarded raw, not typed in historical parser. | Progress rows without waiting for completion. |
| `permission.requested` | SDK can handle internally; TracePilot does not expose UI. | Permission alerts/approval workflow. |
| `external_tool.requested` | SDK can handle registered tools; TracePilot does not register tools. | TracePilot analytics/tools exposed to Copilot sessions. |
| SDK user-input request handler | Supported by SDK examples; TracePilot does not register one. | First-class "agent needs input" alerts and response UI. |

There is also version drift in the other direction: TracePilot's historical parser knows some newer/different file events such as `system.notification`, `session.remote_steerable_changed`, `session.warning`, `session.mode_changed`, `session.task_complete`, `subagent.deselected`, `session.context_changed`, and `session.workspace_file_changed` that are not present in the pinned Rust SDK parser. The bridge's raw forwarding protects against data loss, but typed feature work should tolerate both source vocabularies.

### Realtime streaming is feasible

The pinned Rust SDK's `examples/streaming.rs` demonstrates subscribing to events and rendering `AssistantMessageDelta`. TracePilot already subscribes and forwards these events; the missing piece is a frontend/backend live-state reducer.

Recommendation:

- Add a backend `SdkLiveSessionState` reducer keyed by session ID. It should consume bridge events and maintain:
  - current turn ID,
  - streaming assistant text chunks,
  - reasoning chunks,
  - tool progress/partial results,
  - current status (`idle`, `thinking`, `streaming`, `tool_running`, `waiting_for_input`, `error`, `shutdown`),
  - usage/quota snapshots,
  - pending permission/user-input requests.
- Emit a compact `sdk-session-state-changed` event instead of making every UI feature re-parse raw SDK events.
- Keep raw event forwarding for debug and forward compatibility.

## Stdio, TCP, and `--ui-server` findings

### Stdio mode

Strengths:

- Default mode requires no visible terminal.
- Uses logged-in Copilot user by default.
- Works naturally for headless SDK-launched sessions.

Gaps:

- No durable process handle/PID/health status.
- `set_session_model()` falls back to the upstream SDK's currently buggy method in stdio mode.
- Resume can create a second owner for a session that may already be active in a terminal; TracePilot correctly keeps linking explicit, but this also means no seamless takeover.

### TCP / `--ui-server` mode

Strengths:

- Existing support for `cli_url`.
- UI-server detection exists.
- Launch helper opens a visible terminal running `copilot --ui-server`.
- Foreground session get/set is exposed.
- TCP model switch has a raw JSON-RPC workaround.

Gaps:

- The bridge supports one active connection, not simultaneous stdio plus TCP or multiple TCP servers.
- `detectAndConnect()` chooses the first detected server; manual connection to a selected address is possible, but there is no server registry.
- `sdkLaunchUiServer()` returns a terminal PID but does not wait for readiness, capture the port, or auto-connect.
- The current CLI help output did not advertise `--ui-server` in general help, so this path should be treated as hidden/preview/version-sensitive and probed robustly.
- TCP server death is not proactively detected.

Recommendation:

- Keep one active bridge connection for now, but make the limitation explicit in the UI and docs.
- Add a `UiServerRegistry` state: detected servers, launched-by-TracePilot servers, readiness status, last probe time, active connection target.
- After launching a UI server, poll discovery/status for readiness and offer/perform connect.
- Keep raw RPC workarounds isolated behind capability checks and remove them when the upstream SDK is fixed.

## Launcher/headless findings

The current launcher is terminal-first:

- It builds a shell command with model, reasoning effort, auto-approve, env vars, worktree setup, and optional `--interactive`.
- It returns a terminal wrapper PID and command preview.
- `headless` is carried in config but ignored by Rust.
- The "Launch Headless" button and advanced "Headless Mode" switch are disabled.

This means TracePilot cannot yet launch a session directly into the SDK bridge, stream the response in-app, or bind the launched session into alerts/registry automatically.

Recommendation:

Implement headless launch through the SDK:

1. Reuse launcher validation/worktree/env/model/prompt construction.
2. Ensure the SDK bridge is connected in stdio mode, or connect it with the selected cwd/env.
3. Call `BridgeManager::create_session()` with `BridgeSessionConfig`.
4. If an initial prompt is present, call `send_message()`.
5. Store the session in the SDK registry with `origin = launcher-sdk`.
6. Navigate to the session view and show live streamed state.
7. Make terminal launch and SDK headless launch two explicit modes.

The CLI also supports `-p/--prompt` non-interactive mode. That is useful for terminal/script workflows, but for TracePilot's integrated headless mode the SDK path is better because it preserves session handles, live events, alerts, and steering.

## Alerts findings

### What works

The alert system has good foundations:

- persisted alert history,
- in-app toast/native/taskbar/sound channels,
- cooldown per session/type,
- baseline seeding to avoid startup spam,
- monitored/all scope,
- popup session IDs included in monitored scope.

### Current shortcomings

| Issue | Impact |
|---|---|
| Alerts are not SDK-scoped. | Users can receive polling-based alerts for sessions they are not steering through TracePilot. |
| `ask_user` detection polls JSONL turns. | Alerts are delayed, can miss live waiting state, and cannot reply through TracePilot. |
| SDK user-input handler is unused. | The SDK can ask TracePilot for structured choices/freeform input, but TracePilot does not register a handler. |
| Permission/request events are unused. | `permission.requested` and `external_tool.requested` cannot surface as approvals or alerts. |
| No alert type for SDK waiting state. | `ask-user`, permission, tool approval, and UI elicitation are collapsed or invisible. |
| No per-cycle cap for `alertsScope = "all"`. | A large number of running sessions can generate bursts. |
| Alert click focuses app but does not route to the relevant session/action. | The user still has to find where to respond. |
| Native notification click does not encode alert/session identity. | Only generic focus is implemented. |

### Recommended alert model

Scope alerts to live SDK state first, then keep polling as a compatibility fallback.

New alert types:

- `sdk-user-input-required`
- `sdk-permission-required`
- `sdk-session-error`
- `sdk-session-idle`
- `sdk-bridge-degraded`
- `sdk-event-lag`

Backend/session state should identify sessions that are:

- tracked by SDK,
- actively steered by TracePilot,
- launched by SDK/headless launcher,
- externally observed only.

Default alert scope should become "SDK-steered sessions" or "open sessions", not "all running sessions". "All" should have a burst cap and digest behavior.

For user input, register `session.register_user_input_handler()` on SDK-created/resumed sessions. The handler should:

1. create a pending input request in backend state,
2. emit a live state/alert event,
3. wait for a frontend IPC response or timeout/cancel,
4. return a `UserInputResponse` to the SDK.

The frontend should show an actionable prompt in the alert center and session view. Native notification clicks should deep-link to the session and pending request.

## Observability findings

Bridge metrics exist but are underused:

- global `eventsForwarded`,
- global `eventsDroppedDueToLag`,
- global `lagOccurrences`.

Gaps:

- no per-session metrics,
- no per-subscriber metrics,
- no UI surfacing,
- frontend `recentEvents` trimming is silent,
- no "event stream degraded" alert.

Recommendation:

- Track per-session event counts, lag, last event timestamp, last event ID, and state-reducer errors.
- Track event-forwarder liveness and "no bridge event receivers" exits, not only lag. A live session with a dead forwarder should surface as degraded.
- Expose metrics in settings/debug UI.
- Alert when lag/drops increase during a linked session.
- Persist enough replay boundary (`last_event_id`) to reconcile from JSONL after reconnect.

## Prioritized recommendations

1. Make SDK lifecycle backend-owned and refresh-safe: remove frontend `beforeunload` disconnect, make `connect()` idempotent, add hydration IPC.
2. Add a persisted SDK session registry and explicit state machine.
3. Add live SDK state reduction from raw events, including streaming deltas and waiting-for-input state.
4. Rebuild alerts around SDK-scoped live events and actionable pending requests.
5. Implement SDK headless launch in the session launcher.
6. Add multi-session concurrency tests and per-session send state.
7. Add UI-server readiness/registry/health handling.
8. Add event metrics UI and per-session lag diagnostics.
9. Update event type coverage for SDK deltas/progress/usage and tolerate SDK/CLI vocabulary drift.
10. Upstream or patch the Rust SDK method-name issues and gate raw RPC workarounds behind capabilities.

