# Copilot Live Attach — Official SDK Migration and Integration Redesign

Status: in progress.

- Phase 1, the official SDK swap, shipped in #852.
- Live attach is implemented on `feat/live-attach`: the core of Phase 2,
  Phase 3's attachable-by-default launches, and the first Phase 4 UI.
- The remaining items stay open below.

Research date: 2026-09-26. Verified against Copilot CLI **1.0.88** and
`github-copilot-sdk` **1.0.14** (crates.io), JSON-RPC protocol **v3**, on
Windows 11.

Decision records: [ADR-0015](../adr/0015-official-copilot-sdk.md) (SDK) and
[ADR-0016](../adr/0016-live-attach-to-terminal-sessions.md) (live attach).

## Goal

TracePilot should be able to **attach to Copilot CLI sessions that are already
running** and show what they are doing *as it happens*:

- streaming assistant text and reasoning;
- tool calls as they start, with **live tool output** (for example PowerShell
  stdout while the command is still running);
- turn / idle / error status, token usage, and background-task changes;
- optionally, sending a message, changing mode or model, or aborting a turn.

Observation is the primary use case. Steering is secondary and must never be
possible in a way that forks a session's history.

The existing integration used the unmaintained community crate
`copilot-community-sdk/copilot-sdk-rust` (last commit 2026-03-19, pinned at
`2946ba1`). GitHub now publishes an official Rust SDK in
[`github/copilot-sdk`](https://github.com/github/copilot-sdk) as the
`github-copilot-sdk` crate. This plan replaces the dependency and then
redesigns the integration around the attach use case.

## What the current integration gets wrong

| Problem | Where | Consequence |
|---|---|---|
| Unmaintained dependency with known wire bugs | workspace `Cargo.toml` | Needed a hand-written raw JSON-RPC client for `session.model.switchTo` (`bridge/manager/raw_rpc.rs`) and an event-payload "flatten" shim. |
| **Stdio mode is the default** | `BridgeManager::connect` | TracePilot spawns a *private* CLI and "resumes" sessions that are running in the user's terminal. The copy is isolated: it never sees the terminal's live activity, and any message sent through it forks history (see finding F9). |
| One connection only | `BridgeManager` holds one `Client` | Every `copilot --ui-server` terminal is its own server on its own port, so TracePilot can attach to at most one terminal at a time. |
| Discovery by process scanning only | `bridge/discovery.rs` | PowerShell/`ps` scraping with no knowledge of *which session* a server hosts. |
| `destroy` wrote `session.shutdown` into the user's session | `destroy_session` | Detaching from a terminal session could mark it shut down on disk. |
| Reducer only knows the 2026-04 event set | `bridge/live_state/reducer` | New ephemeral event types (`assistant.streaming_delta`, `assistant.message_start`, `assistant.tool_call_delta`, `session.background_tasks_changed`, `session.usage_info`, `assistant.idle`, …) are ignored; long tool output keeps the *head* instead of the tail. |
| UI centred on "connect the SDK bridge" | Settings → SDK, steering panel | Users have to understand stdio vs TCP, detect servers manually, and "link" sessions before anything happens. |

## Research findings (verified 2026-09-26)

All findings were produced with a throwaway probe binary built on
`github-copilot-sdk = "=1.0.14"` (`default-features = false`) against a real
`copilot --ui-server` launched in a scratch workspace, plus a raw JSON-RPC
listener. Event captures stayed outside the repository.

| # | Finding | Design consequence |
|---|---|---|
| F1 | `Transport::External { host, port, connection_token }` connects to a running `copilot --ui-server` in ~3–6 ms; `get_status` reports CLI 1.0.88 / protocol 3. | Attach to terminals over TCP; no subprocess needed. |
| F2 | `get_foreground_session_id()` on a ui-server returns the terminal's own session. | One RPC tells us which session a terminal is showing. |
| F3 | `resume_session` with **no handlers installed** joins the live session as an observer (`requestPermission: false`, etc.). Permission prompts stay with the terminal. | "Attach" = handler-less resume. |
| F4 | An observer receives events for prompts **typed in the terminal TUI** (`user.message` with `delivery: "idle"`, turns, tools, deltas), not only for prompts it sent. | The core attach scenario works. |
| F5 | Token deltas (`assistant.message_delta`, `assistant.reasoning_delta`, `assistant.tool_call_delta`, `assistant.streaming_delta`) arrive **without** the observer requesting `streaming`, because the TUI already enabled it. | Do not set `streaming` when attaching to someone else's session. |
| F6 | `tool.execution_partial_result` streams **cumulative** `partialOutput` snapshots roughly every 350 ms while a PowerShell command runs; `tool.execution_complete` carries the final result. | Live terminal output is available; keep the tail when truncating. |
| F7 | Of 377 events in one tool-using turn, ~350 were `ephemeral: true` and never reach `events.jsonl` (all deltas, partial tool output, usage info, background-task changes, idle). | Live attach is the only source of this data; file tailing can never provide it. |
| F8 | Each successful resume appends one `session.resume` event to the session's `events.jsonl` (with `alreadyInUse` / `sessionWasActive` flags). `Session::disconnect()` writes nothing, and the terminal keeps working. | Attach at most once per session per connection; never poll with resume. Detach = `disconnect()`. |
| F9 | A **separate** stdio CLI can resume a session held by another process: it succeeds silently, writes nothing, and receives **none** of the live activity. | Private-stdio "attach" to a running session is useless for observation and unsafe for steering. It must be refused. |
| F10 | A connection that never resumes still receives `session.lifecycle` notifications (`session.created/updated/deleted/foreground/background`) and `host.event`, but no `session.event`. | Cheap, side-effect-free "something changed" signal per server for dashboards. |
| F11 | Each session directory holds `inuse.<pid>.lock` naming the PID that hosts it. | Map session → hosting process → attachable endpoint. |
| F12 | The CLI has an **attach-discovery registry** at `~/.copilot/servers` (`remoteRegistry*` native API; kinds `ui-server` and `managed-server`; 30 s heartbeat; 5 min stale window; status derived from `assistant.turn_start/turn_end/abort/session.error`). `--headless --managed-server` publishes to it; a plain `--ui-server` on 1.0.88 did **not** publish an entry in testing. | Read the registry when present; fall back to PID/port scanning. Re-test on each CLI bump. |
| F13 | `--ui-server` without `COPILOT_CONNECTION_TOKEN` logs "connections will be accepted from any client". | TracePilot-launched servers should set a token, and TracePilot must send it. |
| F14 | A TracePilot-*created* session with no permission handler has tools **denied** ("Permission denied and could not request permission from user"). | Owned sessions need an explicit permission policy (auto-approve today; UI handler later). |
| F15 | SDK 1.0.14 resolves the CLI program **even for `Transport::External`**, failing with `BinaryNotFound` when the bundled CLI is disabled. | Always pass `CliProgram::Path` (the user's `copilot`). Worth reporting upstream. |
| F16 | Default features (`bundled-cli`) download and embed a full CLI at build time. Without them, `build.rs` still downloads a runtime package unless `COPILOT_SKIP_CLI_DOWNLOAD` is set. | `default-features = false` + `COPILOT_SKIP_CLI_DOWNLOAD=1` via `.cargo/config.toml`; TracePilot always drives the user's installed CLI. |
| F17 | `SessionEvent.data` is plain JSON; `session.model.switchTo` uses the correct method name; `destroy()` is a deprecated alias of `disconnect()`. | Delete the flatten shim, the raw RPC client, and the "destroy writes shutdown" semantics. |
| F18 | `Client::from_streams(reader, writer, cwd)` is public. | Unit tests can drive the real SDK against an in-memory scripted JSON-RPC peer instead of fabricated sessions. |
| F19 | `--ui-server` is a hidden startup flag. The embedded server is enabled only from it; no environment variable, config key, or slash command starts it in a running CLI. `copilot --resume <id> --ui-server` restarts a session attachably with its history intact. | Make TracePilot's own launches attachable by default. For other terminals, show the restart command. |
| F20 | A plain `--ui-server` does not publish to `~/.copilot/servers`, even with `--experimental`. Publishing is gated by an internal sessions-sidebar flag and managed servers (refines F12). | Locate hosts from `inuse.<pid>.lock` plus a PID → loopback-port probe. The registry is not used. |
| F21 | A running CLI holds `inuse.<pid>.hold` open. On Windows an exclusive, read-only open fails with sharing violation 32 while the PID lives and succeeds after it exits. Stale `.lock` files outlive crashed CLIs. | Liveness costs one file open per holder, no `tasklist`; that took about 500 ms. Other platforms use one `ps` listing. |
| F22 | The `session.resume` event written by an attach has no client name or other marker. | History cannot tell observer attaches apart from other resumes. Collapse consecutive resumes into one row in the conversation view. |

### Live and persisted data in one view

An attached session is shown from two sources at once. The rules are in
ADR-0016, decision 8:

| Data | Source | Lifetime |
|---|---|---|
| Streaming assistant and reasoning text | Live overlay turn | Shown until the refreshed persisted turn contains the text. The check is containment, not prefix, because one saved turn spans several model calls. |
| Running tool output | Live state, rendered inside the persisted tool card | Shown until the card's `tool.execution_complete` result is indexed. The steering panel shows only a one-line ticker. |
| Status, context window, usage | Live state panel | Ephemeral; cleared on detach. |
| Messages, tool calls and results, subagents | Persisted history | A durable event triggers a refresh with a 400 ms debounce, at most 2 s apart. Terminal prompts appear in about 1.5 s. |

Verified end to end in the desktop app:
- a prompt sent from TracePilot streamed text and returned to Idle;
- a prompt sent by another SDK client appeared in the persisted view within
  about 1.5 s;
- a PowerShell tick loop streamed into its tool card, and the persisted
  result replaced the live output without a duplicate.

This was checked against three terminals: attachable, plain, and
attachable with `--allow-all`.

### Session hosting states

Combining F9–F12, every session TracePilot knows about is in exactly one of
these states:

| State | How detected | What TracePilot can do |
|---|---|---|
| **Attachable** | Hosting PID is a `--ui-server`, `--server`/`--headless`, or managed server with a known loopback port (registry entry or PID → listening port) | Attach over TCP; observe live; optionally steer. |
| **Running, not attachable** | Hosting PID alive but it is a plain `copilot` TUI with no server | Tail `events.jsonl` (durable events only). Offer "relaunch attachable" guidance. |
| **Idle** | No live `inuse.<pid>.lock` holder | Observe history. Steering requires an explicit **resume-to-steer** through a private TracePilot-owned CLI. |
| **Owned** | Created or resumed by TracePilot's own CLI connection | Full control, including permissions (Phase 3). |

## Target architecture

```text
            ┌──────────────────────── TracePilot (Rust) ─────────────────────────┐
            │                                                                     │
 ~/.copilot │  SessionLocator ── inuse.<pid>.lock + ~/.copilot/servers registry   │
  (disk)  ──┼─►   + PID→port probe  ─►  HostingState per session                  │
            │                                                                     │
            │  ConnectionRegistry  (one github_copilot_sdk::Client per endpoint)  │
            │    ├─ Endpoint::External{host,port,token,pid}  ◄── attach (TCP)     │
            │    └─ Endpoint::Private (stdio, TracePilot-owned CLI)               │
            │         each: lifecycle subscription, health, reconnect/backoff     │
            │                                                                     │
            │  Attachments  (session → Arc<Session>, role = Observer | Owner)     │
            │    └─ EventSubscription ─► normaliser ─► LiveStateStore reducer     │
            │                                   └─► coalesced IPC (≤ 30 Hz)       │
            └───────────────────────────────┬─────────────────────────────────────┘
                                            │ Tauri events: live-state snapshots,
                                            │ raw events (debug), hosting states
                                            ▼
                       Vue: Live badge, Live panel, steering composer
```

Principles:

1. **Attach, don't impersonate.** Observing a session means joining the process
   that hosts it. TracePilot never loads a second copy of a running session.
2. **Observer by default.** No permission, elicitation, user-input, or
   exit-plan handlers on attached sessions, so prompts stay in the terminal.
   Steering is an explicit, per-session action.
3. **One resume per attachment.** Resume has a durable side effect (F8).
4. **Discovery is data, not scraping.** Prefer the CLI's registry and lock
   files; process scanning is the fallback.
5. **Ephemeral data stays ephemeral.** Live deltas are not persisted by
   TracePilot; the indexer keeps reading `events.jsonl` for history.

## Phases

Each phase is independently shippable and keeps `main` releasable. Check boxes
track delivery.

### Phase 1 — Swap to the official SDK (behaviour parity) ✅ #852

- [x] Research and record findings (this document, ADR-0015).
- [x] Replace the `copilot-sdk` git dependency with
      `github-copilot-sdk = "=1.0.14"`, `default-features = false`.
- [x] Set `COPILOT_SKIP_CLI_DOWNLOAD=1` in `.cargo/config.toml` so builds never
      download or embed a CLI (F16).
- [x] Resolve the user's `copilot` executable and pass it as
      `CliProgram::Path` for every transport (F15).
- [x] Map `cli_url` to `Transport::External` (accepting `host:port` and
      `scheme://host:port`); keep stdio when no URL is set.
- [x] Port create / resume / send / abort / mode / model / quota / auth /
      models / foreground to the official API. Map legacy message `mode`
      values to `DeliveryMode`.
- [x] Resume without handlers (observer semantics, F3); detach and destroy both
      call `Session::disconnect()` and never write `session.shutdown` (F8, F17).
- [x] SDK launches install an approve-all permission policy only when the
      launch has **Auto-approve** enabled (F14).
- [x] Delete the raw JSON-RPC model-switch workaround and the event-flatten shim
      (F17).
- [x] Replace fabricated-session unit tests with a scripted in-memory JSON-RPC
      peer driven through `Client::from_streams` (F18).
- [x] Update `deny.toml`, ADR index, and SDK docs.

IPC shapes (`BridgeStatus`, `BridgeEvent`, `BridgeSessionInfo`, commands) are
unchanged in this phase, so the frontend needs no changes.

### Phase 2 — Live attach backend

- [x] Session locator (`bridge/live_host.rs`):
      - reads `inuse.<pid>.lock`, checks hold-file liveness (F21), and
        probes PID → loopback port;
      - reports `attachable`, `running`, or `idle` per session through
        `sdk_live_hosts`;
      - does not use the registry (F20).
- [x] One SDK `Client` per endpoint (`BridgeManager.endpoints`), closed when
      its last attached session detaches. Still to do: per-endpoint health
      and reconnect with backoff. Today a dropped endpoint shows the session
      as ended, and the next poll re-attaches.
- [x] Attach resumes once as an observer and detach disconnects. Attach is
      idempotent and coalesced per session. Reconciliation drops an
      attachment when its host exits or moves. There are no explicit
      `Owner` roles yet.
- [x] `sdk_resume_session` refuses `running` sessions with `NotAttachable`
      (F9) and attaches to `attachable` ones.
- [ ] Per-endpoint `subscribe_lifecycle()` for cheap activity indicators (F10).
- [ ] Connection-token support end to end (config, discovery, registry) (F13).
- [ ] Reducer update for the 1.0.8x event set.
      - Done: `assistant.idle`, `session.idle`, and turn end set Idle;
        `session.usage_info` feeds the context meter; `assistant.usage`;
        tool results are kept as text.
      - Still open: `assistant.message_start`, `assistant.streaming_delta`,
        `assistant.tool_call_delta`, `session.background_tasks_changed`,
        `pending_messages.modified`, `session.title_changed`, tail-preserving
        truncation (F6), and `agentId` routing.
- [x] Coalesce high-frequency live-state snapshots before IPC. The limit is
      20 per second per session, with a trailing flush. `model.*` and
      `system.message` payloads are trimmed before they cross IPC. Metrics
      are still to do.
- [x] New IPC commands `sdk_live_hosts` and `sdk_attach_session`. Detach
      reuses `sdk_unlink_session`, and live state keeps the existing
      `sdk-bridge-event` stream. Renaming the surface to `live_*` waits for
      Phase 5.
- [ ] Opt-in live smoke test (`#[ignore]`, env-gated) that launches a real
      `copilot --ui-server` and asserts F4/F6/F8.

### Phase 3 — Make sessions attachable by default

- [x] Launches and "Resume in Terminal" add `--ui-server` by default
      (`live.launchAttachable`, a Settings → SDK toggle). Still to do: a
      generated `COPILOT_CONNECTION_TOKEN` (F13).
- [x] Help for *Running, not attachable* sessions: the session view shows
      the exact `copilot --resume <id> --ui-server` command with a copy
      button, and never kills the user's process.
- [ ] Owned (headless) sessions: replace approve-all with a real permission /
      user-input / elicitation handler that raises a TracePilot prompt and
      times out to *deny* (via the SDK handler traits).
- [ ] Evaluate `--headless --managed-server` for SDK launches once its registry
      entries are confirmed stable (F12).

### Phase 4 — UI/UX overhaul

Replace the "connect the SDK bridge" model with a session-centric **Live**
model:

- **Session list:** a hosting badge per row — *Live* (attachable),
  *Running* (not attachable), *Idle* — driven by `HostingState`, with the
  attached state shown when TracePilot is observing.
- **Session view:** a **Live** toggle that auto-attaches when the session is
  attachable (a user preference), and a Live panel that shows:
  - the in-flight assistant message and reasoning streaming in;
  - tool calls appearing as their arguments stream (`tool_call_delta`), then a
    live output pane for running shell tools (tail-follow, monospace, ANSI
    stripped, capped);
  - turn status, context-window usage (`session.usage_info`), queued messages,
    and background tasks.
  When a turn completes, the durable events arrive through the indexer and the
  live overlay yields to the normal conversation rendering without flicker.
- **Steering composer:** collapsed by default and clearly labelled as sending
  into a shared session. It is disabled for *Running, not attachable*, and
  resume-to-steer for *Idle* sessions requires confirmation.
- **Settings:** replace the stdio/TCP connection panel with a "Live sessions"
  section (enable, discovered servers, manual `host:port` and token entry, and
  diagnostics). Remove the manual "Detect UI server / Connect" flow from the
  main path. (Observed 2026-09-26: the current Stdio/TCP toggle flips back to
  Stdio while disconnected unless a CLI URL is already saved.)
- Rename *Unlink* / *Shutdown*: since Phase 1 both only detach, so the UI
  should offer a single **Detach** action.

Delivered on `feat/live-attach`:
- Live and Watching badges in the session list, and a Live badge in the
  session header.
- Auto-attach, controlled by `live.autoAttach`.
- A "Watch live" card for attachable sessions, and a restart-command card
  for plain terminals.
- A "Live · terminal · pid" label with a single **Detach** action.
- A context-window meter, running tools only, and a one-line output
  ticker.
- Live tool output inside the conversation's tool cards.
- A Live terminal sessions section in Settings → SDK.

Still open:
- Removing the connect/detect flow from the main path.
- Queued messages and background tasks.
- VRT scenarios for the live states.
- Validate at 1440×960, 960×640, and 2560×1440 with the running-app automation
  workflow, and add VRT scenarios for the live states.

### Phase 5 — Cleanup

- [ ] Remove the legacy `sdk_*` IPC commands, `SdkSteeringPanel` and related
      composables once Phase 4 callers are gone.
- [ ] Supersede ADR-0009 with a registry-based lifecycle ADR.
- [ ] Retire the community-SDK research documents from the docs index.
- [ ] Track SDK releases: bump the exact pin deliberately, re-run the live
      smoke test, and re-check F12/F15.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| CLI and SDK protocol drift (both release weekly) | Exact version pin; `verify_protocol_version()` on connect; live smoke test on every bump; the reducer tolerates unknown events. |
| Attaching writes `session.resume` into the user's history (F8) | Attach once per session; never resume in a loop; document the side effect in the UI tooltip. |
| Unauthenticated loopback servers (F13) | Tokens for TracePilot-launched servers; connect only to loopback hosts found by discovery or entered manually. |
| Event floods (hundreds of deltas per turn) | Coalescing, bounded broadcast channels, lag metrics already in `BridgeMetrics`. |
| Registry format is undocumented (F12) | Treat it as optional and version-checked; the fallback is PID → port probing. |
| `native-tls` enters the dependency graph through the SDK | Accepted in ADR-0015; the Windows target already links SChannel. Revisit if the SDK adds a `rustls` feature. |

## Open questions

1. ~~Should TracePilot-launched terminals use `--ui-server` by default?~~
   Resolved: yes, behind `live.launchAttachable` (ADR-0016).
2. ~~Should attaching be automatic when a session view opens?~~ Resolved:
   yes, behind `live.autoAttach`, at most once per view and never after
   Detach (ADR-0016).
3. Is it acceptable for Phase 2 to keep the `copilotSdk` experimental toggle as
   the master switch, renamed to "Live sessions"?

## References

- Official SDK: <https://github.com/github/copilot-sdk> (`rust/README.md`,
  `rust/tests/e2e/multi_client.rs`, `docs/features/streaming-events.md`).
- [ADR-0007](../adr/0007-copilot-sdk-always-on.md),
  [ADR-0009](../adr/0009-bridge-lifecycle.md),
  [ADR-0015](../adr/0015-official-copilot-sdk.md).
- [Copilot SDK usage](../copilot-sdk-usage.md) for the current bridge surface.
