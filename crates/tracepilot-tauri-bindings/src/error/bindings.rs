use super::ErrorCode;

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

    /// ZIP archive creation error.
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),

    /// Directory traversal error.
    #[error(transparent)]
    WalkDir(#[from] walkdir::Error),

    /// Path prefix stripping error.
    #[error(transparent)]
    StripPrefix(#[from] std::path::StripPrefixError),

    /// A reindex is already running; callers should retry later.
    #[error("Indexing is already in progress.")]
    AlreadyIndexing,

    /// Input validation failed (user-facing message).
    #[error("{0}")]
    Validation(String),

    /// Server-side infrastructure failure (mutex poison, invariant violation).
    ///
    /// Not caused by user input — always indicates a bug or panic in the
    /// server. Serialises as `{"code": "INTERNAL", "message": "..."}`.
    #[error("{0}")]
    Internal(String),
}

impl From<tracepilot_orchestrator::skills::SkillsError> for BindingsError {
    fn from(e: tracepilot_orchestrator::skills::SkillsError) -> Self {
        Self::Orchestrator(e.into())
    }
}

impl From<tracepilot_orchestrator::mcp::McpError> for BindingsError {
    fn from(e: tracepilot_orchestrator::mcp::McpError) -> Self {
        Self::Orchestrator(e.into())
    }
}

impl BindingsError {
    /// Stable, machine-readable error code. The frontend branches on this.
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::Core(_) => ErrorCode::Core,
            Self::Orchestrator(_) => ErrorCode::Orchestrator,
            Self::Bridge(_) => ErrorCode::Bridge,
            Self::Indexer(_) => ErrorCode::Indexer,
            Self::Export(_) => ErrorCode::Export,
            Self::Join(_) => ErrorCode::Join,
            Self::Io(_) | Self::Zip(_) | Self::WalkDir(_) | Self::StripPrefix(_) => ErrorCode::Io,
            Self::Tauri(_) => ErrorCode::Tauri,
            Self::Reqwest(_) => ErrorCode::Network,
            Self::Semver(_) | Self::Uuid(_) => ErrorCode::Parse,
            Self::TomlSerialize(_) | Self::TomlDeserialize(_) => ErrorCode::Serialization,
            Self::AlreadyIndexing => ErrorCode::AlreadyIndexing,
            Self::Validation(_) => ErrorCode::Validation,
            Self::Internal(_) => ErrorCode::Internal,
        }
    }
}

/// Shorthand result alias used throughout the command modules.
pub(crate) type CmdResult<T> = Result<T, BindingsError>;
