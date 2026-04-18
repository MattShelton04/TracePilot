//! Typed error type for Tauri IPC command handlers.
//!
//! Replaces ad-hoc `map_err(|e| e.to_string())` patterns with a structured
//! enum that preserves error provenance while serialising cleanly for the
//! frontend via Tauri's `InvokeError`.
//!
//! ## Wire format
//!
//! Errors serialise as a stable JSON envelope:
//!
//! ```json
//! { "code": "ALREADY_INDEXING", "message": "Indexing is already in progress." }
//! ```
//!
//! The frontend can branch on `code` via the helpers in
//! `apps/desktop/src/utils/backendErrors.ts`; `message` is always a
//! human-readable fallback that `toErrorMessage()` picks up automatically.
//!
//! See ADR `docs/adr/0005-structured-ipc-errors.md` (pending) for the
//! migration plan away from stringified errors.

use serde::ser::SerializeStruct;

/// Stable error-code identifiers surfaced to the frontend.
///
/// These are a **public contract** — changing a variant name is a breaking
/// change for the desktop app. Add new variants instead of renaming existing
/// ones. The discriminant is written to the IPC envelope as `code`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    // ── Infrastructure / plumbing ────────────────────────────────
    Io,
    Tauri,
    Network,
    Join,
    Parse,
    Serialization,

    // ── Domain: core ─────────────────────────────────────────────
    Core,

    // ── Domain: orchestrator ─────────────────────────────────────
    Orchestrator,

    // ── Domain: bridge (Copilot SDK) ─────────────────────────────
    Bridge,

    // ── Domain: indexer ──────────────────────────────────────────
    Indexer,

    // ── Domain: export / import ──────────────────────────────────
    Export,

    // ── Business / user-visible ─────────────────────────────────
    AlreadyIndexing,
    Validation,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Io => "IO",
            Self::Tauri => "TAURI",
            Self::Network => "NETWORK",
            Self::Join => "JOIN",
            Self::Parse => "PARSE",
            Self::Serialization => "SERIALIZATION",
            Self::Core => "CORE",
            Self::Orchestrator => "ORCHESTRATOR",
            Self::Bridge => "BRIDGE",
            Self::Indexer => "INDEXER",
            Self::Export => "EXPORT",
            Self::AlreadyIndexing => "ALREADY_INDEXING",
            Self::Validation => "VALIDATION",
        }
    }
}

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
    #[error("Indexing is already in progress.")]
    AlreadyIndexing,

    /// Input validation failed (user-facing message).
    #[error("{0}")]
    Validation(String),
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
            Self::Io(_) => ErrorCode::Io,
            Self::Tauri(_) => ErrorCode::Tauri,
            Self::Reqwest(_) => ErrorCode::Network,
            Self::Semver(_) | Self::Uuid(_) => ErrorCode::Parse,
            Self::TomlSerialize(_) | Self::TomlDeserialize(_) => ErrorCode::Serialization,
            Self::AlreadyIndexing => ErrorCode::AlreadyIndexing,
            Self::Validation(_) => ErrorCode::Validation,
        }
    }
}

// Tauri v2 requires command return errors to implement `Into<InvokeError>`.
// The canonical approach is to implement `Serialize` so Tauri can convert it.
//
// Wire format (stable contract — see module docs):
//   { "code": "ALREADY_INDEXING", "message": "Indexing is already in progress." }
impl serde::Serialize for BindingsError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut s = serializer.serialize_struct("BindingsError", 2)?;
        s.serialize_field("code", self.code().as_str())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

/// Shorthand result alias used throughout the command modules.
pub(crate) type CmdResult<T> = Result<T, BindingsError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn already_indexing_serializes_with_stable_code() {
        let err = BindingsError::AlreadyIndexing;
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains(r#""code":"ALREADY_INDEXING""#), "got: {json}");
        assert!(json.contains(r#""message":"#), "got: {json}");
    }

    #[test]
    fn validation_emits_message_verbatim() {
        let err = BindingsError::Validation("bad input".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains(r#""code":"VALIDATION""#));
        assert!(json.contains(r#""message":"bad input""#));
    }

    #[test]
    fn all_error_codes_are_stable_ascii() {
        for c in [
            ErrorCode::Io,
            ErrorCode::Tauri,
            ErrorCode::Network,
            ErrorCode::Join,
            ErrorCode::Parse,
            ErrorCode::Serialization,
            ErrorCode::Core,
            ErrorCode::Orchestrator,
            ErrorCode::Bridge,
            ErrorCode::Indexer,
            ErrorCode::Export,
            ErrorCode::AlreadyIndexing,
            ErrorCode::Validation,
        ] {
            let s = c.as_str();
            assert!(!s.is_empty());
            assert!(s.chars().all(|ch| ch.is_ascii_uppercase() || ch == '_'));
        }
    }

    /// Every concrete `BindingsError` variant must map to a stable `code`
    /// string. This test pins the contract end-to-end so a future
    /// refactor of either `ErrorCode` or the `code()` match can't silently
    /// shift what the frontend sees.
    #[test]
    fn every_variant_maps_to_stable_code() {
        // Infrastructure / plumbing ------------------------------
        assert_eq!(
            BindingsError::Io(std::io::Error::new(std::io::ErrorKind::Other, "x"))
                .code()
                .as_str(),
            "IO"
        );
        assert_eq!(
            BindingsError::Semver(semver::Version::parse("not-a-version").unwrap_err())
                .code()
                .as_str(),
            "PARSE"
        );
        assert_eq!(
            BindingsError::Uuid(uuid::Uuid::parse_str("bad-uuid").unwrap_err())
                .code()
                .as_str(),
            "PARSE"
        );

        // Business / user-visible --------------------------------
        assert_eq!(
            BindingsError::AlreadyIndexing.code().as_str(),
            "ALREADY_INDEXING"
        );
        assert_eq!(
            BindingsError::Validation("x".into()).code().as_str(),
            "VALIDATION"
        );

        // NOTE: the *_ctx transparent variants (Core, Orchestrator, Bridge,
        // Indexer, Export, Tauri, Reqwest, Join, TomlSerialize/Deserialize)
        // are covered by compile-time exhaustiveness — `code()` is a
        // complete `match` on `BindingsError`, so adding a new variant
        // without updating the match is a build error. Constructing those
        // errors directly here would require cross-crate test helpers.
    }
}
