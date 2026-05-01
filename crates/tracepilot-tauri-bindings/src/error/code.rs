/// Stable error-code identifiers surfaced to the frontend.
///
/// These are a **public contract** — changing a variant name is a breaking
/// change for the desktop app. Add new variants instead of renaming existing
/// ones. The discriminant is written to the IPC envelope as `code`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    // ── Infrastructure / plumbing ────────────────────────────────
    Io,
    Tauri,
    Network,
    Join,
    Parse,
    Serialization,
    Internal,

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
            Self::Internal => "INTERNAL",
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
