# Implementation Plan 1: Rust Safety & Error Handling (Workstream A)

**Priority**: Tier 1 — RELEASE BLOCKER  
**Estimated Scope**: ~200 lines new code + ~175 mechanical replacements  
**Dependencies**: Recommend doing F1 (split lib.rs) first to reduce diff size and merge conflicts

---

## A1: Replace Production `unwrap()` on Locks

### What to change

5 lock unwraps in `crates/tracepilot-tauri-bindings/src/lib.rs`:

#### RwLock reads/writes (3 sites)

**Line 253** — `read_config()` helper:
```rust
// BEFORE
fn read_config(state: &SharedConfig) -> TracePilotConfig {
    let guard = state.read().unwrap();
    guard.clone().unwrap_or_default()
}

// AFTER — return Result, or use poison recovery
fn read_config(state: &SharedConfig) -> TracePilotConfig {
    match state.read() {
        Ok(guard) => guard.clone().unwrap_or_default(),
        Err(poisoned) => {
            tracing::error!("Config RwLock poisoned — using defaults");
            poisoned.into_inner().clone().unwrap_or_default()
        }
    }
}
```

**Line 1361** — `save_config()` command:
```rust
// BEFORE
let mut guard = state.write().unwrap();
*guard = Some(config);

// AFTER
let mut guard = state.write().map_err(|_| "Config lock poisoned".to_string())?;
*guard = Some(config);
```

**Line 1489** — `reset_config()` command:
```rust
// BEFORE
let mut guard = state.write().unwrap();
*guard = None;

// AFTER
let mut guard = state.write().map_err(|_| "Config lock poisoned".to_string())?;
*guard = None;
```

#### Mutex locks on LRU cache (2 sites)

**Lines 487, 508** — Turn cache access:
```rust
// BEFORE
let mut lru = cache.lock().unwrap();

// AFTER — skip cache on poison (graceful degradation)
let Ok(mut lru) = cache.lock() else {
    tracing::warn!("Turn cache Mutex poisoned — skipping cache");
    // Fall through to re-parse from disk
    // (for line 487: skip the early return)
    // (for line 508: skip the cache put)
    continue; // or return/skip as appropriate for each site
};
```

For line 487 (cache read), wrap the entire block so cache miss falls through to disk parse.  
For line 508 (cache write), skip the put silently.

### Acceptance Criteria
- `cargo clippy -- -D warnings` passes
- `cargo test -p tracepilot-tauri-bindings` passes (currently 0 tests, so this is baseline)
- Manual test: app starts normally, sessions load

---

## A2: Replace Remaining Production Panic Paths

### `apps/desktop/src-tauri/src/main.rs:60`
```rust
// BEFORE
.run(tauri::generate_context!())
.expect("error while running TracePilot");

// AFTER
.run(tauri::generate_context!())
.unwrap_or_else(|e| {
    eprintln!("Fatal: TracePilot failed to start: {e}");
    std::process::exit(1);
});
```
> Note: This is `fn main()` — we can't return Result. `unwrap_or_else` with explicit exit is the cleanest pattern.

### `crates/tracepilot-core/src/models/event_types.rs:177`
```rust
// BEFORE
s.parse().expect("strum default variant makes this infallible")

// AFTER — use unwrap_or for defense-in-depth
s.parse().unwrap_or(SessionEventType::Unknown)
```
> This enum is `SessionEventType`, which uses strum's `#[strum(default)]` attribute on the `Unknown` variant. That makes `str::parse()` infallible — the expect is arguably unreachable. Prefer adding a `debug_assert!` and/or a comment explaining the strum invariant rather than introducing semantic fallback churn.

### `crates/tracepilot-core/src/parsing/events.rs:367–368`
TWO guarded unwraps: `shutdowns.first().unwrap()` (line 367) and `shutdowns.last().unwrap()` (line 368). Both guarded by `if shutdowns.is_empty() { return None; }` at line 353. **Low risk** — add `debug_assert!(!shutdowns.is_empty())` before each for clarity, but these are not production crash paths.

### `crates/tracepilot-core/src/turns/mod.rs:744`
Guarded by `ensure_current_turn()` call before it. **Low risk** — same treatment: add debug_assert.

### `crates/tracepilot-orchestrator/src/version_manager.rs:200`
```rust
// BEFORE
to_file.parent().unwrap()

// AFTER
to_file.parent().ok_or_else(|| OrchestratorError::Config("Invalid destination path".into()))?
```

### Acceptance Criteria
- No `unwrap()`/`expect()` in non-test Rust code on potentially-None/Err values (verified with `cargo clippy`)
- All existing tests pass

---

## A3: Structured Error Type for Tauri Bindings

This is the largest task. ~175 `.map_err(|e| e.to_string())` calls need migration.

> **Prerequisite**: Recommend completing F1 (split lib.rs into modules) first to reduce diff size and merge conflicts.

### Phase 1: Define the error type (~30 min)

Create `crates/tracepilot-tauri-bindings/src/error.rs`:

```rust
use serde::Serialize;
use thiserror::Error;

/// Unified error type for all Tauri IPC commands.
/// Serialized as JSON so the frontend can pattern-match on `kind`.
///
/// Tauri 2.10.3 provides a blanket `impl<T: Serialize> From<T> for InvokeError`,
/// so `Result<T, BindingsError>` works directly as a command return type —
/// no JSON stringify wrapper needed.
#[derive(Debug, Error, Serialize)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct BindingsError {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// Session file not found or unreadable
    SessionNotFound,
    /// Session data failed to parse
    ParseError,
    /// Database operation failed
    DatabaseError,
    /// File I/O error
    IoError,
    /// Configuration error
    ConfigError,
    /// Orchestrator operation failed
    OrchestratorError,
    /// Network request failed
    NetworkError,
    /// Lock poisoned (internal)
    LockPoisoned,
    /// Async task failed
    TaskError,
    /// Generic/uncategorized
    Internal,
}

// From impls for source error types:
impl From<tracepilot_core::error::TracePilotError> for BindingsError { ... }
impl From<std::io::Error> for BindingsError { ... }
impl From<tracepilot_orchestrator::error::OrchestratorError> for BindingsError { ... }
impl From<tokio::task::JoinError> for BindingsError { ... }
impl From<semver::Error> for BindingsError { ... }
impl From<reqwest::Error> for BindingsError { ... }
impl From<tauri::Error> for BindingsError { ... }
// NOTE: No From<anyhow::Error> — anyhow is not a dependency of this crate
```

Add `thiserror` to the crate's `Cargo.toml` dependencies. (`thiserror = "2"` is already in the workspace root, so just add `thiserror.workspace = true` to the crate.)

### Phase 2: Migrate internal helpers (~1 hour)

Change helpers like `load_summary_list_item()` from `Result<T, String>` to `Result<T, BindingsError>`. This unlocks `?` operator with auto-conversion.

### Phase 3: Frontend error parsing

> **IMPORTANT**: This phase must happen BEFORE or simultaneously with Phase 4 (command migration). Changing the error shape from `String` to a serialized object will break frontend `catch(e) → String(e)` patterns — they'll render `"[object Object]"` instead of a readable message.

Update `@tracepilot/client` to parse structured errors:
```ts
interface TauriError {
  kind: string;
  message: string;
  context?: string;
}

function parseTauriError(raw: unknown): TauriError {
  if (typeof raw === 'object' && raw !== null && 'kind' in raw) {
    return raw as TauriError;
  }
  // Fallback for legacy string errors during migration
  return { kind: 'internal', message: String(raw) };
}
```

### Phase 4: Migrate Tauri commands incrementally

Because `BindingsError` derives `Serialize`, Tauri 2.10.3's blanket `impl<T: Serialize> From<T> for InvokeError` means commands can return `Result<T, BindingsError>` directly — no JSON stringify wrapper or manual `InvokeError` conversion needed:

```rust
#[tauri::command]
pub async fn get_sessions(...) -> Result<Vec<SessionListItem>, BindingsError> {
    // ? operator auto-converts source errors via From impls
    let sessions = load_sessions(...).await?;
    Ok(sessions)
}
```

Migrate commands in batches, coordinating with frontend changes from Phase 3.

### Acceptance Criteria
- All ~175 sites migrated (can verify with `grep -c "map_err.*to_string" lib.rs` = 0)
- Frontend can distinguish error kinds for at least: session_not_found, database_error, config_error
- All existing tests pass
- Manual test: error messages in UI are still readable

---

## A4: Add `[profile.release]` to Root Cargo.toml

```toml
# Add to root Cargo.toml
[profile.release]
lto = "thin"       # Good balance of compile time vs optimization
strip = true        # Remove debug symbols from binary
codegen-units = 1   # Better optimization, slower compile
opt-level = "s"     # Size-optimized but keeps more perf than "z" (better for desktop apps; "z" suits embedded/WASM)
```

### Acceptance Criteria
- `cargo build --release` succeeds
- Binary size is smaller than before (measure before/after)

---

## Review Notes

This plan was validated through a 4-model review process. Key corrections applied:

1. **A2 event_types.rs**: Fixed enum name (`SessionEventType`, not `EventType`), expect message (`"strum default variant makes this infallible"`), and noted that strum's `#[strum(default)]` makes the parse infallible.
2. **A2 events.rs**: Identified TWO guarded unwraps at lines 367–368 (`.first()` and `.last()`), not just one.
3. **A3 error architecture**: Removed incorrect Option A/B pattern. Tauri 2.10.3 has a blanket `impl<T: Serialize> From<T> for InvokeError`, so `Result<T, BindingsError>` works directly. Removed `From<anyhow::Error>` (not a dependency). Reordered phases so frontend error parsing (Phase 3) precedes command migration (Phase 4) to avoid `[object Object]` breakage. Added `thiserror` workspace note.
4. **A4 opt-level**: Changed `"z"` → `"s"` (better for desktop apps; `"z"` targets embedded/WASM).
5. **Scope**: Updated count from ~171 to ~175 mechanical replacements.
6. **Dependencies**: Added recommendation to do F1 (split lib.rs) before A3.
