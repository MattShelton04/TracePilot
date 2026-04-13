# Multi-Window & Alerting — Implementation Plan

> **Status:** Implementation Plan (RFC) — **Amended post-review**  
> **Date:** 2026-04-13  
> **Prerequisite:** [Multi-Window Architecture](./multi-window-architecture.md) · [Alerting Design](./session-alerting-notifications.md)  
> **Reviews:** [Consolidated Feedback](./reviews/consolidated-plan-review.md) · [Opus](./reviews/opus-plan-review.md) · [GPT](./reviews/gpt-plan-review.md) · [Codex](./reviews/codex-plan-review.md) · [Sonnet](./reviews/sonnet-plan-review.md)

---

> ### ⚠️ Post-Review Amendments (§10)
> 
> Four independent model reviews (Opus 4.6, GPT 5.4, Codex 5.3, Sonnet 4.6) identified **3 critical** and **8 high-severity** issues. Section 10 details all amendments. Key changes:
> 
> 1. **Phase 1.0 added:** `useSessionDetailStore` must be rewritten as a per-instance composable before tabs can work — it's a Pinia singleton that can't serve multiple tabs
> 2. **Inner tab routing replaced:** `<router-view>` inside `SessionDetailView` replaced with local `activeSubTab` state + `<component :is>` dynamic rendering
> 3. **Child window URL scheme changed:** `#role=viewer` conflicts with hash router → use Tauri window label for role detection instead
> 4. **`patch_config` redesigned:** Raw JSON deep-merge → typed section-scoped patch structs
> 5. **Bridge lock refactored:** Lock held across `.await` → clone-release-await pattern

---

## 1. Critical Analysis: Which UIs Do We Actually Need?

### What We're Building vs What We're NOT

The prototype exploration produced 8 UI concepts. After analyzing them against the actual codebase and use patterns, here's what survives the cut:

| Prototype | Verdict | Reasoning |
|---|---|---|
| **Tabbed Sessions** | ✅ **BUILD** | Reuses existing `SessionDetailView` + tab components. Highest value/effort ratio. Single-window, no Tauri config changes needed initially. |
| **Session Viewer (popup)** | ✅ **BUILD** (later) | Important for monitor-then-drill-down workflow. But the tabbed view covers 80% of the use case first. |
| **Alert Center Drawer** | ✅ **BUILD** | Overlay component, works in any window. High value for monitoring workflows. |
| **Alert Settings** | ✅ **BUILD** | New tab in existing `SettingsView`. Minimal new UI surface. |
| **Monitor Dashboard** | ⚠️ **DEFER** | Nice-to-have. The tabbed view + alert center covers most monitoring needs. Build when multi-window infra exists. |
| **Window Manager Panel** | ❌ **SKIP** | Over-engineered. Windows are managed via context menu / toolbar buttons, not a dedicated page. |
| **SDK Control Panel** | ❌ **SKIP** | Power-user debug view. The existing SDK settings + SdkSteeringPanel cover this. Expand those instead. |
| **Interactive Demo** | N/A | Prototype-only, not a real feature. |

### Key Principle: Extend, Don't Invent

The existing codebase has **excellent building blocks** that should be reused:

- `SessionDetailView` + its 6 tab children → reuse as-is inside tabs
- `SdkSteeringPanel` → extend with session-scoped bridge awareness
- `SettingsView` → add "Notifications" tab alongside existing 9 tabs
- `AppSidebar` → add alert bell icon + tab count badge
- `SearchPalette` → pattern to follow for keyboard-driven window management
- `BreadcrumbNav` → extend to show window/tab context

---

## 2. SDK Multi-Session Architecture: The Core Challenge

### Current Limitation

The `BridgeManager` holds **one** `copilot_sdk::Client` which maps to **one** connection (either one STDIO subprocess or one TCP socket). Multiple SDK sessions CAN exist within that single connection — `create_session()` and `resume_session()` add sessions to the `HashMap<String, Arc<Session>>`.

**This already supports multiple concurrent sessions** on a single bridge. The issue isn't multiple sessions — it's:

1. **STDIO mode**: One private CLI subprocess handles all sessions. If it crashes, all sessions die.
2. **TCP mode**: One `--ui-server` connection. Works for observing, but `set_foreground_session` can only have one foreground at a time.
3. **No session-scoped isolation**: A single bridge's broadcast channel mixes events from all sessions. Frontends filter by `sessionId`, which works fine.

### What Multi-Session Actually Needs

```
Current:                          Proposed (Phase 1):
┌─────────────────┐              ┌─────────────────┐
│  BridgeManager  │              │  BridgeManager  │
│  client: Client │              │  client: Client │  (still single client)
│  sessions: {    │              │  sessions: {    │
│    "abc": Sess  │              │    "abc": Sess  │  ← tab 1
│  }              │              │    "def": Sess  │  ← tab 2
│                 │              │    "ghi": Sess  │  ← tab 3
└─────────────────┘              └─────────────────┘

                                 Proposed (Phase 3 — future):
                                 ┌──────────────────────────┐
                                 │     BridgeRegistry       │
                                 │  bridges: {              │
                                 │    "default": Bridge,    │  ← stdio, main sessions
                                 │    "tcp-1": Bridge,      │  ← --ui-server A
                                 │    "tcp-2": Bridge,      │  ← --ui-server B
                                 │  }                       │
                                 └──────────────────────────┘
```

**Phase 1** (what we're building): The existing single-client/multi-session model **already works**. We just need:
- Frontend to track which tab/window owns which session
- `SdkSteeringPanel` per tab, each bound to its own `sessionId`
- Events already filtered by `sessionId` in `sessionEvents` computed

**Phase 3** (future, if needed): `BridgeRegistry` that manages multiple `BridgeManager` instances, each potentially connecting to different CLI subprocesses or `--ui-server` instances. This is the "link separate STDIO sessions for full control" feature — each tab/window could connect to its own CLI process.

### Why Single-Bridge Is Fine For Now

The SDK client already multiplexes sessions over one connection. Creating a session via `create_session()` returns a session handle with its own event stream. The broadcast channel tags events with `sessionId`. Each tab filters to its session. **No cross-contamination.**

The only operation that's truly global is `set_foreground_session()` (TCP mode), which tells the CLI TUI which session is "active". This is cosmetic and doesn't affect event routing.

---

## 3. Implementation Phases

### Phase 0: Foundation Hardening (Pre-requisite)

**Goal:** Fix ownership issues in the current codebase that would break under multi-tab scenarios. No new UI surfaces.

#### 0.1 — Role-Gated App Bootstrap

**Problem:** `App.vue:onMounted` runs setup wizard check, `fetchSessions()`, update check, What's New modal for every Vue instance. In multi-window, child windows would duplicate all of this.

**Solution:** Add a `windowRole` concept derived from URL hash parameter.

**Files changed:**
- `apps/desktop/src/App.vue` — Gate `onMounted` logic on role
- `apps/desktop/src/composables/useWindowRole.ts` (NEW) — Parse `#role=viewer` from URL hash

```typescript
// composables/useWindowRole.ts
export type WindowRole = 'main' | 'viewer' | 'monitor';
export function useWindowRole(): { role: WindowRole; sessionId: string | null } {
  const hash = window.location.hash; // e.g. #role=viewer&session=abc-123
  const params = new URLSearchParams(hash.replace(/^#\/?/, ''));
  const role = (params.get('role') as WindowRole) || 'main';
  const sessionId = params.get('session');
  return { role, sessionId };
}
```

**App.vue changes:**
```typescript
const { role } = useWindowRole();
onMounted(async () => {
  if (role !== 'main') {
    // Child windows: skip setup wizard, update check, What's New
    phase.value = 'app';
    return;
  }
  // ... existing main window bootstrap
});
```

#### 0.2 — Atomic Config Writes (patch_config)

**Problem:** Multiple tabs watching preferences can trigger concurrent `saveConfig(fullConfig)` calls, causing TOCTOU race.

**Solution:** Replace `saveConfig(full)` with `patchConfig(partial)` that does read-modify-write atomically in Rust.

**Files changed:**
- `crates/tracepilot-tauri-bindings/src/commands/config_cmds.rs` — Add `patch_config` command
- `packages/client/src/invoke.ts` — Add `patchConfig()` function
- `packages/types/src/config.ts` — Add `PartialTracePilotConfig` type
- `apps/desktop/src/stores/preferences.ts` — Replace `saveConfig(full)` with `patchConfig(partial)`

**Rust side:**
```rust
#[tauri::command]
pub async fn patch_config(
    patch: serde_json::Value, // partial config JSON
    config: tauri::State<'_, SharedConfig>,
) -> Result<(), AppError> {
    let mut guard = config.write().await;
    let current = guard.as_mut().ok_or(AppError::ConfigNotLoaded)?;
    // Deep-merge patch into current
    merge_json(&mut serde_json::to_value(current)?, &patch);
    // Write atomically
    current.save()?;
    Ok(())
}
```

#### 0.3 — SDK Coordinator Gate

**Problem:** Each tab's `useSdkStore()` calls `autoConnect()` independently. The store's `beforeunload` handler disconnects on window close — even if other tabs are still using the connection.

**Solution:** Only the main window's SDK store triggers autoConnect and disconnect. Child windows use the bridge passively (read events, send messages to specific sessions).

**Files changed:**
- `apps/desktop/src/stores/sdk.ts` — Gate `autoConnect()` and `beforeunload` disconnect on `role === 'main'`

```typescript
// Only main window manages connection lifecycle
const { role } = useWindowRole();
if (role === 'main') {
  autoConnect();
  window.addEventListener('beforeunload', () => {
    if (connectionState.value === 'connected') sdkDisconnect().catch(() => {});
  });
}
```

---

### Phase 1: Tabbed Sessions (Core Feature)

**Goal:** Add horizontal session tabs to the main window, allowing multiple sessions open simultaneously with instant switching.

#### 1.1 — Session Tab Store

**File:** `apps/desktop/src/stores/sessionTabs.ts` (NEW)

```typescript
export interface SessionTab {
  id: string;           // unique tab ID
  sessionId: string;    // TracePilot session ID
  title: string;        // display title (truncated)
  status: 'active' | 'complete' | 'error' | 'unknown';
  hasUnread: boolean;   // new turns since last viewed
  needsAttention: boolean; // ask_user detected
  pinnedAt: number | null; // null = not pinned
}

export const useSessionTabsStore = defineStore('sessionTabs', () => {
  const tabs = ref<SessionTab[]>([]);
  const activeTabId = ref<string | null>(null);
  
  function openTab(sessionId: string, title: string) { /* ... */ }
  function closeTab(tabId: string) { /* ... */ }
  function activateTab(tabId: string) { /* ... */ }
  function reorderTabs(fromIndex: number, toIndex: number) { /* ... */ }
  function markRead(tabId: string) { /* ... */ }
  function markNeedsAttention(tabId: string) { /* ... */ }
  // Persist tab state to localStorage for session restore
});
```

#### 1.2 — Tab Strip Component

**File:** `apps/desktop/src/components/layout/SessionTabStrip.vue` (NEW)

Renders above the main content area when tabs are open. Uses existing design system patterns.

**Features:**
- Horizontal scrollable tab bar
- Each tab: status dot + title + close button + unread badge
- "+" button opens session picker dropdown (reuses session list data from `useSessionsStore()`)
- Drag-to-reorder via HTML5 drag events
- Keyboard: `Ctrl+T` new tab, `Ctrl+W` close, `Ctrl+1-9` switch, `Ctrl+Tab` cycle
- Tab context menu: Close, Close Others, Close All, Pin

**Reuses:** `useSessionsStore().sessions` for picker, session status badges from existing components.

#### 1.3 — Tabbed Content Routing

**Problem:** Currently `SessionDetailView` uses the route `params.id` to load a session. With tabs, we need the active tab's session displayed without URL navigation.

**Solution:** Wrap `SessionDetailView` logic into a composable, render per-tab with `<keep-alive>`.

**Files changed:**
- `apps/desktop/src/views/SessionDetailView.vue` — Extract session loading into composable
- `apps/desktop/src/composables/useSessionDetail.ts` (NEW or refactor from store) — Accept sessionId as param
- `apps/desktop/src/App.vue` — Conditionally render tab strip + tabbed content when tabs are open

```vue
<!-- App.vue — tabbed mode -->
<SessionTabStrip v-if="sessionTabs.tabs.length > 0" />
<div v-if="sessionTabs.activeTabId" class="tabbed-content">
  <keep-alive :max="10">
    <SessionDetailView 
      :key="sessionTabs.activeTab.sessionId"
      :session-id="sessionTabs.activeTab.sessionId" 
    />
  </keep-alive>
</div>
<router-view v-else />
```

#### 1.4 — Tab-Scoped SDK Steering

**Problem:** `SdkSteeringPanel` currently uses `useSessionDetailStore().session?.id` which is a global singleton.

**Solution:** Pass `sessionId` as prop to `SdkSteeringPanel` (it already accepts `sessionId` prop). Each tab renders its own steering panel.

**Files changed:**
- `apps/desktop/src/components/conversation/SdkSteeringPanel.vue` — Already accepts `sessionId` prop ✅
- `apps/desktop/src/views/tabs/ConversationTab.vue` — Pass active tab's sessionId

**No changes needed to BridgeManager** — `send_message(sessionId, payload)` is already session-scoped.

#### 1.5 — Session Tab Persistence

Save open tabs to `localStorage` so they survive page reload:
```typescript
// In sessionTabs store
watch(tabs, (newTabs) => {
  localStorage.setItem('tracepilot:session-tabs', 
    JSON.stringify(newTabs.map(t => ({ id: t.id, sessionId: t.sessionId }))));
}, { deep: true });
```

**Restore on startup:** Read from localStorage, validate sessions still exist, reopen tabs.

---

### Phase 2: Alert System (Core Feature)

**Goal:** Opt-in notifications for session events. Backend-first detection, multi-channel dispatch.

#### 2.1 — Backend Session Watcher

**File:** `crates/tracepilot-orchestrator/src/alerts/watcher.rs` (NEW module)

Rust worker that periodically checks session state for alertable conditions. Does NOT depend on frontend polling.

```rust
pub struct SessionWatcher {
    config: AlertConfig,
    seen_completions: HashSet<String>,     // session IDs already alerted for completion
    seen_ask_users: HashMap<String, usize>, // session_id -> last known ask_user count
}

impl SessionWatcher {
    /// Check all sessions for new alertable events.
    /// Returns events that haven't been alerted yet.
    pub async fn check(&mut self, sessions_dir: &Path) -> Vec<AlertEvent> {
        // 1. Scan session directories for events.jsonl changes
        // 2. Detect: session completion, ask_user prompts, errors
        // 3. Deduplicate against seen_* sets
        // 4. Return new AlertEvent items
    }
}
```

**Why backend:** Doesn't require any window to be open or polling. Works for all windows simultaneously.

#### 2.2 — Alert Dispatcher (Rust)

**File:** `crates/tracepilot-orchestrator/src/alerts/dispatcher.rs` (NEW)

Routes alert events to configured channels:

```rust
pub struct AlertDispatcher {
    config: AlertConfig,
}

impl AlertDispatcher {
    pub fn dispatch(&self, event: AlertEvent, app: &tauri::AppHandle) {
        if self.config.channels.taskbar_flash && event.severity >= Severity::Normal {
            // Use Tauri's request_user_attention
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.request_user_attention(
                    Some(tauri::UserAttentionType::Informational)
                );
            }
        }
        if self.config.channels.toast {
            // Use tauri-plugin-notification
            let _ = app.notification()
                .builder()
                .title(&event.title)
                .body(&event.body)
                .show();
        }
        if self.config.channels.in_app {
            // Emit Tauri event to all windows
            let _ = app.emit("tracepilot:alert", &event);
        }
    }
}
```

#### 2.3 — Alert Configuration (Config Schema)

**Files changed:**
- `packages/types/src/config.ts` — Add `alerts` section to `TracePilotConfig`
- `packages/types/src/defaults.ts` — Add default alert config
- `crates/tracepilot-tauri-bindings/src/config.rs` — Add `AlertsConfig` struct (must match TS)

```typescript
interface AlertsConfig {
  enabled: boolean;
  channels: {
    taskbarFlash: boolean;
    toast: boolean;
    inApp: boolean;
    sound: boolean;
  };
  events: {
    sessionComplete: ChannelFlags;
    askUser: ChannelFlags;
    sessionError: ChannelFlags;
    longRunning: ChannelFlags;
    sdkDisconnect: ChannelFlags;
  };
  quietHours: {
    enabled: boolean;
    from: string; // "22:00"
    to: string;   // "08:00"
    allowCritical: boolean;
  };
}
```

#### 2.4 — Alert Center Drawer (Frontend)

**File:** `apps/desktop/src/components/AlertCenterDrawer.vue` (NEW)

Slide-out panel triggered by bell icon in `BreadcrumbNav` or `AppSidebar`.

**Reuses:**
- `BreadcrumbNav.vue` — Add bell icon to existing header bar
- Alert items styled with existing `.card`, `.badge-*` classes
- `safeListen` for `tracepilot:alert` events from backend

**Store:** `apps/desktop/src/stores/alerts.ts` (NEW) — tracks alert history (50 max), unread count, filter state.

#### 2.5 — Settings Tab

**File:** `apps/desktop/src/components/settings/SettingsNotifications.vue` (NEW)

Added as a new tab in the existing `SettingsView.vue`. Uses existing settings patterns (toggle rows, section panels).

**Files changed:**
- `apps/desktop/src/views/SettingsView.vue` — Add "Notifications" to tab list

#### 2.6 — Tauri Dependencies

**Files changed:**
- `apps/desktop/src-tauri/Cargo.toml` — Add `tauri-plugin-notification`
- `apps/desktop/src-tauri/capabilities/default.json` — Add notification permissions
- `apps/desktop/package.json` — Add `@tauri-apps/plugin-notification`

---

### Phase 3: Multi-Window Infrastructure (Enhancement)

**Goal:** Allow popping sessions out into dedicated viewer windows. Builds on Phase 0 + 1 foundations.

#### 3.1 — Window Creation Command (Rust)

**File:** `crates/tracepilot-tauri-bindings/src/commands/window.rs` (NEW)

```rust
#[tauri::command]
pub async fn open_session_window(
    app: tauri::AppHandle,
    session_id: String,
    window_type: String, // "viewer" | "monitor"
) -> Result<String, AppError> {
    let label = format!("session-{}", &session_id[..8]);
    let url = tauri::WebviewUrl::App(
        format!("index.html#role={}&session={}", window_type, session_id).into()
    );
    tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title(format!("TracePilot — Session"))
        .inner_size(1024.0, 700.0)
        .build()
        .map_err(|e| AppError::Window(e.to_string()))?;
    Ok(label)
}
```

#### 3.2 — Capability Updates

**File:** `apps/desktop/src-tauri/capabilities/default.json`

```json
{
  "identifier": "default",
  "windows": ["main", "session-*"],
  "permissions": ["tracepilot:default"]
}
```

#### 3.3 — Child Window App Shell

**File:** `apps/desktop/src/ChildApp.vue` (NEW) — Lightweight shell for child windows

Uses `useWindowRole()` to determine what to render. No sidebar, no setup wizard, no update check.

```vue
<template>
  <div class="child-window" :data-theme="theme">
    <ChildTitleBar :session-id="sessionId" :role="role" />
    <SessionDetailView v-if="role === 'viewer'" :session-id="sessionId" />
  </div>
</template>
```

**Files changed:**
- `apps/desktop/src/main.ts` — Branch on `useWindowRole()` to mount `App.vue` vs `ChildApp.vue`

#### 3.4 — "Open in Window" Actions

Add a toolbar button to `SessionDetailView` and tab context menu:

**Files changed:**
- `apps/desktop/src/views/SessionDetailView.vue` — Add "Pop out" button
- `apps/desktop/src/components/layout/SessionTabStrip.vue` — Add "Open in Window" to tab context menu

---

### Phase 4: Multi-Bridge Registry (Future/Optional)

**Goal:** Support connecting to multiple STDIO processes or `--ui-server` instances simultaneously, each scoped to specific sessions.

This is the "full control/orchestration" feature where each tab/window can link to its own CLI subprocess.

#### 4.1 — BridgeRegistry

**File:** `crates/tracepilot-orchestrator/src/bridge/registry.rs` (NEW)

```rust
pub struct BridgeRegistry {
    bridges: HashMap<String, Arc<RwLock<BridgeManager>>>,
    session_affinity: HashMap<String, String>, // session_id -> bridge_id
}

impl BridgeRegistry {
    pub fn default_bridge(&self) -> &Arc<RwLock<BridgeManager>> { /* ... */ }
    pub fn create_bridge(&mut self, id: &str, config: BridgeConnectConfig) -> Result<(), BridgeError> { /* ... */ }
    pub fn bridge_for_session(&self, session_id: &str) -> &Arc<RwLock<BridgeManager>> { /* ... */ }
    pub fn assign_session(&mut self, session_id: &str, bridge_id: &str) { /* ... */ }
}
```

This is a **separate RFC** — not included in the initial implementation. Documenting the design here to show the extension point.

---

## 4. File Inventory

### New Files (13)

| File | Phase | Type | Description |
|---|---|---|---|
| `src/composables/useWindowRole.ts` | 0 | TS | Window role detection from URL hash |
| `src/stores/sessionTabs.ts` | 1 | TS | Tab state management |
| `src/components/layout/SessionTabStrip.vue` | 1 | Vue | Tab strip component |
| `src/composables/useSessionDetail.ts` | 1 | TS | Extracted session loading composable |
| `src/stores/alerts.ts` | 2 | TS | Alert history and state |
| `src/components/AlertCenterDrawer.vue` | 2 | Vue | Notification drawer |
| `src/components/settings/SettingsNotifications.vue` | 2 | Vue | Alert settings panel |
| `crates/.../alerts/watcher.rs` | 2 | Rust | Backend session watcher |
| `crates/.../alerts/dispatcher.rs` | 2 | Rust | Alert routing to channels |
| `crates/.../commands/window.rs` | 3 | Rust | Window creation IPC commands |
| `src/ChildApp.vue` | 3 | Vue | Child window app shell |
| `src/components/layout/ChildTitleBar.vue` | 3 | Vue | Compact title bar for popouts |
| `crates/.../bridge/registry.rs` | 4 | Rust | Multi-bridge registry (future) |

### Modified Files (14)

| File | Phase | Changes |
|---|---|---|
| `src/App.vue` | 0, 1 | Role gate, tab strip integration, tabbed content |
| `src/stores/sdk.ts` | 0 | Coordinator gate for autoConnect/disconnect |
| `src/stores/preferences.ts` | 0 | Switch to patchConfig |
| `crates/.../commands/config_cmds.rs` | 0 | Add `patch_config` command |
| `packages/client/src/invoke.ts` | 0, 2, 3 | Add patchConfig, alert, window IPC functions |
| `packages/types/src/config.ts` | 2 | Add AlertsConfig to config interface |
| `packages/types/src/defaults.ts` | 2 | Add default alert config |
| `crates/.../config.rs` | 2 | Add AlertsConfig Rust struct |
| `src/views/SettingsView.vue` | 2 | Add Notifications tab |
| `src/components/layout/BreadcrumbNav.vue` | 2 | Add alert bell icon |
| `apps/desktop/src-tauri/Cargo.toml` | 2 | Add tauri-plugin-notification |
| `apps/desktop/src-tauri/capabilities/default.json` | 3 | Expand window patterns |
| `apps/desktop/src-tauri/build.rs` | 3 | Register window commands in ACL |
| `src/main.ts` | 3 | Branch on window role |

---

## 5. Dependency Order

```
Phase 0.1 (role gate)     ← no deps
Phase 0.2 (patch_config)  ← no deps
Phase 0.3 (SDK gate)      ← depends on 0.1
    │
Phase 1.1 (tab store)     ← depends on 0.x
Phase 1.2 (tab strip)     ← depends on 1.1
Phase 1.3 (tab content)   ← depends on 1.1, 1.2
Phase 1.4 (tab SDK)       ← depends on 0.3, 1.3
Phase 1.5 (persistence)   ← depends on 1.1
    │
Phase 2.1 (watcher)       ← no deps (backend only)
Phase 2.2 (dispatcher)    ← depends on 2.1
Phase 2.3 (config schema) ← no deps
Phase 2.4 (drawer)        ← depends on 2.2, 2.3
Phase 2.5 (settings)      ← depends on 2.3
Phase 2.6 (tauri deps)    ← depends on 2.2
    │
Phase 3.x (multi-window)  ← depends on 0.x complete
```

Phase 1 and Phase 2 can proceed **in parallel** once Phase 0 is complete.

---

## 6. Risk Assessment

### Low Risk
- **Tab strip** — Pure frontend component, no backend changes. Existing session data model works as-is.
- **Alert settings** — Standard settings page pattern, well-established in codebase.
- **Alert drawer** — Overlay component, independent of other systems.

### Medium Risk
- **`patch_config` API** — Requires careful JSON merge logic. Must handle all config sections. Good test coverage needed.
- **Tab content caching** — `<keep-alive>` may hold stale session data if sessions update in background. Need invalidation strategy.
- **Backend watcher** — File system polling has performance implications. Should use debounced checks with configurable interval.

### High Risk
- **SDK coordinator gate** — Changing the autoConnect/disconnect lifecycle affects all SDK users. Must be thoroughly tested.
- **Multi-window capabilities** — Tauri permission system is strict. Getting wildcard window labels right is critical. Must verify with `cargo tauri build`.
- **`tauri-plugin-notification` integration** — External dependency. Must verify Windows toast permissions work without admin elevation.

### Mitigations
- Phase 0 ships **before** any new features — validates safety net
- Tab store uses localStorage backup — survives crashes gracefully
- Backend watcher has kill switch via config (`alerts.enabled: false`)
- All new features gated behind feature flags (`features.sessionTabs`, `features.sessionAlerts`)

---

## 7. What About Session-Scoped STDIO Processes?

The user asked about linking separate STDIO sessions for full control per-window. Here's the analysis:

### Current State
- STDIO mode: `copilot_sdk::Client::builder().build()` spawns **one** private CLI subprocess
- That subprocess handles ALL sessions created via `create_session()` or `resume_session()`
- If you need N completely isolated CLI environments, you need N Client instances

### Scaling Concern
A single STDIO subprocess is fine for 2-5 sessions. Beyond that:
- Memory usage scales linearly (each session holds context)
- If the subprocess crashes, all sessions are lost
- No isolation between sessions (they share the same CLI process state)

### Solution: BridgeRegistry (Phase 4)
The `BridgeRegistry` concept (documented above) addresses this by:
1. Allowing multiple `BridgeManager` instances, each with its own Client
2. Session-to-bridge affinity tracking
3. Per-tab bridge selection (the tab store tracks which bridge its session belongs to)

**However**, this is a significant architecture change and should be a separate RFC after Phases 0-2 prove the model. For now:
- Single bridge handles multiple sessions (tested up to ~5 concurrent)
- TCP mode (connecting to `--ui-server`) avoids subprocess management entirely
- TCP is recommended for multi-session workflows as the `--ui-server` is managed externally

---

## 8. Testing Strategy

### Unit Tests
- `sessionTabs` store: open, close, reorder, persist, restore
- `alerts` store: add, mark read, filter, prune
- `patch_config`: merge logic for all config sections
- `useWindowRole`: hash parsing edge cases

### Integration Tests
- Tab lifecycle: open session in tab → view conversation → close tab → reopen
- Alert flow: backend detects event → dispatches → drawer shows alert
- SDK steering in tabs: two tabs with different sessions → send message to each

### E2E Tests (Playwright)
- Open 3 tabs, verify independent session loading
- Trigger mock alert, verify drawer shows it
- Close tab with unsaved state, verify no data loss

---

## 9. Feature Flags

All new features gated in `TracePilotConfig.features`:

```typescript
interface FeaturesConfig {
  // ... existing flags ...
  sessionTabs: boolean;    // Phase 1
  sessionAlerts: boolean;  // Phase 2
  multiWindow: boolean;    // Phase 3
}
```

Default: all `false`. Enabled incrementally via Settings → Experimental.

---

## 10. Post-Review Amendments

> Applied after consolidated review from Opus 4.6, GPT 5.4, Codex 5.3, and Sonnet 4.6.  
> See [consolidated review](./reviews/consolidated-plan-review.md) for full cross-reviewer synthesis.

### Amendment 1: Phase 1.0 — Session Detail Composable (CRITICAL)

**Problem:** `useSessionDetailStore` is a Pinia singleton (`defineStore("sessionDetail", ...)`). All `<keep-alive>` instances of `SessionDetailView` share the same reactive refs (`detail`, `turns`, `events`, `todos`, etc.). The last-loaded tab's data clobbers all others. **All 4 reviewers flagged this as the #1 blocker.**

**Solution:** Replace the singleton store with a per-instance composable using `provide/inject`:

```typescript
// composables/useSessionDetail.ts (NEW — replaces stores/sessionDetail.ts)
export function useSessionDetail(sessionId: Ref<string>) {
  // Per-instance reactive state (not shared)
  const detail = ref<SessionDetail | null>(null);
  const turns = ref<ConversationTurn[]>([]);
  const events = ref<SessionEventsResponse | null>(null);
  const todos = ref<TodoSection | null>(null);
  // ... all other state from sessionDetail.ts ...

  async function loadDetail(id: string) { /* ... */ }
  // ... all methods ...

  watch(sessionId, (id) => loadDetail(id), { immediate: true });
  return { detail, turns, events, todos, loadDetail, /* ... */ };
}
```

**`SessionDetailView` provides the instance:**
```typescript
const sessionDetail = useSessionDetail(toRef(props, 'sessionId'));
provide('sessionDetail', sessionDetail);
```

**Child tabs inject it:**
```typescript
// In OverviewTab, ConversationTab, EventsTab, etc.
const { detail, turns, events } = inject('sessionDetail')!;
```

**Scope of refactor:** Every component that calls `useSessionDetailStore()` must be migrated to `inject('sessionDetail')`. This includes: `SessionDetailView`, `OverviewTab`, `ConversationTab`, `EventsTab`, `TodosTab`, `MetricsTab`, `TokenFlowTab`, `ChatViewMode`, `SdkSteeringPanel`, and any other consumer.

**This is the largest single work item in Phase 1 and must be completed first.**

### Amendment 2: Inner Tab Routing Replaced (CRITICAL)

**Problem:** `SessionDetailView` uses `<router-view>` for inner tabs (Overview, Conversation, Events...). Vue Router has one current route. Two `<keep-alive>` instances cannot display different inner tabs simultaneously. Switching inner tabs in one session changes the route for all. **Flagged by Opus, GPT, Sonnet.**

**Solution (Sonnet's Option 1):** Each `SessionDetailView` manages inner tab state locally:

```typescript
// SessionDetailView.vue
const activeSubTab = ref<string>('overview'); // local, not route-derived

const innerTabComponent = computed(() => {
  const map: Record<string, Component> = {
    'overview': OverviewTab,
    'conversation': ConversationTab,
    'events': EventsTab,
    'todos': TodosTab,
    'metrics': MetricsTab,
    'token-flow': TokenFlowTab,
    'timeline': SessionTimelineView,
  };
  return map[activeSubTab.value] ?? OverviewTab;
});
```

```vue
<!-- Replace <router-view> with: -->
<TabNav :tabs="tabs" :active="activeSubTab" @select="activeSubTab = $event" />
<component :is="innerTabComponent" :key="`${sessionId}-${activeSubTab}`" />
```

**Backward compatibility:** When `SessionDetailView` is accessed via the router (non-tabbed mode), it reads the route's child name to set the initial `activeSubTab`. The router children routes are preserved for direct URL access.

### Amendment 3: Child Window Role Detection (CRITICAL)

**Problem:** The plan used `#role=viewer&session=abc` in the URL hash. This conflicts with `createWebHashHistory()` which owns the `#` space. Child windows would land on the 404 route. **Flagged by GPT.**

**Solution:** Detect window role from Tauri window label:

```typescript
// composables/useWindowRole.ts
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export function useWindowRole() {
  const label = getCurrentWebviewWindow().label; // e.g. "main", "session-abc123"
  
  if (label === 'main') return { role: 'main' as const, sessionId: null };
  if (label.startsWith('session-')) {
    return { role: 'viewer' as const, sessionId: label.slice('session-'.length) };
  }
  return { role: 'main' as const, sessionId: null };
}
```

**Window creation URL** becomes a normal route:
```rust
let url = tauri::WebviewUrl::App("index.html".into());
// Role derived from label, not URL
```

### Amendment 4: `patch_config` Typed Design (HIGH)

**Problem:** Raw `serde_json::Value` deep-merge is untyped, allows invalid keys, has ambiguous array semantics. **All 4 reviewers flagged.**

**Solution:** Typed section-scoped patch structs:

```rust
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum ConfigPatch {
    Alerts(AlertsConfigPatch),
    Features(FeaturesConfigPatch),
    Display(DisplayConfigPatch),
    // ... one variant per config section
}

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct AlertsConfigPatch {
    pub enabled: Option<bool>,
    pub channels: Option<AlertChannelsPatch>,
    // ... all fields Optional
}

#[tauri::command]
pub async fn patch_config(
    patch: ConfigPatch,
    config: tauri::State<'_, SharedConfig>,
) -> Result<(), AppError> {
    let mut guard = config.write().await;
    let current = guard.as_mut().ok_or(AppError::ConfigNotLoaded)?;
    patch.apply(current); // typed merge, no JSON footguns
    current.save_atomic()?; // temp file + rename
    Ok(())
}
```

Also: implement atomic write (`write_to_temp` → `fsync` → `rename`) in `save_to()`, fixing the existing non-atomic save.

### Amendment 5: Bridge Lock Scope (HIGH)

**Problem:** SDK commands hold `RwLock` across `.await` calls (network I/O), causing head-of-line blocking. Under multi-tab load, one slow `create_session` blocks all other bridge operations. **Flagged by Codex.**

**Solution:** Clone-release-await pattern:

```rust
// Before (lock held during I/O):
pub async fn create_session(&mut self, ...) -> Result<...> {
    let session = self.client.as_ref().unwrap().create_session(config).await?;
    self.sessions.insert(session.id.clone(), Arc::new(session));
    Ok(...)
}

// After (lock released during I/O):
pub async fn create_session(bridge: &SharedBridgeManager, ...) -> Result<...> {
    let client = {
        let guard = bridge.read().await;
        guard.client.clone() // Arc clone under lock
    }; // lock released
    
    let session = client.create_session(config).await?; // I/O outside lock
    
    {
        let mut guard = bridge.write().await;
        guard.sessions.insert(session.id.clone(), Arc::new(session)); // quick write
    }
    Ok(...)
}
```

### Amendment 6: Additional High-Priority Fixes

**Auto-refresh pausing (Opus, Sonnet):**
- Add `isActiveTab` awareness to `useAutoRefresh`. When tab deactivates (`onDeactivated`), pause timer. Resume on `onActivated`.

**Window label uniqueness (Opus, GPT):**
- Use full session ID for window label: `session-{full_uuid}` not `session-{first 8 chars}`
- Before creating window, check if label exists → focus existing window instead

**Config version bump (GPT):**
- Adding `alerts` to `TracePilotConfig` requires: `CONFIG_VERSION` bump to 5, migration function `v4 → v5`, `#[serde(default)]` on new Rust fields

**Breadcrumb/sidebar tab-awareness (GPT, Sonnet):**
- When `sessionTabs.activeTabId` is set, `App.vue` breadcrumbs derive session label from tab store, not `route.params`
- Sidebar highlights "Sessions" when any tab is active

**ARIA accessibility (Sonnet):**
- `SessionTabStrip` must implement: `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, focus management on close/activate

**Bridge crash detection (Codex):**
- Add health watcher task that monitors STDIO subprocess and transitions bridge state to `Error`/`Disconnected` with `sdk_connection_changed` event on crash

**Dependency graph fix:**
- Phase 2.1 (watcher) depends on Phase 2.3 (config schema), not "no deps"

**Alert watcher spec (GPT, Codex):**
- Default poll interval: 5 seconds
- Recommended: hybrid `notify` watcher + periodic reconciliation
- Must tolerate partial last-line in `events.jsonl` (write-in-progress)

**Alert UX (Sonnet):**
- Bell icon in `AppSidebar` (not `BreadcrumbNav`)
- Persist alerts to `localStorage` with 24h TTL
- Add urgency presets (Low/Medium/High) before the 15-checkbox matrix

---

## 11. Revised Phase Order (Post-Review)

```
Phase 0.1 (role gate — use window label)     ← no deps
Phase 0.2 (patch_config — typed)             ← no deps
Phase 0.3 (SDK coordinator gate)             ← depends on 0.1
Phase 0.4 (bridge lock refactor)             ← no deps
    │
Phase 1.0 (session detail composable)        ← CRITICAL PREREQUISITE
Phase 1.1 (tab store)                        ← depends on 0.x
Phase 1.2 (tab strip + ARIA)                 ← depends on 1.1
Phase 1.3 (inner tab local routing)          ← depends on 1.0
Phase 1.4 (tabbed content with keep-alive)   ← depends on 1.0, 1.2, 1.3
Phase 1.5 (tab-scoped SDK steering)          ← depends on 0.3, 1.4
Phase 1.6 (tab persistence + staggered load) ← depends on 1.1
Phase 1.7 (breadcrumb/sidebar tab-awareness) ← depends on 1.1
Phase 1.8 (auto-refresh pausing)             ← depends on 1.4
    │
Phase 2.1 (config schema + version bump)     ← no deps
Phase 2.2 (backend watcher)                  ← depends on 2.1
Phase 2.3 (alert dispatcher)                 ← depends on 2.2
Phase 2.4 (alert drawer in sidebar)          ← depends on 2.3
Phase 2.5 (alert settings)                   ← depends on 2.1
Phase 2.6 (tauri notification plugin)        ← depends on 2.3
    │
Phase 3.x (multi-window)                     ← depends on 0.x, 1.0 complete
```

Phase 1 and Phase 2 can still proceed **in parallel** once Phase 0 and Phase 1.0 are done.
