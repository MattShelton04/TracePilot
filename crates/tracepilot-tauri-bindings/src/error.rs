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

    /// Mutex lock failure (poisoned or contention).
    #[error("Concurrency error: {0}")]
    Concurrency(String),
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
