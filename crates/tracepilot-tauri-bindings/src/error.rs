//! Typed error type for Tauri IPC command handlers.
//!
//! Replaces ad-hoc `map_err(|e| e.to_string())` patterns with a structured
//! enum that preserves error provenance while serialising cleanly for the
//! frontend via Tauri's `InvokeError`.

/// Unified error type for all `#[tauri::command]` handlers.
#[derive(Debug, thiserror::Error)]
pub enum BindingsError {
    /// Error from `tracepilot-core` (session parsing, discovery, etc.).
    #[error(transparent)]
    Core(#[from] tracepilot_core::TracePilotError),

    /// Error from `tracepilot-orchestrator` (worktrees, config, launcher).
    #[error(transparent)]
    Orchestrator(#[from] tracepilot_orchestrator::OrchestratorError),

    /// Error from the Copilot SDK bridge.
    #[error(transparent)]
    Bridge(#[from] tracepilot_orchestrator::bridge::BridgeError),

    /// Error from `tracepilot-indexer` (FTS, SQLite index operations).
    #[error(transparent)]
    Indexer(#[from] tracepilot_indexer::IndexerError),

    /// Async task panicked or was cancelled.
    #[error(transparent)]
    Join(#[from] tokio::task::JoinError),

    /// Filesystem I/O errors not wrapped by a domain crate.
    #[error(transparent)]
    Io(#[from] std::io::Error),

    /// Tauri runtime error (e.g. path resolution).
    #[error(transparent)]
    Tauri(#[from] tauri::Error),

    /// HTTP client error (GitHub update checks).
    #[error(transparent)]
    Reqwest(#[from] reqwest::Error),

    /// Semver parsing error (version checks).
    #[error(transparent)]
    Semver(#[from] semver::Error),

    /// UUID parsing error (session IDs).
    #[error(transparent)]
    Uuid(#[from] uuid::Error),

    /// Error from `tracepilot-export` (export/import pipeline).
    #[error(transparent)]
    Export(#[from] tracepilot_export::ExportError),

    /// TOML serialization error (config save).
    #[error(transparent)]
    TomlSerialize(#[from] toml::ser::Error),

    /// TOML deserialization error (config load).
    #[error(transparent)]
    TomlDeserialize(#[from] toml::de::Error),

    /// A reindex is already running; callers should retry later.
    #[error("ALREADY_INDEXING")]
    AlreadyIndexing,

    /// Input validation failed (user-facing message).
    #[error("{0}")]
    Validation(String),

    /// A lock (Mutex or RwLock) was poisoned because a thread panicked while
    /// holding it.  `context` identifies *which* lock to aid diagnosis.
    #[error("Internal error: {context} lock poisoned (a thread panicked while holding this lock)")]
    LockPoisoned { context: &'static str },

    /// Required internal state has not been initialized (e.g. the task DB was
    /// never opened).  This typically means the app startup sequence did not
    /// complete successfully.
    #[error("Internal state not initialized: {context}")]
    NotInitialized { context: &'static str },
}

// Tauri v2 requires command return errors to implement `Into<InvokeError>`.
// The canonical approach is to implement `Serialize` so Tauri can convert it.
impl serde::Serialize for BindingsError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Shorthand result alias used throughout the command modules.
pub(crate) type CmdResult<T> = Result<T, BindingsError>;

/// Convert a [`std::sync::PoisonError`] into a [`BindingsError::LockPoisoned`]
/// with the given context label.
///
/// Also emits a `tracing::error!` so every poison event appears in logs
/// regardless of how the caller handles the error.
///
/// # Usage
/// ```ignore
/// let guard = mutex.lock().map_err(lock_poison_err("TaskDb"))?;
/// ```
pub(crate) fn lock_poison_err<T>(
    context: &'static str,
) -> impl FnOnce(std::sync::PoisonError<T>) -> BindingsError {
    move |_| {
        tracing::error!(
            context,
            "Lock poisoned — a thread panicked while holding this lock"
        );
        BindingsError::LockPoisoned { context }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_poisoned_display() {
        let err = BindingsError::LockPoisoned { context: "TaskDb" };
        let msg = err.to_string();
        assert!(msg.contains("TaskDb"), "expected context in message: {msg}");
        assert!(
            msg.contains("lock poisoned"),
            "expected 'lock poisoned' in message: {msg}"
        );
    }

    #[test]
    fn not_initialized_display() {
        let err = BindingsError::NotInitialized { context: "TaskDb" };
        let msg = err.to_string();
        assert!(msg.contains("TaskDb"), "expected context in message: {msg}");
        assert!(
            msg.contains("not initialized"),
            "expected 'not initialized' in message: {msg}"
        );
    }

    #[test]
    fn lock_poisoned_serializes_to_display_string() {
        let err = BindingsError::LockPoisoned { context: "Config" };
        let json = serde_json::to_value(&err).expect("serialize");
        let s = json.as_str().expect("should be string");
        assert!(
            s.contains("Config"),
            "serialized form should contain context: {s}"
        );
    }

    #[test]
    fn not_initialized_serializes_to_display_string() {
        let err = BindingsError::NotInitialized {
            context: "TaskDb",
        };
        let json = serde_json::to_value(&err).expect("serialize");
        let s = json.as_str().expect("should be string");
        assert!(
            s.contains("TaskDb"),
            "serialized form should contain context: {s}"
        );
    }

    #[test]
    fn lock_poison_err_helper_produces_correct_variant() {
        let poison = std::sync::Mutex::new(42);
        // Poison the mutex
        let _res = std::thread::spawn({
            let p = &poison as *const _ as usize;
            move || {
                // SAFETY: we're in a test; just need to poison the lock
                let mutex = unsafe { &*(p as *const std::sync::Mutex<i32>) };
                let _guard = mutex.lock().unwrap();
                panic!("intentional poison");
            }
        })
        .join();

        let err = poison.lock().map_err(lock_poison_err("TestMutex"));
        assert!(err.is_err());
        let e = err.unwrap_err();
        assert!(
            matches!(e, BindingsError::LockPoisoned { context: "TestMutex" }),
            "expected LockPoisoned variant, got: {e:?}"
        );
    }
}
