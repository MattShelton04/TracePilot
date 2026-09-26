# Copilot SDK Integration Guide

TracePilot integrates the official [GitHub Copilot SDK for Rust](https://github.com/github/copilot-sdk/tree/main/rust) (`github-copilot-sdk`, [ADR-0015](adr/0015-official-copilot-sdk.md)) to enable **real-time session steering**, programmatic event streaming, and direct communication with the Copilot CLI — all from the desktop UI.

> **Live attach:** sessions running in a `copilot --ui-server` terminal are
> streamed live when you open them; see [Live Attach](#live-attach) and
> [ADR-0016](adr/0016-live-attach-to-terminal-sessions.md). The
> [Copilot live attach plan](features/copilot-live-attach-plan.md) records the
> verified CLI behaviour and the remaining roadmap.

> **Status:** Experimental. Enable via Settings → Additional Features → Copilot SDK Bridge.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Architecture](#architecture)
- [Feature Gating](#feature-gating)
- [Setup & Prerequisites](#setup--prerequisites)
- [Connecting](#connecting)
- [Live Attach](#live-attach)
- [Session Steering](#session-steering)
- [SDK Settings](#sdk-settings)
- [Rust API Reference](#rust-api-reference)
- [TypeScript API Reference](#typescript-api-reference)
- [Building](#building-with-the-sdk-feature)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

> 📖 **For a deep dive** on how data flows between TracePilot, the SDK, and the CLI — including why "corruption" errors happen and when steering is safe — see **[Data Flow & Architecture](copilot-sdk-data-flow.md)**.

---

## What It Does

| Capability | Without SDK | With SDK |
|---|---|---|
| Session observation | 5s file-system polling | Real-time events via WebSocket |
| Send messages | Not possible | Inject prompts into active sessions |
| Switch mode (Ask/Plan/Auto) | Manual in terminal | One-click from TracePilot UI |
| Change model | Restart session | Hot-switch mid-session |
| Abort session | Kill process | Graceful abort via SDK |
| Stop/destroy session | Close terminal | "Stop" button in command bar |
| Auth/quota monitoring | Not available | Live auth status + quota display |
| Model listing | Static config file | Dynamic from CLI runtime |

## Architecture

```
┌─────────────────────────────────────────────────┐
│  TracePilot Desktop (Vue 3 + Tauri 2)           │
│                                                   │
│  ┌─────────────┐  ┌────────────────────────────┐ │
│  │ sdk.ts      │  │ SdkSteeringPanel.vue       │ │
│  │ (Pinia)     │  │ SdkStatusIndicator.vue     │ │
│  │             │  │ SettingsSdk.vue             │ │
│  └──────┬──────┘  └───────────┬────────────────┘ │
│         │  Tauri IPC          │                   │
│  ┌──────┴─────────────────────┴────────────────┐ │
│  │  sdk.rs (15 Tauri commands)                 │ │
│  │  ↕ SharedBridgeManager                      │ │
│  │  bridge/manager.rs ← BridgeManager          │ │
│  │  bridge/mod.rs     ← types, errors, events  │ │
│  └──────────────┬──────────────────────────────┘ │
│                 │  (always compiled — ADR-0007)  │
│  ┌──────────────┴──────────────────────────────┐ │
│  │  github-copilot-sdk (official Rust SDK)     │ │
│  │  → Client → Session → EventSubscription     │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
         │ stdio (JSON-RPC)
    ┌────┴────┐
    │ Copilot │
    │  CLI    │
    │ (sub-   │
    │ process)│
    └─────────┘
```

### Key Components

| Layer | File | Purpose |
|---|---|---|
| Rust types | `crates/tracepilot-orchestrator/src/bridge/mod.rs` | Bridge types, errors, event structs |
| Rust logic | `crates/tracepilot-orchestrator/src/bridge/manager/` | BridgeManager — connects SDK, manages sessions |
| SDK client | `crates/tracepilot-orchestrator/src/bridge/manager/sdk_client.rs` | CLI resolution, CLI URL parsing, `ClientOptions` |
| Discovery | `crates/tracepilot-orchestrator/src/bridge/discovery.rs` | Auto-detect `--ui-server` instances |
| Tauri IPC | `crates/tracepilot-tauri-bindings/src/commands/sdk.rs` | 19 Tauri commands wrapping BridgeManager |
| TS types | `packages/types/src/sdk.ts` | TypeScript mirrors of Rust bridge types |
| TS client | `packages/client/src/sdk.ts` | IPC wrappers for SDK commands |
| Pinia store | `apps/desktop/src/stores/sdk.ts` | Reactive state + actions |
| Steering UI | `apps/desktop/src/components/conversation/SdkSteeringPanel.vue` | Message input, mode/model switcher, abort |
| Status | `apps/desktop/src/components/layout/SdkStatusIndicator.vue` | Sidebar connection indicator |
| Settings | `apps/desktop/src/components/settings/SettingsSdk.vue` | Configuration + detect UI + diagnostics |

## Feature Gating

The Copilot SDK is **always compiled into the binary** (ADR-0007). A single
runtime preference (`FeaturesConfig.copilot_sdk`, surfaced as **Settings →
Experimental → Copilot SDK**) controls both the UI surface area and the
backend bridge start paths.

### Runtime Preference Guard

The `BridgeManager` owns an injected reader that consults the preference
every time it is about to start new SDK work. When the preference is off:

- `connect()`, `create_session()` and fresh `resume_session()` return
  [`BridgeError::DisabledByPreference`](../crates/tracepilot-orchestrator/src/bridge/mod.rs).
- `BridgeStatus.enabledByPreference` is `false` (but `sdkAvailable` stays
  `true` — the SDK is compiled in).
- Existing tracked sessions remain steerable. This is deliberate: flipping
  the toggle off mid-flight must not strand work in progress.
  `send_message`, `abort_session`, `set_session_mode/model`,
  `destroy_session` and `unlink_session` are **not** gated.
- The cached-return branch of `resume_session` fires before the guard, so
  a session already in the manager's session map is always resolvable.

### Frontend Behaviour

`copilotSdk` is a Pinia-backed user preference. When it is off, the SDK UI
(`SettingsSdk.vue`, `SdkSteeringPanel.vue`, `SdkStatusIndicator.vue`,
steering composables) is hidden and auto-connect is skipped in
`stores/sdk.ts`. The frontend consumes `enabledByPreference` from
`BridgeStatus` for an authoritative signal rather than duplicating the
preference read.

### Historical Note

Prior to ADR-0007 the Cargo feature `copilot-sdk` was optional and gated
the bridge implementation at compile time, yielding a stub that returned
`BridgeError::NotAvailable` from every method. That path is gone; the
`NotAvailable` variant is retained only for wire-format stability.

## Setup & Prerequisites

1. **Copilot CLI** must be installed and authenticated (`gh auth login`).
2. Enable **Settings → Additional Features → Copilot SDK Bridge**.

That is all you need to watch terminal sessions: sessions running in a
`copilot --ui-server` terminal are joined directly over loopback TCP, one
connection per terminal, whatever the bridge's own connection is set to (see
[Live Attach](#live-attach)).

### The bridge's own connection

The bridge also keeps one connection of its own, used for sessions that no
terminal is running (linking them to steer), new SDK sessions, models, quota
and sign-in. It connects automatically on startup. *Settings → Copilot SDK
Bridge → Advanced → Connection for other sessions* picks where it goes:

- **Private CLI** (default, recommended): TracePilot starts your installed
  `copilot` (found on PATH or via `COPILOT_CLI_PATH`) over stdio and stops it
  on exit. Sessions running in a terminal are never resumed here: they are
  attached where they run, or refused with a restart hint (F9).
- **CLI server**: connect to an existing `copilot --ui-server` or
  `copilot --server --port N`. **Detect** lists running servers, **Launch**
  starts one, or enter its address in **CLI URL**. The address is saved, so if
  that server is closed the next start fails; the status row then says nothing
  is listening there and offers **Use private CLI**.

Terminal attach does not depend on this choice, which is why the private CLI
stays the default: a saved CLI server disappears whenever its terminal closes.

### Settings layout

*Settings → Copilot SDK Bridge* shows, top to bottom:

1. **Status**: connection, CLI version, sign-in, model and session counts,
   with **Connect** / **Disconnect**.
2. **Terminal sessions**: *Watch terminal sessions automatically* and *Start
   terminals watchable*.
3. **Sessions in TracePilot**: sessions being watched (**Live**) or steered
   (**Steering**); click one to open it.
4. **Advanced**: the connection target above, SDK log level, **Run
   Diagnostics** (connect → auth → models → sessions → resume, step by step),
   raw store state and bridge metrics.

## Connecting

The bridge connects automatically on startup while the feature is enabled;
**Connect** / **Disconnect** in the Status row control it by hand.

### Programmatically (Rust)

```rust
use tracepilot_orchestrator::bridge::{BridgeManager, BridgeConnectConfig};

let (manager, mut event_rx) = BridgeManager::new();
manager.connect(BridgeConnectConfig {
    cli_url: Some("ws://localhost:19836".into()),
    ..Default::default()
}).await?;
```

### Programmatically (TypeScript)

```typescript
import { sdkConnect } from "@tracepilot/client";

const status = await sdkConnect({ cliUrl: "ws://localhost:19836" });
console.log(status.state); // "connected"
```

## Live Attach

TracePilot can watch a Copilot CLI session that is running in a terminal, as it
runs, if that terminal was started with `--ui-server`:

- **Sessions TracePilot starts** (launcher, "Resume in Terminal") get
  `--ui-server` automatically while *Settings → SDK → Start terminals
  watchable* is on (the default).
- **Terminals you start yourself** need `copilot --ui-server` (or
  `copilot --resume <id> --ui-server`). The flag is read only at startup, so
  there is no way to turn it on inside a running session; exit and resume
  with it instead. A shell alias such as `alias copilot='copilot --ui-server'`
  makes it the default.

How it looks:

| Session state | Session list | Session view |
|---|---|---|
| Attachable (`--ui-server`) | **Live** badge | Attaches automatically (or **Watch live**), then streams replies, reasoning, tool output, status and context usage |
| Attached | **Watching** badge | "Live · terminal · pid N" label with **Detach** |
| Running without a server | **Active** badge | Restart command with a copy button; the view refreshes from disk |
| Idle | — | History; linking resumes it through TracePilot's own CLI |

Attaching joins the terminal's own CLI as an observer: prompts, permission
requests and questions stay in the terminal, and TracePilot never loads a
second copy of the session. Each attach appends one `session.resume` event to
the session (shown once as "Session resumed N×"), so TracePilot auto-attaches at
most once per terminal (session, PID and address) per view and never
re-attaches after **Detach**. Detaching writes nothing. Turn off *Watch terminal
sessions automatically* to attach only on demand.

When the terminal closes (Ctrl+C, closing the window, or a crash), the next
host check (every 5 s while the session is open) drops the attachment and the
panel says **Stopped watching** with the reason. **Detach** still works in that
window: the detach request is bounded to 2 s, so a dead connection cannot hang
the bridge. Starting the terminal again (`copilot --resume <id> --ui-server`)
is a new host, so the open view attaches to it again; a terminal that is still
loading the session is retried for a few seconds instead of failing with
"session not found".

While attached, streamed text and running tool output are shown straight from
the live stream; every durable event (messages, tool start/complete, turn end,
idle, errors) refreshes the saved conversation within about 400 ms, and the
saved version replaces the live one without duplicates.

## Session Steering

Once connected, you can steer an active session from the **Conversation tab**:

1. Open a session in TracePilot
2. The **Steering Panel** appears at the bottom of the Chat view
3. Type a message and press Enter (or click Send) to inject it into the session
4. Use the mode buttons (Ask / Plan / Auto) to switch session mode
5. Use the model dropdown to hot-switch models
6. Click **Abort** to gracefully abort a running turn
7. Click **Detach** (in the session label) to stop following the session; it keeps running and nothing is written to it

### Steering API

```typescript
import { sdkSendMessage, sdkSetSessionMode } from "@tracepilot/client";

// Send a steering message
await sdkSendMessage("session-id", { prompt: "Focus on the auth module" });

// Switch to plan mode
await sdkSetSessionMode("session-id", "plan");
```

## SDK Settings

See [Settings layout](#settings-layout). Quota comes from `account.getQuota`,
which older CLI versions may not support.

## Verified Capabilities

Verified on 2026-09-26 against Copilot CLI 1.0.88 with `github-copilot-sdk`
1.0.14 (protocol v3), both in the real desktop app (isolated data root, via the
[running-app automation workflow](app-automation.md)) and with the opt-in
smoke tests in `crates/tracepilot-orchestrator/tests/live_copilot_bridge.rs`:

| Capability | Status | Notes |
|---|---|---|
| Stdio connection | ✅ Working | Spawns the installed `copilot --server --stdio` |
| TCP attach | ✅ Working | Detect finds a running `copilot --ui-server`; Connect attaches over `Transport::External` |
| Foreground session | ✅ Working | Returns the session the terminal TUI is showing |
| Attach to a terminal session | ✅ Working | Handler-less resume; live events forwarded (including prompts typed in the TUI) |
| Permission prompts | ✅ Stay in terminal | An attached session reports `waiting_for_permission`; the TUI answers it |
| Send / abort / detach | ✅ Working | Detach (`session.detach`) never writes `session.shutdown` |
| Auth status | ✅ Working | Returns GitHub auth info |
| Model listing | ✅ Working | Returns what the CLI reports (one `auto`-routed model on the test account) |
| Quota | ✅ Working | `account.getQuota` snapshots (previously `-32601` with the community SDK) |

## Rust API Reference

### BridgeManager Methods

| Method | Description |
|---|---|
| `connect(config)` | Connect to Copilot CLI via SDK |
| `disconnect()` | Disconnect and cleanup |
| `status()` | Get current bridge status |
| `cli_status()` | Get CLI-specific status |
| `create_session(config)` | Create a new SDK session |
| `resume_session(id)` | Resume an existing session (e.g. from `--ui-server`) |
| `send_message(id, payload)` | Send a steering message (returns turn ID) |
| `abort_session(id)` | Abort a running session |
| `destroy_session(id)` | Detach a resumed session (`session.detach`; never shuts it down) |
| `set_session_mode(id, mode)` | Switch session mode |
| `set_session_model(id, model, effort?)` | Switch session model with optional reasoning effort |
| `list_sessions()` | List all SDK sessions |
| `get_quota()` | Get quota information |
| `get_auth_status()` | Get authentication status |
| `list_models()` | List available models |
| `get_foreground_session()` | Get foreground session ID |
| `attach_session(id, address)` | Join a `--ui-server` terminal's session as an observer (one client per endpoint) |
| `reconcile_attachments(hosts)` | Drop attachments whose terminal exited or moved |
| `set_foreground_session(id)` | Set foreground session |

### Bridge Events

Events are emitted via a `broadcast::Sender<BridgeEvent>` and forwarded to the Tauri frontend via the `sdk-bridge-event` IPC event.

```rust
pub struct BridgeEvent {
    pub session_id: String,
    pub event_type: String,
    pub timestamp: String,
    pub id: Option<String>,
    pub parent_id: Option<String>,
    pub ephemeral: bool,
    pub data: serde_json::Value,
}
```

## TypeScript API Reference

### Client Functions (`@tracepilot/client`)

All functions are async and use the Tauri IPC bridge with automatic mock fallback:

```typescript
// Connection
sdkConnect(config: BridgeConnectConfig): Promise<BridgeStatus>
sdkDisconnect(): Promise<void>
sdkStatus(): Promise<BridgeStatus>
sdkCliStatus(): Promise<BridgeStatus>

// Sessions
sdkCreateSession(config: BridgeSessionConfig): Promise<BridgeSessionInfo>
sdkResumeSession(sessionId: string): Promise<BridgeSessionInfo>
sdkSendMessage(sessionId: string, payload: BridgeMessagePayload): Promise<string>
sdkAbortSession(sessionId: string): Promise<void>
sdkDestroySession(sessionId: string): Promise<void>
sdkSetSessionMode(sessionId: string, mode: BridgeSessionMode): Promise<void>
sdkSetSessionModel(sessionId: string, model: string, reasoningEffort?: string): Promise<void>
sdkListSessions(): Promise<BridgeSessionInfo[]>
sdkGetForegroundSession(): Promise<string | null>
sdkSetForegroundSession(sessionId: string): Promise<void>

// Live attach (ADR-0016)
sdkLiveHosts(sessionIds: string[]): Promise<LiveSessionHost[]>  // attachable | running | idle
sdkAttachSession(sessionId: string): Promise<BridgeSessionInfo>

// Quota & Auth
sdkGetQuota(): Promise<BridgeQuota>
sdkGetAuthStatus(): Promise<BridgeAuthStatus>

// Models
sdkListModels(): Promise<BridgeModelInfo[]>
```

### Pinia Store (`useSdkStore`)

```typescript
import { useSdkStore } from "@/stores/sdk";

const sdk = useSdkStore();

// Reactive state
sdk.connectionState  // "disconnected" | "connecting" | "connected" | "error"
sdk.isConnected      // computed boolean
sdk.sessions         // BridgeSessionInfo[]
sdk.models           // BridgeModelInfo[]
sdk.quota            // BridgeQuota | null
sdk.authStatus       // BridgeAuthStatus | null
sdk.recentEvents     // BridgeEvent[]

// Actions
await sdk.connect({ useLoggedInUser: true });  // spawns CLI subprocess
await sdk.connect({ cliUrl: "http://localhost:19563" });  // connect to existing server
await sdk.resumeSession("existing-session-id");
await sdk.sendMessage(sessionId, { prompt: "..." });
await sdk.setSessionMode(sessionId, "autopilot");
```

### IPC Events

| Event | Payload | Description |
|---|---|---|
| `sdk-bridge-event` | `BridgeEvent` | Real-time session event from SDK |
| `sdk-connection-changed` | `BridgeStatus` | Connection state change |

## Building With the SDK Feature

The SDK is **enabled by default** in all crates. No special flags required:

```bash
# Standard builds always include the SDK (ADR-0007 — no opt-out flag).
cargo build
cargo build --release
cd apps/desktop && cargo tauri dev
```

## Testing

### Rust Tests

```bash
# All orchestrator tests (345 tests, includes bridge module)
cargo test -p tracepilot-orchestrator --quiet

# Just bridge tests
cargo test -p tracepilot-orchestrator bridge --quiet
```

### TypeScript Validation

```bash
# Type-check all packages
pnpm --filter @tracepilot/types exec tsc --noEmit
pnpm --filter @tracepilot/client exec tsc --noEmit
cd apps/desktop && npx vue-tsc --noEmit
```

### Manual Testing

1. Enable the feature flag: Settings → Additional Features → **Copilot SDK Bridge**
2. In Settings → Copilot SDK Bridge, check **Status** says *Connected · private CLI* (click **Connect** if not)
3. Open a session in the Conversation tab
4. The steering panel should appear at the bottom of the Chat view
5. The session auto-resumes when the steering panel activates
6. Send a message and verify it appears in the CLI terminal

### Testing via CDP (Developer)

Use the [running-app automation workflow](app-automation.md) to inspect the real
Tauri webview with the upstream Playwright agent CLI:

```powershell
pnpm app:start
# Use the attach command printed by startup; the port may differ.
pnpm exec playwright-cli -s=tracepilot-desktop attach --cdp=http://127.0.0.1:9222
pnpm exec playwright-cli -s=tracepilot-desktop snapshot --filename=.playwright-cli/current.yml
pnpm exec playwright-cli -s=tracepilot-desktop detach
pnpm app:stop
```

## Troubleshooting

| Issue | Solution |
|---|---|
| "SDK not available" error | Should not occur — the SDK is always compiled in (ADR-0007). If you see this from older logs, rebuild on `main`. |
| "Copilot SDK bridge is disabled by user preference" | Enable **Settings → Additional Features → Copilot SDK Bridge**. Existing sessions remain steerable even while the toggle is off. |
| Can't connect | Ensure Copilot CLI is installed and on PATH (`copilot --version`) |
| No steering panel | Enable `copilotSdk` feature flag in Settings → Additional Features |
| Auth errors | Run `gh auth login` to authenticate |
| Connection drops | Check CLI subprocess is still running; try reconnecting |
| Models list empty | Ensure connected and authenticated |
| Quota unavailable | Quota comes from `account.getQuota`; some CLI versions or accounts return an error, which the UI ignores. |
| "Session not found" | The session auto-resumes when you open it. If it fails, the session may not exist in `~/.copilot/session-state/`. |
| "Session data is corrupted" | **Not actual corruption.** The CLI subprocess's schema validation rejected the session data. This happens when the session was written by a different CLI version. TracePilot can still *observe* the session normally — only steering is affected. Update your CLI or start a new session. See [Data Flow doc](copilot-sdk-data-flow.md#the-corruption-problem) for details. |
| Steering sends but no response | The resumed SDK session ID may differ from the input ID. TracePilot tracks this automatically via `resolvedSessionId`. |
| 0 active sessions | Sessions start as inactive. They become active when you open a session in conversation view (auto-resume). |
| Can't send messages | Ensure (1) SDK connected (green dot in sidebar), (2) session is in Conversation view, (3) steering panel is visible. |
| Sent message stuck on "sending" | This was a reactivity bug — now fixed. Messages auto-dismiss after 4s (success) or 8s (error). |
| Want to stop steering | Click **Detach** next to the session ID in the steering panel. This detaches TracePilot (`session.detach`); it never shuts down the session. |
| Tools are denied in an SDK-launched session | SDK launches only approve tool permissions when **Auto-approve** is enabled in the launcher. Interactive approval is planned. |
| Use **Diagnostics** | Go to Settings → Copilot SDK Bridge → Advanced → Run Diagnostics for step-by-step connection test and raw state dump. |

---

## SDK Crate Details

- **Crate:** [`github-copilot-sdk`](https://crates.io/crates/github-copilot-sdk) (official)
- **Repository:** [github/copilot-sdk](https://github.com/github/copilot-sdk) (`rust/`)
- **Version:** exact pin `=1.0.14` (`default-features = false`; no bundled CLI)
- **License:** MIT
- **Dependency type:** crates.io
- **Build:** `.cargo/config.toml` sets `COPILOT_SKIP_CLI_DOWNLOAD=1` so builds never download a CLI.
