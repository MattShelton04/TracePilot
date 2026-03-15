# TracePilot Setup Window — Design Report

## 1. Overview

TracePilot currently lacks a first-time setup experience. Users launch the app and it silently attempts to read from hardcoded paths (`~/.copilot/session-state/` for sessions, `~/.copilot/tracepilot/index.db` for the index). If these don't exist, the app shows an empty state with no guidance.

This document specifies the requirements, design rationale, and feature scope for a **Setup Wizard** that appears on first launch (and can be re-triggered from Settings as a "factory reset").

---

## 2. Hardcoded Paths Audit

The following paths are currently hardcoded and need to become user-configurable:

| Path | Purpose | Defined In | Default Value |
|------|---------|-----------|---------------|
| Session State Dir | Copilot CLI session data | `crates/tracepilot-core/src/session/discovery.rs:8-11` | `~/.copilot/session-state/` |
| Index Database | SQLite FTS5 search index | `crates/tracepilot-indexer/src/lib.rs:14-24` | `~/.copilot/tracepilot/index.db` |
| Home Dir Fallback (Win) | Dangerous fallback | `discovery.rs:19`, `indexer/lib.rs:16` | `C:\Users\default` |
| Home Dir Fallback (Unix) | Dangerous fallback | `discovery.rs:25`, `indexer/lib.rs:18` | `/tmp` |

### SettingsView Bugs
- `SettingsView.vue:44` displays `~/.copilot/sessions/` but actual path is `~/.copilot/session-state/`
- `SettingsView.vue:47` shows hardcoded `42.5 MB` for database size (mocked)

### Call Sites Using Hardcoded Paths
All 13 Tauri IPC commands in `crates/tracepilot-tauri-bindings/src/lib.rs` call `default_session_state_dir()` and/or `default_index_db_path()` with no override mechanism. This includes both primary commands (list_sessions, reindex_sessions, etc.) and detail commands that use `resolve_session_path()` which internally calls `default_session_state_dir()`.

---

## 3. What the Setup Wizard Should Include

### Step 1: Welcome + Features
- App logo + name + version
- One-line description: "Your Copilot session analytics dashboard"
- Brief feature overview with icons (6 key features as compact chips/cards)
- "Get Started" button to proceed

### Step 2: Configure Paths
- **Session State Directory**: Text input + Browse button (Tauri native dialog)
  - Default: auto-detected absolute path (platform-native format)
  - Validation states:
    - ✅ Success: "Found N sessions across M repositories"
    - ⚠️ Warning (0 sessions): "Directory exists but no sessions found yet — TracePilot will index when sessions appear"
    - ❌ Error (not found): "Directory does not exist"
    - ❌ Error (permission): "Permission denied — check directory permissions"
    - ❌ Error (not a directory): "Path is a file, not a directory"
  - 0 sessions is a WARNING, not a blocking error — users should be able to proceed
- **Database Location**: Text input + Browse button
  - Default: auto-detected absolute path (platform-native format)
  - Validation: parent directory exists and is writable
  - Note: "Will be created automatically if it doesn't exist (~2MB per 100 sessions)"
- **Auto-index on launch**: Toggle switch (default on)

### Step 3: Index & Ready
- Save configuration
- Run initial indexing with progress indicator:
  - Progress bar with "Indexing N of M sessions..."
  - Cancel / Skip option
  - Error handling with retry
- On completion: summary of config + session count
- "Launch TracePilot" button

---

## 4. Settings Page Wire-Up

The following settings need to be connected to real data:

| Setting | Current State | Target |
|---------|--------------|--------|
| Sessions Directory | Stub: `~/.copilot/sessions/` | Read from config, display actual absolute path |
| Database Location | Not shown | Show index.db path from config |
| Database Size | Stub: `42.5 MB` | Query actual file size via Tauri command |
| Session Count | Not shown | Show count from index DB |
| Last Indexed | Not shown | Show timestamp of last reindex |
| Auto-index on Launch | Stub: local ref | Persist to config, execute on app start |
| Items Per Page | Stub: local ref | Persist to preferences store |
| Auto-refresh Interval | Stub: local ref | Persist to preferences store |
| Default View | Stub: local ref | Persist to preferences store |
| Factory Reset | Not present | Button to clear all config + data and restart setup |

---

## 5. Factory Reset Flow

When triggered from Settings:
1. Confirmation dialog: "This will delete all TracePilot configuration and index data. Your Copilot session files will NOT be affected."
2. On confirm:
   - Read current config to discover actual configured paths
   - Delete the index.db at the **configured** path (not hardcoded default)
   - Delete `config.toml`
   - Clear `localStorage` key `tracepilot-prefs`
   - Reload the app (triggers setup wizard since config.toml no longer exists)

---

## 6. Configuration Architecture

### Config File Location
```
~/.copilot/tracepilot/config.toml
```

### Config Format
```toml
version = 1

[paths]
session_state_dir = "C:\\Users\\mattt\\.copilot\\session-state"  # Always absolute, no tildes
index_db_path = "C:\\Users\\mattt\\.copilot\\tracepilot\\index.db"

[general]
auto_index_on_launch = true
```

**Key decisions** (from multi-model review):
- **Always store absolute paths** — no tilde expansion needed at runtime
- **Config version field** — enables future migration/schema changes
- **Platform-native path format** — Windows backslashes on Windows, forward slashes on Unix

### Rust Side
- `TracePilotConfig` struct with `serde` derive for TOML deserialization
- Loaded at app startup, wrapped in `Arc<RwLock<TracePilotConfig>>` for mutable shared state
- `save_config` updates both the file and the in-memory state
- If config.toml is missing/corrupt → setup wizard is shown

### Tauri Integration
- Injected as Tauri managed state: `app.manage(Arc::new(RwLock::new(config)))`
- All IPC commands read from managed state instead of `default_*()` functions
- New IPC commands:
  - `check_config_exists` → returns bool (used by App.vue to gate setup)
  - `get_config` → returns current config
  - `save_config` → writes config.toml and updates managed state
  - `get_db_size` → returns index.db file size in bytes
  - `get_session_count` → returns indexed session count
  - `validate_session_dir` → checks path, returns status + session count
  - `factory_reset` → reads config, deletes DB + config, returns success

### Frontend Integration
- **Setup-complete is derived from config.toml existence** — NO separate localStorage flag
- `App.vue` calls `check_config_exists()` on mount → shows SetupWizard if false
- SetupWizard calls `save_config` on completion → App.vue reactively hides wizard
- SettingsView reads real config via `get_config` Tauri command
- `App.vue` must NOT call `sessionsStore.fetchSessions()` until config is confirmed valid

### Migration for Existing Users
- If `config.toml` doesn't exist but `~/.copilot/tracepilot/index.db` does exist:
  - Pre-populate wizard with detected defaults
  - Offer "Use existing index" option (skip reindexing)
- If `config.toml` exists but has old version: migrate schema automatically

---

## 7. Feature Overview Content

For the welcome step, these are the key features to highlight:

| Feature | Icon | Description |
|---------|------|-------------|
| Session Explorer | 📋 | Browse, search, and filter all your Copilot sessions with full-text search |
| Conversation Viewer | 💬 | Read turn-by-turn conversations with collapsible tool calls and subagent support |
| Analytics Dashboard | 📊 | Track token usage, costs, and productivity trends over time |
| Tool Analysis | 🔧 | See which tools are used most, success rates, and activity heatmaps |
| Code Impact | 📝 | Understand which files change most, additions vs deletions |
| Cost Tracking | 💰 | Compare Copilot premium request costs vs wholesale API pricing |

---

## 8. Prototype Variants

Three HTML prototypes are provided in this directory:

### Variant A: Multi-Step Wizard (`variant-a.html`)
- Classic wizard with horizontal stepper (Welcome → Configure → Tour → Ready)
- Clean step-by-step progression, familiar UX pattern
- Back/Next/Skip navigation
- **Reviewer consensus: Best overall for dev-tools.** Recommended with modification: merge Welcome + Features into one step for a 3-step flow.

### Variant B: Single-Page Card (`variant-b.html`)
- All configuration in a single centered card
- Scrollable with section dividers
- Welcome header + path config + feature grid + Get Started button
- **Reviewer consensus: Most efficient, closest to existing Settings UI.** Best if setup is kept minimal.

### Variant C: Fullscreen Onboarding (`variant-c.html`)
- Fullscreen slides with smooth transitions
- Animated feature showcase with large icons
- **Reviewer consensus: Overengineered for developer audience.** Too much ceremony for 2 path inputs. Better suited for consumer apps.

### Multi-Model Review Scores

| Variant | Opus 4.6 | GPT 5.4 | Gemini 3 Pro | Consensus |
|---------|----------|---------|--------------|-----------|
| A: Wizard | ⭐ Recommended | 8/10 (Recommended) | ⭐⭐⭐ | **Top pick** (2/3 reviewers) |
| B: Card | Good | 7/10 | ⭐⭐⭐⭐⭐ (Recommended) | **Strong alternative** |
| C: Fullscreen | Overengineered | 5/10 | ⭐⭐⭐⭐ | **Not recommended** |

---

## 9. Consolidated Review Feedback

### Critical Issues (All 3 reviewers agreed)
1. **Config.toml is the source of truth for setup state** — no separate localStorage flag
2. **Factory reset must read current config** to find actual DB path, not hardcoded default
3. **Store absolute paths only** — no tildes, no shell expansion needed
4. **Enter key handler must not hijack text inputs** — check `activeElement.tagName`
5. **Use design system `form-switch`** — don't reimplement toggle switches

### High-Priority Improvements
6. Detailed validation states (permission denied, empty dir, 0 sessions as warning not error)
7. Indexing progress indicator on final step (not just instant "Ready")
8. Cross-platform path display (Windows backslashes vs Unix forward slashes)
9. Config version field for future migration
10. Tauri managed state must be mutable (`Arc<RwLock<TracePilotConfig>>`)
11. Block `App.vue` data fetching until config is confirmed valid
12. Existing user migration: detect existing index.db, offer "Use existing index"

### Accessibility Fixes
13. Validation messages need `aria-live="polite"` / `role="status"`
14. Inactive steps need `aria-hidden="true"` or conditional rendering
15. Dot navigation (Variant C) needs larger click targets (24×24px minimum)
16. Text inputs need proper `<label for>` + `aria-describedby` for hints
17. Toggle switches need keyboard support (Space/Enter)

---

## 10. Accessibility Considerations

- All prototypes use semantic HTML with ARIA labels
- Keyboard navigation: Tab through controls, Enter to activate (excluding text inputs), Escape to close
- Focus management: Auto-focus first interactive element on each step
- Screen reader support: Step announcements, live validation regions (`aria-live="polite"`)
- Inactive content: Use `aria-hidden="true"` for off-screen steps/slides
- Color contrast: All text meets WCAG AA on dark backgrounds
- Reduced motion: Respect `prefers-reduced-motion` for slide transitions
- Click targets: Minimum 24×24px for all interactive elements
