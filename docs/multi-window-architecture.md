# Multi-Window Architecture Design

> **Status:** RFC / Design Document  
> **Author:** Copilot (research-assisted)  
> **Date:** 2026-04-13  
> **Scope:** Multi-window support, concurrent session monitoring, per-window SDK steering, cross-window state synchronisation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Baseline](#2-current-architecture-baseline)
3. [Proposed Multi-Window Model](#3-proposed-multi-window-model)
4. [Window Types & Use Cases](#4-window-types--use-cases)
5. [Data Flow & State Synchronisation](#5-data-flow--state-synchronisation)
6. [SQLite Concurrency Analysis](#6-sqlite-concurrency-analysis)
7. [SDK Bridge Multi-Session Architecture](#7-sdk-bridge-multi-session-architecture)
8. [Tauri Configuration Changes](#8-tauri-configuration-changes)
9. [Frontend Architecture Changes](#9-frontend-architecture-changes)
10. [Rust Backend Changes](#10-rust-backend-changes)
11. [Edge Cases & Failure Modes](#11-edge-cases--failure-modes)
12. [Risks of Running Multiple Instances](#12-risks-of-running-multiple-instances)
13. [Implementation Phases](#13-implementation-phases)
14. [Open Questions](#14-open-questions)

---

## 1. Executive Summary

TracePilot currently runs as a single-window Tauri v2 application. Users who want to monitor multiple Copilot CLI sessions simultaneously must launch separate TracePilot processes, which introduces risks: duplicated SQLite write contention on `index.db`, conflicting config saves, duplicated SDK bridge connections, and doubled memory usage.

This document proposes a **single-process, multi-window** architecture using Tauri v2's `WebviewWindow` API. Each additional window runs an independent Vue instance with its own Pinia stores but shares the same Rust backend state, database connections, and SDK bridge. This eliminates inter-process contention while enabling concurrent session monitoring, dedicated SDK steering panels, and flexible workspace layouts.

### Key Design Principles

1. **Rust backend is the single source of truth** — all windows query the same managed state
2. **Events broadcast to all windows** — `app.emit()` already targets all webviews
3. **Each window has independent navigation** — separate Vue router, separate Pinia stores
4. **Config writes are serialised** — only the main window (or a designated coordinator) owns config persistence
5. **Feature-flagged** — multi-window is gated behind `features.multiWindow` for incremental rollout

---

## 2. Current Architecture Baseline

### What Already Works for Multi-Window

| Component | Current State | Multi-Window Impact |
|---|---|---|
| **Rust managed state** | `Arc<Mutex<...>>` / `Arc<RwLock<...>>` per resource | ✅ Already thread-safe and shared across all windows |
| **SQLite IndexDb** | WAL mode + `busy_timeout=5000` | ✅ Concurrent readers supported; single writer serialised by SQLite |
| **BridgeManager** | `Arc<RwLock<BridgeManager>>` + `broadcast::channel` | ✅ Broadcast already fans out to multiple receivers |
| **Tauri events** | `app.emit(event, payload)` | ✅ Broadcasts to ALL webviews in the process |
| **LRU caches** | `Arc<Mutex<LruCache>>` for turns and events | ✅ Shared cache benefits all windows |
| **Semaphores** | `Arc<Semaphore>` for indexing | ✅ Serialises operations regardless of calling window |

### What Needs Changes

| Component | Current State | Required Change |
|---|---|---|
| **tauri.conf.json** | Single window `"main"` | Add window configurations or create dynamically |
| **capabilities/default.json** | Scoped to `windows: ["main"]` | Expand to include child window labels (or use glob) |
| **Vue/Pinia stores** | Singleton per JS context | Each window gets independent stores; cross-window sync via events |
| **Preferences persistence** | Any store watcher can trigger `saveConfig()` | Coordinate to prevent concurrent config writes |
| **sessionDetail store** | Tracks ONE session at a time | Already scoped per window (each gets its own instance) |
| **Router/URL state** | Single hash router | Each window has independent router |
| **Window lifecycle** | No management code | Need create/close/focus commands and cleanup |

---

## 3. Proposed Multi-Window Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    Single Tauri Process                          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Main Window  │  │ Session Win  │  │ Monitor Win  │  ...     │
│  │  (label:main) │  │ (session-*)  │  │  (monitor)   │          │
│  │              │  │              │  │              │          │
│  │  Full SPA    │  │  Detail View │  │  Grid/Tiles  │          │
│  │  + Sidebar   │  │  (no sidebar)│  │  Multi-sess  │          │
│  │  + All routes│  │  + SDK panel │  │  + Alerts    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           │                                     │
│                    Tauri IPC Layer                               │
│         ┌─────────────────┼─────────────────┐                   │
│         │    Shared Rust Backend State       │                   │
│         │                                   │                   │
│         │  Arc<RwLock<BridgeManager>>        │                   │
│         │  Arc<Mutex<LruCache>> (turns)      │                   │
│         │  Arc<Mutex<LruCache>> (events)     │                   │
│         │  Arc<Semaphore> (indexing)          │                   │
│         │  Arc<RwLock<Config>>               │                   │
│         │  IndexDb (rusqlite Connection)      │                   │
│         └───────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### Window Lifecycle

1. **Main window** — Created by `tauri.conf.json` on app launch. Always exists. Closing it closes the app.
2. **Child windows** — Created at runtime via Tauri command (`create_session_window`, `create_monitor_window`). Can be closed independently.
3. **Window identity** — Each window gets a unique label (e.g., `session-{uuid}`, `monitor-1`). Labels are used for targeted event emission and capability scoping.

---

## 4. Window Types & Use Cases

### 4.1 Session Viewer Window (`session-{id}`)

**Purpose:** View a specific session in a dedicated, sidebar-free window. Ideal for side-by-side comparison or persistent monitoring of an active session.

**Features:**
- Loads directly into `SessionDetailView` for a specific session ID
- Includes all tabs (Overview, Conversation, Events, Todos, Metrics, Token Flow, Timeline)
- Optional SDK steering panel at bottom (if session is linked to bridge)
- Minimal chrome — no sidebar, compact breadcrumb
- Auto-refreshes if session is active (reuses existing `checkSessionFreshness` mechanism)

**How to open:** Right-click session card → "Open in New Window", or keyboard shortcut, or button in session detail header.

### 4.2 Session Monitor Dashboard (`monitor`)

**Purpose:** Real-time overview of multiple sessions simultaneously. Designed for users running several concurrent Copilot CLI agents.

**Features:**
- Configurable grid/tile layout (2×1, 2×2, 3×2, etc.)
- Each tile shows a compact session summary:
  - Session ID, repo, branch, model
  - Current status (running/idle/completed/errored)
  - Last turn preview
  - Token usage / turn count
  - Live event ticker (tail of recent events)
- Tiles can be session viewers, SDK session panels, or orchestrator status
- Click tile → focus/expand or open in dedicated session window
- **Alert integration** — tiles flash/highlight on key events (session end, ask_user, error)

### 4.3 SDK Steering Window (`sdk-steering-{session-id}`)

**Purpose:** Dedicated full-screen steering panel for an SDK-connected session. For power users who want to orchestrate a Copilot session entirely from within TracePilot.

**Features:**
- Full `ChatViewMode` conversation view with live event stream
- Prominent message input, mode/model selectors
- Session lifecycle controls (abort, destroy, unlink)
- Can be connected to either:
  - A **TCP `--ui-server`** session (steering a real terminal session)
  - A **STDIO** session (TracePilot spawns and owns the CLI subprocess)
- Event stream updates in real-time via existing `BridgeEvent` broadcast

---

## 5. Data Flow & State Synchronisation

### 5.1 The Isolation Problem

Tauri v2 windows run in isolated JavaScript contexts. Each window gets its own `index.html`, Vue app instance, Pinia stores, and `localStorage`. There is **no shared JS memory** between windows.

However, `localStorage` IS shared across windows with the same origin (all Tauri webviews serve from the same `tauri://localhost` origin). This is both an opportunity and a hazard.

### 5.2 Synchronisation Strategy

We use a **Rust-backend-as-truth + broadcast-event-sync** pattern:

```
Window A (changes theme)
    │
    ├─ 1. invoke("save_config", newConfig)  →  Rust backend
    │                                            │
    │                                            ├─ 2. Writes config.toml
    │                                            │
    │                                            └─ 3. app.emit("config-changed", configSnapshot)
    │                                                    │
    ├─ 4a. Window A hears event, updates local store  ◄──┤
    │                                                    │
    └─ 4b. Window B hears event, updates local store  ◄──┘
```

### 5.3 What Needs Cross-Window Sync

| Data | Sync Mechanism | Notes |
|------|---------------|-------|
| **Session list** | Event: `sessions-changed` after reindex | All windows refresh their session list |
| **Preferences/theme** | Event: `config-changed` + re-hydrate | Theme applies immediately via DOM |
| **Indexing progress** | Events: `indexing-*` (already global) | All windows see progress bars |
| **SDK bridge events** | Events: `sdk-bridge-event` (already global) | All windows receive session events |
| **SDK connection state** | Event: `sdk-connection-changed` (already global) | All windows update status indicators |
| **Session detail** | NOT synced — each window independently loads | Windows can view different sessions |
| **Search state** | NOT synced — per-window concern | Each window has its own search query |

### 5.4 New Events Required

```rust
// events.rs additions
pub const CONFIG_CHANGED: &str = "config-changed";
pub const SESSIONS_CHANGED: &str = "sessions-changed";
pub const WINDOW_CREATED: &str = "window-created";
pub const WINDOW_CLOSING: &str = "window-closing";
```

### 5.5 localStorage Considerations

Since all windows share `localStorage` (same origin `tauri://localhost`):
- **Theme cache** (`tracepilot-theme`) — shared, which is correct (instant theme on new window)
- **Last viewed session** (`tracepilot-last-session`) — ambiguous in multi-window; each window should track its own
- **SDK settings** (`tracepilot:sdk-settings`) — shared, which is correct (one bridge config)
- **What's New state** (`tracepilot-last-seen-version`) — shared, correct

Recommendation: Prefix window-specific localStorage keys with the window label (e.g., `tracepilot:session-abc:last-tab`).

---

## 6. SQLite Concurrency Analysis

### 6.1 Current Database Layout

TracePilot uses two categories of SQLite data:

| Database | File | Access Pattern | Connection Owner |
|---|---|---|---|
| **IndexDb** | `~/.tracepilot/index.db` | Read-heavy, occasional writes during reindex | Opened per-request in commands |
| **session.db** (per-session) | `<session_dir>/session.db` | Read-only via `open_readonly()` | Opened per-request, dropped after |

### 6.2 Why Multi-Window is Safe

**WAL mode** (Write-Ahead Logging), configured in `tracepilot-core::utils::sqlite::configure_connection()`:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
```

WAL mode enables:
- **Concurrent readers** — multiple windows can read `index.db` simultaneously
- **Reader doesn't block writer** — indexing can proceed while windows query
- **Writer doesn't block readers** — queries return data from a consistent snapshot
- **busy_timeout=5000** — if a writer lock is held, readers wait up to 5s before failing

**Session databases** (`session.db`) are opened read-only via `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX`, which creates zero contention.

### 6.3 Risk: `reindex_sessions_full`

The `reindex_sessions_full` command **deletes and recreates `index.db`** (plus WAL/SHM sidecar files). This is destructive and will fail if any other connection holds a reader:

```rust
// helpers.rs — current implementation
fn delete_index_files(db_path: &Path) -> Result<()> {
    remove_if_exists(db_path)?;          // index.db
    remove_if_exists(db_path_wal)?;       // index.db-wal
    remove_if_exists(db_path_shm)?;       // index.db-shm
    Ok(())
}
```

**Mitigation:**
1. Gate full reindex behind a coordination signal: emit `reindex-full-starting` event → all windows close any open IndexDb readers → proceed with delete → emit `reindex-full-complete` → windows re-query
2. The existing semaphore (`Arc<Semaphore>`) already prevents concurrent reindex operations
3. Since IndexDb connections are opened per-request (not held open), the window of contention is small

### 6.4 Risk: Config Write Races

`save_config()` reads config.toml → merges changes → writes back. If two windows save simultaneously:

```
Window A: read config → merge theme=dark → write
Window B: read config → merge scale=1.2 → write  (overwrites A's theme change)
```

**Resolution (from review feedback):** Replace `save_config(fullConfig)` with a **`patch_config` API** that performs atomic read-modify-write entirely in Rust:

```rust
pub type ConfigWriteLock = Arc<Mutex<()>>;

#[tauri::command]
async fn patch_config(
    app: AppHandle,
    section: String,         // e.g. "ui", "features", "alerts"
    patch: serde_json::Value, // partial update
    config_lock: State<'_, ConfigWriteLock>,
    shared_config: State<'_, SharedConfig>,
) -> Result<(), String> {
    let _guard = config_lock.lock().unwrap_or_else(|e| e.into_inner());
    // 1. Read current config from disk
    // 2. Deep-merge patch into the specified section
    // 3. Write to tempfile, then atomic rename
    // 4. Update SharedConfig
    // 5. app.emit("config-changed", &updated_config);
    Ok(())
}
```

The frontend sends only the diff, not the full config object. The lock wraps the entire read-modify-write cycle, eliminating the TOCTOU window. File writes use write-to-tempfile + rename for crash safety.

---

## 7. SDK Bridge Multi-Session Architecture

### 7.1 Current Model

```
BridgeManager (single instance)
    │
    ├── client: Option<copilot_sdk::Client>     ← one SDK client
    ├── sessions: HashMap<String, Arc<Session>>  ← multiple sessions
    ├── event_tx: broadcast::Sender<BridgeEvent> ← fan-out to all
    └── status_tx: broadcast::Sender<BridgeStatus>
```

The bridge already supports multiple concurrent sessions on one connection. Events include `session_id` for routing.

### 7.2 Multi-Window Event Routing

Since `app.emit()` broadcasts to ALL windows, every window receives every `BridgeEvent`. Each window filters by `session_id` in its local `sdk` store:

```typescript
// Already exists in sdk store
const sessionEvents = computed(() => {
  return (sessionId: string) =>
    recentEvents.value.filter((e) => e.sessionId === sessionId);
});
```

This is efficient — the Rust backend doesn't need per-window event routing.

### 7.3 Multiple STDIO Sessions

Currently the SDK can operate in two modes:
- **stdio** — spawns a private `copilot --server --stdio` subprocess
- **tcp** — connects to an existing `copilot --ui-server`

For power users wanting to steer multiple independent sessions, two architectures are viable:

#### Option A: Single TCP Connection, Multiple Sessions (Recommended)

```
TracePilot ──TCP──► copilot --ui-server (port 60381)
                         │
                         ├── Session A (user's terminal)
                         ├── Session B (created via SDK)
                         └── Session C (created via SDK)
```

**Pros:** Single connection, lower resource usage, steers real terminal sessions  
**Cons:** Requires `--ui-server` to be running; sessions share one CLI process

#### Option B: Multiple STDIO Subprocesses

```
TracePilot ──stdio──► copilot --server --stdio (PID 1001) → Session A
           ──stdio──► copilot --server --stdio (PID 1002) → Session B
           ──stdio──► copilot --server --stdio (PID 1003) → Session C
```

**Pros:** Full isolation, no external dependencies  
**Cons:** Higher memory/CPU, each session is a separate process

#### Recommended Hybrid: Multi-Bridge Architecture

Extend `BridgeManager` to support multiple named connections:

```rust
pub struct MultiBridgeManager {
    bridges: HashMap<String, BridgeManager>,  // "default", "stdio-1", "tcp-work"
    event_tx: broadcast::Sender<BridgeEvent>, // unified event stream
}
```

Each window can specify which bridge it's using. The default bridge auto-connects as today. Additional bridges can be created for dedicated STDIO sessions or connections to different `--ui-server` instances.

### 7.4 Session ↔ Window Affinity

Add a mapping of which window is "owning" (steering) which session:

```rust
pub type SessionWindowMap = Arc<RwLock<HashMap<String, String>>>;
// session_id -> window_label
```

This prevents two windows from sending conflicting messages to the same session. **Enforcement is Rust-side**, not just a frontend advisory check:

```rust
#[tauri::command]
async fn sdk_send_message(
    window: tauri::Window,  // Tauri injects the calling window
    session_id: String,
    message: String,
    affinity: State<'_, SessionWindowMap>,
    bridge: State<'_, SharedBridgeManager>,
) -> Result<(), String> {
    let map = affinity.read().await;
    if let Some(owner) = map.get(&session_id) {
        if owner != window.label() {
            return Err(format!("Session {} is owned by window {}", session_id, owner));
        }
    }
    // Proceed with send...
}
```

**Cleanup:** On window close (including abnormal termination), all entries for that window's label are removed from the map. Use `on_window_event` in `main.rs` for normal close, and a periodic heartbeat/TTL mechanism for crash recovery.

### 7.5 SDK Lifecycle: Coordinator-Window Model

> **Review finding:** Each window's SDK store fires `autoConnect()` on init. `BridgeManager::connect()`
> disconnects existing connections first. Multiple windows = connection churn.

**Design rule:** Only the `main` window may call `sdkConnect` and `sdkDisconnect`. Child windows:
- Read bridge status and session lists (via IPC commands)
- Listen to bridge events (via Tauri events broadcast)
- Send messages to sessions they own (via affinity-checked commands)
- CANNOT connect, disconnect, or modify bridge configuration

```typescript
// sdk store — guard lifecycle operations
async function sdkConnect(config: ConnectConfig) {
  const windowManager = useWindowManagerStore();
  if (windowManager.currentWindowRole !== "main") {
    console.warn("SDK connect/disconnect only allowed from main window");
    return;
  }
  // ... proceed with connection
}
```

---

## 8. Tauri Configuration Changes

### 8.1 Capabilities

Current `capabilities/default.json` scopes permissions to `windows: ["main"]`. For child windows to access Tauri commands, we need to expand this:

```json
{
  "identifier": "default",
  "description": "Default permissions for TracePilot",
  "windows": ["main", "session-*", "monitor-*", "sdk-steering-*"],
  "permissions": [
    "core:default",
    "tracepilot:default",
    "dialog:allow-open",
    "dialog:allow-save",
    "log:default",
    {
      "identifier": "opener:allow-open-url",
      "allow": [{ "url": "https://github.com/*" }, { "url": "https://api.github.com/*" }]
    },
    "process:allow-restart",
    "updater:default"
  ]
}
```

Note: Tauri v2 capabilities support glob patterns for window names, which is ideal for dynamically-labelled child windows.

### 8.2 New Tauri Commands

```rust
// commands/window.rs (new module)

#[tauri::command]
async fn create_session_window(
    app: tauri::AppHandle,
    session_id: String,
    title: Option<String>,
) -> Result<String, String> { ... }

#[tauri::command]
async fn create_monitor_window(
    app: tauri::AppHandle,
    layout: Option<String>,  // "2x1", "2x2", "3x2"
) -> Result<String, String> { ... }

#[tauri::command]
async fn close_window(
    app: tauri::AppHandle,
    label: String,
) -> Result<(), String> { ... }

#[tauri::command]
async fn list_open_windows(
    app: tauri::AppHandle,
) -> Result<Vec<WindowInfo>, String> { ... }
```

### 8.3 build.rs Updates

Add new window management commands to the `InlinedPlugin::commands()` list.

---

## 9. Frontend Architecture Changes

### 9.1 Window-Aware App Bootstrap

Each window loads the same `index.html` → `main.ts` → `App.vue`, but should detect its role:

```typescript
// main.ts or App.vue setup
import { getCurrentWindow } from "@tauri-apps/api/window";

const currentWindow = getCurrentWindow();
const windowLabel = currentWindow.label; // "main", "session-abc", "monitor-1"

// Dual-signal role detection: label prefix + URL parameter
const urlParams = new URLSearchParams(window.location.search);
const roleParam = urlParams.get("role");

const windowRole = roleParam
  ?? (windowLabel.startsWith("session-")
    ? "session-viewer"
    : windowLabel.startsWith("monitor")
      ? "monitor"
      : windowLabel.startsWith("sdk-steering-")
        ? "sdk-steering"
        : "main");
```

### 9.1.1 Role-Gated Bootstrap (Critical)

> **Review finding:** Without this, child windows will show the setup wizard, trigger
> `fetchSessions()`, show "What's New" modals, and start auto-refresh timers.

Child windows MUST skip the full `App.vue` `onMounted` bootstrap. Only `main` runs:
- `checkConfigExists()` / `SetupWizard`
- Update check
- "What's New" modal
- `sessionsStore.fetchSessions()` (child windows fetch only what they need)
- Auto-refresh timer registration

```typescript
// App.vue onMounted
if (windowRole === "main") {
  // Full bootstrap: config check, setup wizard, update check, etc.
  await runMainWindowBootstrap();
} else {
  // Minimal bootstrap: hydrate preferences (for theme), init window-specific stores
  await runChildWindowBootstrap(windowRole);
}
```

### 9.2 Window Role → Layout Mapping

| Role | Layout | Sidebar | Router Scope |
|------|--------|---------|-------------|
| `main` | Full SPA (current) | Yes | All routes |
| `session-viewer` | Session detail only | No | `/session/:id/*` only |
| `monitor` | Monitor dashboard | Minimal | `/monitor` only |
| `sdk-steering` | SDK steering panel | No | Custom steering view |

### 9.3 New Store: `windowManager`

```typescript
// stores/windowManager.ts
export const useWindowManagerStore = defineStore("windowManager", () => {
  const currentWindowLabel = ref("main");
  const currentWindowRole = ref<WindowRole>("main");
  const openWindows = ref<WindowInfo[]>([]);

  // Create a new session viewer window
  async function openSessionWindow(sessionId: string, title?: string) { ... }

  // Create the monitor dashboard
  async function openMonitorWindow(layout?: string) { ... }

  // List all open windows
  async function refreshWindowList() { ... }

  // Close a specific window
  async function closeWindow(label: string) { ... }

  return { currentWindowLabel, currentWindowRole, openWindows, ... };
});
```

### 9.4 Cross-Window Event Sync Layer

```typescript
// composables/useWindowSync.ts
export function useWindowSync() {
  // Listen for config changes from other windows
  safeListen("config-changed", (event) => {
    const prefs = usePreferencesStore();
    prefs.applyConfig(event.payload);
  });

  // Listen for session list changes
  safeListen("sessions-changed", () => {
    const sessions = useSessionsStore();
    sessions.refreshSessions();
  });
}
```

This composable is initialized once per window in `App.vue`.

### 9.5 Feature Flag

Add `multiWindow: boolean` to `TracePilotConfig.features`. Default: `false`. UI elements (context menu, buttons) to open new windows are hidden when disabled.

---

## 10. Rust Backend Changes

### 10.1 Window Management Commands

New command module `commands/window.rs`:

```rust
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub async fn create_session_window(
    app: AppHandle,
    session_id: String,
    title: Option<String>,
) -> Result<String, String> {
    let label = format!("session-{}", &session_id[..8]);
    let title = title.unwrap_or_else(|| format!("Session {}", &session_id[..8]));
    
    // URL includes the session ID as a route parameter
    let url = format!("index.html#/session/{}/overview", session_id);
    
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 500.0)
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;
    
    Ok(label)
}
```

### 10.2 Config Write Serialisation

```rust
// types.rs addition
pub type ConfigWriteLock = Arc<Mutex<()>>;

// lib.rs setup
let config_write_lock: ConfigWriteLock = Arc::new(Mutex::new(()));
app.manage(config_write_lock);
```

### 10.3 Post-Write Event Emission

After any config or session-list-changing operation, emit a sync event:

```rust
// In config_cmds.rs save_config handler
let _ = app.emit("config-changed", &config);

// In search.rs after reindex completes
let _ = app.emit("sessions-changed", ());
```

---

## 11. Edge Cases & Failure Modes

### 11.1 Main Window Close Behaviour

**Decision needed:** When the main window closes:
- **Option A (Recommended):** Close all child windows and quit the app. This is the simplest and matches user expectations for a desktop app.
- **Option B:** Prompt user to confirm if child windows are open. Keep running if child windows remain.

Implementation: Use `on_window_event` in `main.rs` to intercept the main window's close event.

### 11.2 Orphaned STDIO Sessions

If a window steering an STDIO session is closed, the child CLI process may be left running.

**Mitigation:** On window close, check for owned STDIO sessions and offer to:
1. Destroy the session (sends shutdown signal)
2. Unlink the session (leaves it running, detached)

### 11.3 Concurrent Full Reindex

Window A triggers `reindex_sessions_full` while Window B is reading `index.db`.

**Mitigation:**
1. Semaphore already prevents concurrent reindex operations
2. Add a "reindex starting" → "reindex complete" event pair
3. Windows temporarily suspend DB queries during full reindex (show spinner)
4. Per-request IndexDb connections mean the contention window is milliseconds

### 11.4 Two Windows Editing Same Config Section

Window A changes theme while Window B changes UI scale.

**Mitigation:** Both windows debounce saves (300ms). The `ConfigWriteLock` mutex ensures atomic read-modify-write. The `config-changed` event causes the non-writing window to re-hydrate, picking up both changes.

### 11.5 Memory Pressure

Each WebviewWindow creates an additional webview process. On Windows (WebView2), each window shares the same browser process but gets a renderer process (~50-100MB additional).

**Mitigation:**
- Default limit of 5 simultaneous windows (configurable)
- Show memory usage in monitor dashboard
- Warn user when approaching limit

### 11.6 Window Creation on Windows (Deadlock Risk)

Tauri documents that creating windows synchronously from event handlers on Windows can deadlock.

**Mitigation:** All window creation commands use `async` (`#[tauri::command] async fn`), which runs on the async runtime, not the main thread.

### 11.7 Hot-Reload / Dev Mode

During development with `cargo tauri dev`, Vite HMR updates apply to all windows simultaneously since they share the same dev server.

---

## 12. Risks of Running Multiple Instances

For context, here's why the current workaround (opening two TracePilot processes) is problematic:

| Risk | Severity | Explanation |
|------|----------|-------------|
| **IndexDb write contention** | 🔴 High | Two processes both trying to reindex simultaneously. WAL mode helps, but `reindex_sessions_full` (delete + recreate) will fail or corrupt if another process holds a reader. |
| **Config.toml races** | 🟠 Medium | Both processes read-modify-write the same config file. Last writer wins, losing the other's changes. |
| **Duplicate SDK bridges** | 🟠 Medium | Two STDIO subprocesses writing to the same `events.jsonl` — documented corruption risk. Two TCP connections to the same `--ui-server` could send conflicting session commands. |
| **Double memory usage** | 🟡 Low | Each Tauri process loads its own WebView2/wry, Rust runtime, and SQLite connections. ~200-400MB per instance. |
| **Stale lock files** | 🟡 Low | Both processes detect `inuse.*.lock` files but can't coordinate — one may incorrectly mark a session as "not running". |

The multi-window architecture eliminates all of these by keeping everything in one process.

---

## 13. Implementation Phases

> **Note:** These phases incorporate feedback from four independent architecture reviews
> (Opus 4.6, GPT 5.4, Codex 5.3, Sonnet 4.6). See `docs/reviews/consolidated-review-feedback.md`.

### Phase 0: Ownership Hardening (Prerequisite)

This phase resolves architectural prerequisites identified during review. Without these,
multi-window would introduce connection churn, config write races, and unbounded alert spam.

- **SDK lifecycle centralization (coordinator-window model):** Only the `main` window may call `sdkConnect`/`sdkDisconnect`. Child windows are read-only consumers of bridge state. Gate SDK store lifecycle actions behind `windowRole === 'main'`.
- **`patch_config` atomic RMW API:** Replace the current `save_config(fullConfig)` pattern with a Rust-side `patch_config(section, patch)` command that acquires a lock → reads current config → merges the patch → writes atomically → emits `config-changed`. Eliminates the TOCTOU window between frontend read and write.
- **Atomic config file writes:** Use write-to-tempfile + rename pattern in `config.rs::save_to()` to prevent crash-time truncation.
- **Config schema updates:** Add `multiWindow` and `sessionAlerts` to `TracePilotConfig.features` (TypeScript), `FeaturesConfig` (Rust), bump `CONFIG_VERSION`, and add a migration path.
- **Backend session affinity enforcement:** Add `SessionWindowMap = Arc<RwLock<HashMap<String, String>>>` to managed state. `sdk_send_message` and `sdk_abort_session` commands check affinity before delegating. Requests from non-owning windows are rejected.
- **Bridge lock contention mitigation:** Add a `ConnectionState` enum (`Connecting`, `Connected`, `Disconnected`) so read-lock callers can check state without waiting for the write lock during handshake.

### Phase 1: Window Infrastructure

- Create `commands/window.rs` with `create_session_window`, `close_window`, `list_open_windows`
- Update `build.rs` with new commands
- Create **per-role capabilities** (narrow, not widened default): session viewers don't inherit updater/process/open-url permissions
- Add new backend events (`config-changed`, `sessions-changed`, `window-created`, `window-closing`)
- Add dedicated high-priority broadcast channel (capacity 64) for lifecycle events that must never lag
- **Verify capability glob patterns** (`session-*`) explicitly — failures are silent

### Phase 2: Frontend Window Awareness

- Detect window role from label + URL `?role=` parameter (dual-signal for robustness)
- **Role-gated App.vue bootstrap:** Child windows MUST skip: setup wizard check, update check, What's New modal, `fetchSessions()`, and auto-refresh registration. Only `main` runs the full bootstrap.
- Create `stores/windowManager.ts`
- Create `composables/useWindowSync.ts` for cross-window event sync
- Implement conditional layout rendering based on window role (sidebar vs no-sidebar)
- Add "Open in New Window" context menu / button (gated behind `features.multiWindow`)

### Phase 3: Session Viewer Windows

- Implement the session viewer window type (sidebar-free, direct-to-session routing)
- Ensure `sessionDetail` store works independently per window
- **Same-session duplicate detection:** If a window for session X already exists, focus it instead of creating a duplicate
- Add window title updates based on session summary
- Handle window close cleanup (release session affinity, including abnormal termination)
- Use safe window label generation: `session_id.get(..8).unwrap_or(&session_id)` with UUID fallback

### Phase 4: Monitor Dashboard

- Design monitor dashboard layout (grid/tile system)
- Create compact session tile component
- Implement multi-session event stream aggregation
- Add tile configuration (select sessions, choose layout)
- Integrate notification/alerting hooks (see separate alerting document)
- **Depends on:** Alerting Phase 1 (core infrastructure) for tile-level indicators

### Phase 5: SDK Steering Windows

- Per-window session affinity with **Rust-side enforcement**
- Create dedicated steering window type with full conversation + controls
- Add STDIO session spawning from steering window
- **Foreground session warnings:** In TCP mode, warn user that steering changes CLI TUI focus
- Multi-bridge architecture deferred to separate RFC (single-bridge sufficient for v1)

---

## 14. Open Questions

1. **Window persistence** — Should open windows be restored on app relaunch? (Requires saving window state to config.)
2. **Drag-and-drop tiles** — Should the monitor dashboard support drag-to-rearrange? (Adds complexity.)
3. **Cross-window navigation** — Should clicking a session in the monitor open it in the main window or a new window?
4. **Limit on child windows** — Hard limit (5?) or soft warning?
5. **Multi-bridge vs single-bridge** — Is the current single `BridgeManager` sufficient, or do we need named bridge instances for true STDIO isolation?
