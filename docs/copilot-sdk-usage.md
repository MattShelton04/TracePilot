# Copilot SDK Integration Guide

TracePilot integrates the community [Copilot SDK for Rust](https://github.com/copilot-community-sdk/copilot-sdk-rust) to enable **real-time session steering**, programmatic event streaming, and direct communication with the Copilot CLI — all from the desktop UI.

> **Status:** Experimental. Enable via Settings → Experimental → Copilot SDK Bridge.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Architecture](#architecture)
- [Feature Gating](#feature-gating)
- [Setup & Prerequisites](#setup--prerequisites)
- [Connecting](#connecting)
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
│                 │ #[cfg(feature = "copilot-sdk")] │
│  ┌──────────────┴──────────────────────────────┐ │
│  │  copilot-sdk crate (community Rust SDK)     │ │
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
| Rust logic | `crates/tracepilot-orchestrator/src/bridge/manager.rs` | BridgeManager — connects SDK, manages sessions |
| Tauri IPC | `crates/tracepilot-tauri-bindings/src/commands/sdk.rs` | 16 Tauri commands wrapping BridgeManager |
| TS types | `packages/types/src/sdk.ts` | TypeScript mirrors of Rust bridge types |
| TS client | `packages/client/src/sdk.ts` | IPC wrappers for SDK commands |
| Pinia store | `apps/desktop/src/stores/sdk.ts` | Reactive state + actions |
| Steering UI | `apps/desktop/src/components/conversation/SdkSteeringPanel.vue` | Message input, mode/model switcher, abort |
| Status | `apps/desktop/src/components/layout/SdkStatusIndicator.vue` | Sidebar connection indicator |
| Settings | `apps/desktop/src/components/settings/SettingsSdk.vue` | Configuration panel |

## Feature Gating

The SDK is behind a **Cargo feature flag** (`copilot-sdk`) and a **runtime feature flag** (`copilotSdk`).

### Cargo Feature Chain

```
tracepilot-desktop/copilot-sdk
  → tracepilot-tauri-bindings/copilot-sdk
    → tracepilot-orchestrator/copilot-sdk
      → copilot-sdk crate (git dependency)
```

### Without the Feature

When compiled **without** `copilot-sdk`, all bridge methods return sensible fallbacks:
- `connect()` → error "SDK not available"
- `status()` → `{ state: "disconnected", sdkAvailable: false, ... }`
- All other methods → `BridgeError::NotAvailable`

This means the binary is **always shippable** — the feature flag only adds the SDK dependency.

### Runtime Feature Flag

Even with the Cargo feature enabled, the UI only shows SDK controls when `copilotSdk` is toggled on in Settings → Experimental.

## Setup & Prerequisites

1. **Copilot CLI** must be installed and authenticated (`gh auth login`)
2. The SDK spawns a **new CLI subprocess** via stdio JSON-RPC. This subprocess can see sessions from `~/.copilot/session-state/` and resume them for steering.
3. Alternatively, provide a **CLI URL** (e.g. `http://localhost:19563`) to connect to an existing ACP server.

### Auto-Connect

When the `copilotSdk` experimental feature is enabled, TracePilot **automatically connects** to the SDK on app startup. You don't need to manually click "Connect". The auto-connect:
- Spawns a Copilot CLI subprocess
- Authenticates with your GitHub account
- Discovers all sessions from `~/.copilot/session-state/`
- Fetches available models

The connection status is visible in the sidebar (green dot = connected) and in Settings → SDK Bridge.

### How Connection Works

When auto-connecting or when you click **Connect** without a CLI URL:
1. The SDK locates the `copilot` binary on your PATH
2. It spawns it as a subprocess using stdio-based JSON-RPC
3. The subprocess discovers all existing sessions from `~/.copilot/session-state/`
4. You can then resume any session for real-time steering

When you provide a CLI URL:
1. The SDK connects via TCP to the specified ACP server
2. This is useful for connecting to a CLI instance started separately

### Building with SDK Enabled

The SDK is **included by default** in all builds. No special flags needed:

```bash
# Standard build (SDK included)
cargo build

# Build without SDK (opt out)
cargo build --no-default-features
```

## Connecting

### Automatic (Recommended)

When the `copilotSdk` feature is enabled, TracePilot **auto-connects on startup**. No manual action needed.

### From the Settings Panel

1. Go to **Settings → Copilot SDK Bridge**
2. Optionally enter a CLI URL (leave empty to spawn a new subprocess)
3. Click **Connect**

### Diagnostics

If the SDK doesn't seem to work, go to **Settings → SDK Diagnostics** and click **Run Diagnostics**. This runs a step-by-step test of: connect → auth → models → sessions → resume, logging each step. The **Raw State** section shows all current SDK store values.

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

## Session Steering

Once connected, you can steer an active session from the **Conversation tab**:

1. Open a session in TracePilot
2. The **Steering Panel** appears at the bottom of the Chat view
3. Type a message and press Enter (or click Send) to inject it into the session
4. Use the mode buttons (Ask / Plan / Auto) to switch session mode
5. Use the model dropdown to hot-switch models
6. Click **Abort** to gracefully abort a running turn
7. Click **Stop** (in the session label) to unlink/destroy the SDK session

### Steering API

```typescript
import { sdkSendMessage, sdkSetSessionMode } from "@tracepilot/client";

// Send a steering message
await sdkSendMessage("session-id", { prompt: "Focus on the auth module" });

// Switch to plan mode
await sdkSetSessionMode("session-id", "plan");
```

## SDK Settings

The settings panel (visible when the feature is enabled) provides:

- **CLI URL** — TCP URL for an existing ACP server (leave blank to spawn a new CLI subprocess)
- **Log Level** — SDK logging verbosity
- **Connection status** — State, CLI version, active sessions
- **Authentication** — GitHub auth status, login, host
- **Quota** — Real-time usage/limits display (note: `account.get_quota` may not be supported by all CLI versions)

## Verified Capabilities

The following has been tested end-to-end via CDP against the live Tauri webview:

| Capability | Status | Notes |
|---|---|---|
| SDK Connection | ✅ Working | Spawns CLI subprocess, connects via stdio JSON-RPC |
| Session Discovery | ✅ Working | Finds all 236+ sessions from `~/.copilot/session-state/` |
| Session Resume | ✅ Working | Can resume any existing session by ID |
| Model Listing | ✅ Working | 14 models including Claude Sonnet 4.6, GPT-5.4, etc. |
| Auth Status | ✅ Working | Returns GitHub auth info |
| Steering Panel UI | ✅ Working | Visible in Conversation tab with Ask/Plan/Auto modes |
| Status Indicator | ✅ Working | Green dot in sidebar when connected |
| Quota API | ⚠️ Expected | `account.get_quota` returns -32601 (silently handled) |

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
| `destroy_session(id)` | Stop and unlink a resumed session |
| `set_session_mode(id, mode)` | Switch session mode |
| `set_session_model(id, model, effort?)` | Switch session model with optional reasoning effort |
| `list_sessions()` | List all SDK sessions |
| `get_quota()` | Get quota information |
| `get_auth_status()` | Get authentication status |
| `list_models()` | List available models |
| `get_foreground_session()` | Get foreground session ID |
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
# Standard builds include the SDK
cargo build
cargo build --release
cd apps/desktop && cargo tauri dev

# To opt out (exclude SDK):
cargo build --no-default-features
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

1. Enable the feature flag: Settings → Experimental → **Copilot SDK Bridge**
2. In Settings → Copilot SDK Bridge, click **Connect** (leave CLI URL empty to spawn a subprocess)
3. Open a session in the Conversation tab
4. The steering panel should appear at the bottom of the Chat view
5. The session auto-resumes when the steering panel activates
6. Send a message and verify it appears in the CLI terminal

### Testing via CDP (Developer)

You can also test against the running Tauri webview using Chrome DevTools Protocol:

```bash
# Start app with CDP enabled
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
pnpm tauri dev

# CDP endpoint: http://localhost:9222/json
# Connect via WebSocket to evaluate JS in the actual Tauri context
```

## Troubleshooting

| Issue | Solution |
|---|---|
| "SDK not available" error | Ensure default features are not disabled (`--no-default-features`) |
| Can't connect | Ensure Copilot CLI is installed and on PATH (`copilot --version`) |
| No steering panel | Enable `copilotSdk` feature flag in Settings → Experimental |
| Auth errors | Run `gh auth login` to authenticate |
| Connection drops | Check CLI subprocess is still running; try reconnecting |
| Models list empty | Ensure connected and authenticated |
| Quota warning `-32601` | Expected — `account.get_quota` is not supported by current CLI versions. Silently ignored. |
| "Session not found" | The session auto-resumes when you open it. If it fails, the session may not exist in `~/.copilot/session-state/`. |
| "Session data is corrupted" | **Not actual corruption.** The CLI subprocess's schema validation rejected the session data. This happens when the session was written by a different CLI version. TracePilot can still *observe* the session normally — only steering is affected. Update your CLI or start a new session. See [Data Flow doc](copilot-sdk-data-flow.md#the-corruption-problem) for details. |
| Steering sends but no response | The resumed SDK session ID may differ from the input ID. TracePilot tracks this automatically via `resolvedSessionId`. |
| 0 active sessions | Sessions start as inactive. They become active when you open a session in conversation view (auto-resume). |
| Can't send messages | Ensure (1) SDK connected (green dot in sidebar), (2) session is in Conversation view, (3) steering panel is visible. |
| Sent message stuck on "sending" | This was a reactivity bug — now fixed. Messages auto-dismiss after 4s (success) or 8s (error). |
| Want to stop steering | Click the **Stop** button next to the session ID in the steering panel to unlink. |
| Use **Diagnostics** | Go to Settings → SDK Bridge → Run Diagnostics for step-by-step connection test and raw state dump. |

---

## SDK Crate Details

- **Crate:** `copilot-sdk` (community)
- **Repository:** [copilot-community-sdk/copilot-sdk-rust](https://github.com/copilot-community-sdk/copilot-sdk-rust)
- **Pinned revision:** `2946ba1` (v0.1.17, full feature parity with official SDKs)
- **License:** MIT
- **Dependency type:** Git (not published on crates.io)
