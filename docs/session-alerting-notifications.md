# Session Alerting & Notification System

> **Status:** RFC / Design Document  
> **Author:** Copilot (research-assisted)  
> **Date:** 2026-04-13  
> **Scope:** Session lifecycle alerts, Windows taskbar flash, OS toast notifications, in-app visual indicators  
> **Related:** [Multi-Window Architecture](./multi-window-architecture.md)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Notification Channels](#2-notification-channels)
3. [Alertable Events](#3-alertable-events)
4. [Architecture](#4-architecture)
5. [Implementation Details](#5-implementation-details)
6. [Configuration & User Preferences](#6-configuration--user-preferences)
7. [Platform Considerations](#7-platform-considerations)
8. [Integration with Multi-Window](#8-integration-with-multi-window)
9. [Edge Cases](#9-edge-cases)
10. [Implementation Phases](#10-implementation-phases)

---

## 1. Overview

TracePilot users often run Copilot CLI sessions in the background while working in their IDE or browser. When a session completes, errors out, or prompts the user via `ask_user`, there's currently no way to be notified without manually switching to the TracePilot window.

This document designs an **opt-in alerting system** that notifies users through multiple channels when important session events occur. The system is designed to be non-intrusive, highly configurable, and integrated with both the single-window and multi-window architectures.

### Key Principles

1. **Opt-in by default** — No alerts fire until the user explicitly enables them
2. **Per-event granularity** — Users choose which events trigger which notification types
3. **Non-disruptive** — Taskbar flash and toasts don't steal focus; in-app indicators are subtle
4. **Cross-platform where possible** — Toast notifications work on all platforms; taskbar flash is Windows-specific with macOS dock bounce equivalent

---

## 2. Notification Channels

### 2.1 Taskbar Flash (Windows) / Dock Bounce (macOS)

The most subtle notification. The app's taskbar icon flashes orange (Windows) or bounces in the Dock (macOS) without stealing focus.

**Windows implementation:** Win32 `FlashWindowEx` API via the `windows` crate:
```rust
use windows::Win32::UI::WindowsAndMessaging::{
    FlashWindowEx, FLASHWINFO, FLASHW_TRAY, FLASHW_TIMERNOFG,
};

fn flash_taskbar(hwnd: windows::Win32::Foundation::HWND, count: u32) {
    let mut info = FLASHWINFO {
        cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
        hwnd,
        dwFlags: FLASHW_TRAY | FLASHW_TIMERNOFG,
        uCount: count,
        dwTimeout: 0, // use system default
    };
    unsafe { FlashWindowEx(&mut info); }
}
```

**Cross-platform alternative:** Tauri's `Window::request_user_attention()` API wraps platform-specific attention requests:
- Windows: `FlashWindowEx`
- macOS: `NSApplication::requestUserAttention`
- Linux: `gtk_window_set_urgency_hint` (on supported WMs)

```rust
use tauri::UserAttentionType;
window.request_user_attention(Some(UserAttentionType::Informational))?;
// UserAttentionType::Critical for more urgent alerts
```

**Recommendation:** Use Tauri's cross-platform `request_user_attention()` as the primary API, with direct `FlashWindowEx` as a fallback for fine-tuned control (flash count, duration).

### 2.2 Windows Toast Notifications

Native OS notifications that appear in the Windows notification centre (or macOS Notification Center, Linux notification daemon).

**Implementation:** `tauri-plugin-notification`:
```rust
// Rust side
use tauri_plugin_notification::NotificationExt;
app.notification()
    .builder()
    .title("Session Complete")
    .body("copilot-session-abc finished (42 turns, 15K tokens)")
    .icon("app-icon")  // uses app icon
    .show()?;
```

```typescript
// Frontend side (alternative)
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

if (await isPermissionGranted()) {
  sendNotification({
    title: "Session Complete",
    body: "copilot-session-abc finished",
  });
}
```

**Features:**
- Title, body, optional icon
- Clicking the notification brings the app to focus
- Appears in Windows notification history
- Can include action buttons (limited platform support)

### 2.3 In-App Visual Indicators

For when the app IS visible but the relevant content is off-screen or in another tab:

- **Sidebar badge** — Red dot/count on the Sessions nav item
- **Toast notification** — TracePilot's existing `ToastContainer` with auto-dismiss
- **Session card highlight** — Brief pulse/glow animation on the affected session's card
- **Monitor tile flash** — In the monitor dashboard, the tile flashes or gets a colored border
- **Sound** — Optional short audio cue (configurable, off by default)

---

## 3. Alertable Events

### 3.1 Event Taxonomy

| Event | Source | Urgency | Default Channel | Description |
|-------|--------|---------|-----------------|-------------|
| **Session ended** | `session.shutdown` event in `events.jsonl` | Medium | Taskbar flash + in-app toast | A monitored session finished normally |
| **Session errored** | Error event or unexpected shutdown | High | Toast notification + taskbar flash | A session crashed or hit a fatal error |
| **Ask user prompt** | `ask_user` tool call detected | High | Toast notification + taskbar flash | The agent is waiting for user input |
| **Rate limit hit** | `conversation.rateLimitInfo` event | Medium | In-app toast only | Token/request limit reached |
| **Subagent completed** | Subagent lifecycle events | Low | In-app indicator only | A background task agent finished |
| **Orchestrator task done** | Task status change | Medium | Taskbar flash + in-app toast | An AI task completed |
| **Reindex complete** | `indexing-finished` event | Low | In-app toast only | Background reindex finished |

### 3.2 Event Detection

Events are detected through **backend-centralised** mechanisms:

1. **SDK bridge events (real-time)** — `BridgeEvent` stream carries session lifecycle events. The Rust `AlertDispatcher` subscribes directly to the bridge broadcast channel for instant detection of session end, error, and ask_user events.
2. **Backend session watcher (for non-SDK sessions)** — A Rust-side worker periodically checks `events.jsonl` for watched sessions using file mtime + size. This runs independently of any window being open, enabling alerts even when no session detail view is active.
3. **Index-time detection** — During reindex, new session states (completed, errored) are detected and forwarded to the AlertDispatcher.

> **Review finding:** All detection MUST happen in Rust. Frontend windows only render alerts received
> via Tauri events. This eliminates duplicate alerts from multiple windows and ensures alerts fire
> even when no window is viewing the relevant session.

For **`ask_user` detection** in non-SDK sessions (Path 2: backend watcher):
```rust
// In the backend session watcher
fn check_session_for_ask_user(session_dir: &Path) -> Option<AlertCandidate> {
    let events_path = session_dir.join("events.jsonl");
    // Read last N lines, parse turns, check for ask_user tool call without result
    // Only alert if file has changed since last check (mtime/size fingerprint)
}
```

> **Startup baseline:** On first poll cycle after app launch, the watcher records fingerprints
> for all watched sessions without firing alerts. This prevents a flood of alerts for sessions
> that were already in a waiting state before TracePilot started.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Rust Backend                          │
│                                                         │
│  ┌─────────────────┐    ┌──────────────────────┐       │
│  │ BridgeManager   │    │ AlertDispatcher       │       │
│  │ (SDK events)    │───►│                      │       │
│  └─────────────────┘    │  - evaluate rules    │       │
│                         │  - check cooldowns   │       │
│  ┌─────────────────┐    │  - dispatch:         │       │
│  │ IndexDb/Session  │───►│    ├─ flash_window() │       │
│  │ (lifecycle)     │    │    ├─ send_toast()   │       │
│  └─────────────────┘    │    └─ emit_event()   │       │
│                         └──────────┬───────────┘       │
│                                    │                    │
│                    app.emit("alert", payload)           │
│                                    │                    │
└────────────────────────────────────┼────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────┐
              │                      │                   │
     ┌────────┴────────┐  ┌─────────┴────────┐  ┌──────┴──────┐
     │   Main Window    │  │  Session Window   │  │  Monitor    │
     │                  │  │                   │  │             │
     │  toast/badge     │  │  toast/highlight  │  │  tile flash │
     └─────────────────┘  └──────────────────┘  └─────────────┘
```

### 4.1 AlertDispatcher (Rust)

A new module in `tracepilot-tauri-bindings`:

```rust
pub struct AlertDispatcher {
    config: AlertConfig,
    cooldowns: HashMap<String, Instant>,  // event_key -> last_alert_time
}

pub struct AlertConfig {
    pub enabled: bool,
    pub rules: Vec<AlertRule>,
}

pub struct AlertRule {
    pub event_type: AlertEventType,
    pub channels: Vec<AlertChannel>,
    pub cooldown_seconds: u32,       // prevent alert spam
    pub session_filter: Option<Vec<String>>,  // only for specific sessions
}

pub enum AlertChannel {
    TaskbarFlash { count: u32 },
    ToastNotification,
    InAppEvent,          // emits to frontend for toast/badge
    Sound { sound_id: String },
}

pub enum AlertEventType {
    SessionEnded,
    SessionErrored,
    AskUserPrompt,
    RateLimitHit,
    SubagentCompleted,
    OrchestratorTaskDone,
    ReindexComplete,
}
```

### 4.2 Event Flow

1. **Trigger source** (SDK event / backend session watcher / reindex) generates an alert candidate
2. **AlertDispatcher** (Rust, singleton) checks:
   - Is alerting enabled globally?
   - Does this event type have a matching rule?
   - Is the cooldown period elapsed? (keyed by `(event_type, session_id)`)
   - Is the app window already focused? (suppress flash/toast if so)
   - **Startup baseline:** Was this detected on the first poll cycle? (suppress if so)
3. **Dispatch** to configured channels:
   - Taskbar flash → calls `request_user_attention()` on target window(s)
   - Toast → calls `tauri-plugin-notification`
   - In-app → emits `session-alert` Tauri event for frontend handling
4. **All deduplication and cooldown logic lives in the Rust AlertDispatcher** — frontend windows never decide whether an alert should fire

> **Review finding:** The broadcast channel for bridge events (capacity 512) can lag under high
> throughput, silently dropping events (including lifecycle events). A dedicated high-priority
> channel (capacity 64) is used for alert-critical lifecycle events (`session.shutdown`,
> `session.error`, `ask_user`) to prevent missed alerts.

---

## 5. Implementation Details

### 5.1 Rust: Alert Command & Dispatcher

```rust
// commands/alerts.rs

#[tauri::command]
pub async fn configure_alerts(
    app: tauri::AppHandle,
    config: AlertConfig,
    alert_state: tauri::State<'_, SharedAlertDispatcher>,
) -> Result<(), String> {
    let mut dispatcher = alert_state.lock().unwrap_or_else(|e| e.into_inner());
    dispatcher.update_config(config);
    Ok(())
}

#[tauri::command]
pub async fn test_alert(
    app: tauri::AppHandle,
    channel: String,
) -> Result<(), String> {
    // Fire a test notification for configuration verification
    match channel.as_str() {
        "flash" => {
            if let Some(window) = app.get_webview_window("main") {
                window.request_user_attention(Some(tauri::UserAttentionType::Informational))
                    .map_err(|e| e.to_string())?;
            }
        }
        "toast" => {
            // tauri-plugin-notification
        }
        _ => {}
    }
    Ok(())
}
```

### 5.2 Frontend: Alert Composable

```typescript
// composables/useAlerts.ts
export function useAlerts() {
  const prefs = usePreferencesStore();

  // Listen for alert events from backend
  safeListen<AlertPayload>("session-alert", (event) => {
    const { eventType, sessionId, message, channels } = event.payload;

    if (channels.includes("in-app-toast")) {
      showToast({ type: "info", title: eventType, message });
    }

    if (channels.includes("badge")) {
      // Update sidebar badge count
      incrementAlertBadge();
    }

    if (channels.includes("session-highlight")) {
      // Trigger CSS animation on session card
      highlightSession(sessionId);
    }
  });
}
```

### 5.3 Ask-User Detection

The `ask_user` detection is particularly valuable. Two detection paths:

**Path 1: SDK Bridge (real-time, for steered sessions)**
```rust
// In bridge event forwarder
if let BridgeEvent::ToolCall { tool_name, .. } = &event {
    if tool_name == "ask_user" {
        dispatcher.fire(AlertEventType::AskUserPrompt, session_id);
    }
}
```

**Path 2: Freshness polling (for non-steered, file-watched sessions)**
```typescript
// In sessionDetail.refreshTurns() or a dedicated watcher
const lastTurn = turns[turns.length - 1];
const pendingAskUser = lastTurn?.toolCalls.find(
  tc => tc.toolName === "ask_user" && !tc.result
);
if (pendingAskUser) {
  emit("session-alert", {
    eventType: "ask_user",
    sessionId,
    message: pendingAskUser.arguments?.question ?? "Agent is waiting for input",
  });
}
```

### 5.4 Toast Notification Plugin Setup

Add `tauri-plugin-notification` to the app:

```toml
# apps/desktop/src-tauri/Cargo.toml
[dependencies]
tauri-plugin-notification = "2"
```

```rust
// main.rs
tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    // ...
```

```json
// capabilities/default.json — add permission
"notification:default"
```

---

## 6. Configuration & User Preferences

### 6.1 Config Schema Addition

```typescript
// In TracePilotConfig
alerts: {
  /** Master toggle for all alerting */
  enabled: boolean;
  /** Alert when any monitored session ends */
  onSessionEnd: AlertChannelConfig;
  /** Alert when a session hits an error */
  onSessionError: AlertChannelConfig;
  /** Alert when an agent prompts via ask_user */
  onAskUser: AlertChannelConfig;
  /** Alert when a rate limit is hit */
  onRateLimit: AlertChannelConfig;
  /** Alert when an orchestrator task completes */
  onTaskComplete: AlertChannelConfig;
  /** Cooldown between repeated alerts of the same type (seconds) */
  cooldownSeconds: number;
  /** Only alert for sessions in this list (empty = all) */
  watchedSessionIds: string[];
  /** Play sound with alerts */
  soundEnabled: boolean;
};

interface AlertChannelConfig {
  enabled: boolean;
  taskbarFlash: boolean;
  toastNotification: boolean;
  inAppToast: boolean;
}
```

### 6.2 Settings UI

Add an "Alerts & Notifications" section in `SettingsView`:

```
┌─────────────────────────────────────────────┐
│  🔔 Alerts & Notifications                  │
│                                              │
│  [x] Enable session alerts                   │
│                                              │
│  When a session ends:                        │
│    [x] Flash taskbar     [ ] Toast notif     │
│    [x] In-app toast                          │
│                                              │
│  When agent asks for input (ask_user):       │
│    [x] Flash taskbar     [x] Toast notif     │
│    [x] In-app toast                          │
│                                              │
│  When a session errors:                      │
│    [x] Flash taskbar     [x] Toast notif     │
│    [x] In-app toast                          │
│                                              │
│  Alert cooldown: [30] seconds                │
│  [ ] Play sound with alerts                  │
│                                              │
│  [Test Flash]  [Test Toast]  [Test Sound]    │
└─────────────────────────────────────────────┘
```

### 6.3 Feature Flag

Gate behind `features.sessionAlerts`. Default: `false` initially for safe rollout.

---

## 7. Platform Considerations

### 7.1 Windows

| Channel | API | Notes |
|---------|-----|-------|
| Taskbar flash | `request_user_attention()` → `FlashWindowEx` | Flashes orange until window is focused |
| Toast | `tauri-plugin-notification` → WinRT `ToastNotification` | Appears in Action Centre |
| Sound | `PlaySoundW` or embedded audio element | System sounds available |

### 7.2 macOS

| Channel | API | Notes |
|---------|-----|-------|
| Dock bounce | `request_user_attention()` → `requestUserAttention:` | Bounces once (informational) or continuously (critical) |
| Banner/notification | `tauri-plugin-notification` → `UNUserNotificationCenter` | Requires notification permission |
| Sound | `NSSound` | System sounds available |

### 7.3 Linux

| Channel | API | Notes |
|---------|-----|-------|
| Window urgency | `request_user_attention()` → `set_urgency_hint` | WM-dependent (some highlight in taskbar) |
| Notification | `tauri-plugin-notification` → `libnotify` / `notify-send` | Desktop environment dependent |
| Sound | `paplay` or `aplay` | Depends on audio system |

### 7.4 Focus Detection

Only fire taskbar flash / toast when the app is NOT focused:

```rust
// Check if any TracePilot window is focused
fn is_any_window_focused(app: &AppHandle) -> bool {
    for (_, window) in app.webview_windows() {
        if window.is_focused().unwrap_or(false) {
            return true;
        }
    }
    false
}
```

---

## 8. Integration with Multi-Window

### 8.1 Which Window to Flash?

When multiple windows are open:
- If the alert is session-specific and a window is viewing that session → flash that window
- If no specific window is viewing the session → flash the main window
- For general alerts (reindex complete) → flash the main window

### 8.2 Monitor Dashboard Integration

The monitor dashboard gets special alert integration:
- **Tile-level indicators** — each tile shows a status badge (green=running, yellow=waiting, red=error, grey=idle)
- **Tile flash** — when an alertable event fires, the relevant tile gets a brief CSS animation
- **Aggregated alert count** — dashboard header shows total pending alerts

### 8.3 Alert Routing

```rust
fn route_alert(app: &AppHandle, session_id: &str, alert: &AlertPayload) {
    // 1. Find windows viewing this session
    let target_windows: Vec<String> = find_windows_for_session(app, session_id);
    
    if target_windows.is_empty() {
        // 2. No specific window — alert the main window
        if let Some(main) = app.get_webview_window("main") {
            main.request_user_attention(Some(UserAttentionType::Informational)).ok();
        }
    } else {
        // 3. Alert specific windows
        for label in &target_windows {
            if let Some(window) = app.get_webview_window(label) {
                window.request_user_attention(Some(UserAttentionType::Informational)).ok();
            }
        }
    }
    
    // 4. Always emit the event globally (all windows get the in-app notification)
    let _ = app.emit("session-alert", alert);
}
```

---

## 9. Edge Cases

### 9.1 Alert Spam

A session ending and restarting rapidly (e.g., CI loop) could generate hundreds of alerts.

**Mitigation:** Cooldown per event type per session (default: 30 seconds). The `AlertDispatcher` tracks `(event_type, session_id) -> last_alert_time` and suppresses duplicates.

### 9.2 Notification Permissions

On macOS and Linux, toast notifications require explicit user permission.

**Mitigation:** On first enable of toast notifications, check permission and prompt if needed. Show status in settings ("Notifications: Permitted" / "Notifications: Not Permitted — click to request").

### 9.3 Stale Session Detection

If TracePilot detects a session ended via staleness (file mtime unchanged for N minutes + lock file gone), the "session ended" alert should be fired but marked as "detected" vs "observed" (since we didn't witness the actual shutdown event).

### 9.4 App in Background / Minimised

When the app is minimised:
- Taskbar flash works correctly (that's its primary use case)
- Toast notifications work correctly (OS-level)
- In-app toasts queue and display when the window regains focus

### 9.5 Do Not Disturb / Focus Assist

Windows Focus Assist and macOS Do Not Disturb suppress toast notifications at the OS level. Taskbar flash may also be suppressed.

**Mitigation:** Document this in the settings UI. Consider offering a "in-app only" mode that bypasses OS notification systems.

---

## 10. Implementation Phases

> **Note:** These phases incorporate feedback from four independent architecture reviews
> (Opus 4.6, GPT 5.4, Codex 5.3, Sonnet 4.6). See `docs/reviews/consolidated-review-feedback.md`.
> **Cross-document dependency:** Phase 4 is blocked on Multi-Window Architecture Phase 5 (Monitor Dashboard).

### Phase 1: Core Alert Infrastructure + Detection (Backend-First)

- Add `tauri-plugin-notification` dependency and plugin registration
- Add `notification:default` to capabilities
- Create `AlertDispatcher` in Rust backend with rule evaluation + cooldowns + dedup
- **Create backend session watcher** — Rust worker that periodically checks `events.jsonl` for watched sessions (mtime + size fingerprint). This enables alerting for non-SDK sessions even when no window views them.
- **Startup baseline:** On first poll cycle, record fingerprints without firing alerts
- Wire SDK bridge events to AlertDispatcher (session end, error, ask_user)
- Wire reindex completion events to AlertDispatcher
- Add dedicated high-priority broadcast channel (capacity 64) for lifecycle events
- Add `session-alert` Tauri event
- Implement `request_user_attention()` wrapper (cross-platform taskbar flash)
- Add `configure_alerts`, `test_alert`, `trigger_alert` commands
- Update `build.rs` and capabilities for new commands + notification permission
- Add `sessionAlerts` feature flag (TS + Rust `FeaturesConfig` + `CONFIG_VERSION` bump)
- **Note:** Windows toast notifications only work reliably in installed builds, not dev mode

### Phase 2: Frontend Alert UI

- Create `composables/useAlerts.ts` for global alert listening (render-only, no detection logic)
- Add alert settings section to `SettingsView`
- Implement in-app toast alerts via existing `ToastContainer`
- Add sidebar badge counter for unread alerts
- Add "Test" buttons in settings (flash, toast, sound)
- Show notification permission status on macOS/Linux

### Phase 3: Advanced Detection

- Wire orchestrator task completion events to AlertDispatcher
- Investigate `notify` crate for file system watching as alternative to polling
- Add per-session watch/unwatch from session list context menu

### Phase 4: Multi-Window Integration

> **Blocked on:** Multi-Window Architecture Phase 5 (Monitor Dashboard)

- Implement per-window alert routing (flash the relevant window via `SessionWindowMap`)
- Add monitor dashboard tile-level alert indicators
- Implement alert aggregation in monitor dashboard header
- Split into:
  - **4a:** Per-window flash routing (depends on Multi-Window Phase 2 only)
  - **4b:** Monitor tile integration (depends on Multi-Window Phase 5)

### Phase 5: Polish & Advanced

- Add sound alerts with configurable audio
- Add alert history log (in-app, scrollable ring buffer)
- Consider system tray icon with alert badge (stretch goal)
