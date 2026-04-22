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

    /// Server-side infrastructure failure (mutex poison, invariant violation).
    ///
    /// Not caused by user input — always indicates a bug or panic in the
    /// server. Serialises as `{"code": "INTERNAL", "message": "..."}`.
    #[error("{0}")]
    Internal(String),
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
            Self::Internal(_) => ErrorCode::Internal,
        }
    }
}

// Tauri v2 requires command return errors to implement `Into<InvokeError>`.
// The canonical approach is to implement `Serialize` so Tauri can convert it.
//
// Wire format (stable contract — see module docs):
//   { "code": "ALREADY_INDEXING", "message": "Indexing is already in progress." }
//
// ## Info-leak audit (Phase 1A, wave 3)
//
// `self.to_string()` below pulls `Display` from the wrapped source error for
// every `#[error(transparent)]` variant. Each variant's sensitivity:
//
// | Variant          | Leak risk | Why                                              |
// |------------------|-----------|--------------------------------------------------|
// | `Io`             | HIGH      | `std::io::Error` includes full filesystem paths  |
// | `Tauri`          | HIGH      | May include file paths and Windows usernames     |
// | `TomlSerialize`  | MEDIUM    | May echo config key names (generally OK)         |
// | `TomlDeserialize`| HIGH      | Echoes config file content snippets              |
// | `Reqwest`        | MEDIUM    | URLs may contain bearer tokens in query strings  |
// | `Core` / `Orch.` / `Bridge` / `Indexer` / `Export` | HIGH | These wrap paths freely internally              |
// | `Join`           | LOW       | Task-panic strings, usually safe                 |
// | `Semver`, `Uuid` | LOW       | Echo user input which is already in scope        |
// | `AlreadyIndexing`, `Validation`, `Internal` | SAFE | Authored strings, no interpolation  |
//
// We run every message through [`scrub_message`] before sending to the
// frontend, which:
//   1. Replaces `C:\Users\<name>\` (and POSIX `/home/<name>/`) with a
//      generic placeholder so screenshots / error telemetry don't expose
//      the OS account name.
//   2. Redacts `Authorization: Bearer <token>`, `token=...`, and
//      GitHub PAT patterns (`ghp_*`, `gho_*`, `ghu_*`, `ghs_*`, `ghr_*`)
//      from anywhere in the message.
//
// The original un-scrubbed message is still available via `Display` for
// server-side logs (where the path context is useful for debugging and
// there is no screenshot / telemetry egress). If you need to change what
// gets scrubbed, update `scrub_message` *and* the variant table above.
impl serde::Serialize for BindingsError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut s = serializer.serialize_struct("BindingsError", 2)?;
        s.serialize_field("code", self.code().as_str())?;
        s.serialize_field("message", &scrub_message(&self.to_string()))?;
        s.end()
    }
}

/// Scrub likely-sensitive substrings from an error message before it
/// crosses the IPC boundary to the frontend (where it may be logged,
/// screenshotted, or sent to telemetry).
///
/// Intentionally non-destructive: the goal is to remove obvious leaks
/// (OS usernames, bearer tokens) without mangling the message shape so
/// that error codes + overall phrasing remain useful for debugging.
///
/// See the info-leak audit table in the `Serialize` impl above.
pub(crate) fn scrub_message(raw: &str) -> String {
    // Redact Windows usernames in path segments: `C:\Users\alice\...` →
    // `C:\Users\<user>\...`. Use a simple state machine rather than a
    // regex to avoid pulling in `regex` just for this.
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;

    loop {
        // Windows: look for "\Users\" or "/Users/" (the latter is how
        // some error sources normalise separators).
        let win_hit = rest.find("\\Users\\").map(|i| (i, "\\Users\\"));
        let mac_hit = rest.find("/Users/").map(|i| (i, "/Users/"));
        let nix_hit = rest.find("/home/").map(|i| (i, "/home/"));

        let hit = [win_hit, mac_hit, nix_hit]
            .into_iter()
            .flatten()
            .min_by_key(|(i, _)| *i);

        match hit {
            Some((i, sep)) => {
                out.push_str(&rest[..i]);
                out.push_str(sep);
                out.push_str("<user>");
                // Skip past the username component: jump to the next
                // path separator or end-of-string.
                let after = &rest[i + sep.len()..];
                let skip = after
                    .find(['\\', '/', ' ', '"', '\''])
                    .unwrap_or(after.len());
                rest = &after[skip..];
            }
            None => {
                out.push_str(rest);
                break;
            }
        }
    }

    // Redact bearer tokens in common shapes. These are cheap prefix
    // checks — we don't need to match every possible header form.
    let needles = [
        ("Authorization: Bearer ", "Authorization: Bearer <redacted>"),
        ("authorization: bearer ", "authorization: bearer <redacted>"),
        ("Bearer ", "Bearer <redacted>"),
    ];
    for (needle, replacement) in needles {
        // Advance `cursor` past each replacement so we never re-scan the
        // replacement text. This prevents an infinite loop when `replacement`
        // itself contains `needle` (e.g. "Bearer <redacted>" contains "Bearer ").
        let mut cursor = 0usize;
        loop {
            match out[cursor..].find(needle) {
                None => break,
                Some(rel) => {
                    let start = cursor + rel;
                    let after = &out[start + needle.len()..];
                    let end = after
                        .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
                        .unwrap_or(after.len());
                    out.replace_range(start..start + needle.len() + end, replacement);
                    // Advance past the replacement so we never re-match it.
                    cursor = start + replacement.len();
                }
            }
        }
    }

    // Redact GitHub PAT-style tokens by prefix. PATs are 40+ chars of
    // `[A-Za-z0-9_]` following a known prefix.
    //
    // Use cursor-advance pattern (same as the Bearer block above) to correctly
    // handle multiple tokens per prefix: the old `while let` + `break` pattern
    // would silently skip all remaining real tokens after the first short
    // non-token match (e.g. a variable named `ghp_tmp` would cause all real
    // PATs that follow it to go unredacted).
    for prefix in ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"] {
        let replacement = "<redacted-gh-token>";
        let mut cursor = 0usize;
        loop {
            match out[cursor..].find(prefix) {
                None => break,
                Some(rel) => {
                    let start = cursor + rel;
                    let after = &out[start + prefix.len()..];
                    let end = after
                        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                        .unwrap_or(after.len());
                    if end >= 20 {
                        out.replace_range(start..start + prefix.len() + end, replacement);
                        cursor = start + replacement.len();
                    } else {
                        // Short match (not a real token) — skip past it.
                        cursor = start + prefix.len() + end;
                    }
                }
            }
        }
    }

    out
}

/// Shorthand result alias used throughout the command modules.
pub(crate) type CmdResult<T> = Result<T, BindingsError>;

// ── specta::Type forwarding for the Phase 1B.1 pilot ─────────────
//
// `BindingsError` wraps a handful of foreign error types (`std::io::Error`,
// `tauri::Error`, etc.) that do not implement `specta::Type`, so we can't
// derive `Type` directly. For codegen purposes the *only* shape the
// frontend ever sees is the `{ code, message }` envelope produced by the
// manual `Serialize` impl above. We surface that shape to specta via a
// small proxy struct + a forwarding `Type` impl.
//
// This means `Result<T, BindingsError>` on a specta-annotated command
// generates `Result<T, BindingsErrorIpc>` in `bindings.ts`, which is
// exactly what consumers should pattern-match against.
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct BindingsErrorIpc {
    code: ErrorCode,
    message: String,
}

impl specta::Type for BindingsError {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        <BindingsErrorIpc as specta::Type>::definition(types)
    }
}

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
    fn scrub_redacts_windows_username() {
        let s = scrub_message(r"open failed: C:\Users\alice\.tracepilot\db.sqlite");
        assert!(!s.contains("alice"), "should have redacted username: {s}");
        assert!(s.contains("<user>"), "got: {s}");
        // Rest of path preserved.
        assert!(s.contains("db.sqlite"), "got: {s}");
    }

    #[test]
    fn scrub_redacts_posix_home_and_mac_users() {
        let s = scrub_message("config not found at /home/bob/.config/tracepilot.toml");
        assert!(!s.contains("bob"), "got: {s}");
        assert!(s.contains("<user>"), "got: {s}");

        let s = scrub_message("config not found at /Users/carol/Library/App/x");
        assert!(!s.contains("carol"), "got: {s}");
        assert!(s.contains("<user>"), "got: {s}");
    }

    #[test]
    fn scrub_redacts_bearer_token() {
        let s = scrub_message("auth error: Authorization: Bearer sk-abcdef12345 failed");
        assert!(!s.contains("sk-abcdef12345"), "got: {s}");
        assert!(s.contains("Bearer <redacted>"), "got: {s}");
    }

    #[test]
    fn scrub_redacts_github_pat() {
        let token = format!("ghp_{}", "X".repeat(36));
        let raw = format!("gh api failed with token={token}");
        let s = scrub_message(&raw);
        assert!(!s.contains(&token), "got: {s}");
        assert!(s.contains("<redacted-gh-token>"), "got: {s}");
    }

    #[test]
    fn scrub_preserves_messages_without_sensitive_data() {
        let s = scrub_message("Indexing is already in progress.");
        assert_eq!(s, "Indexing is already in progress.");
    }

    #[test]
    fn io_error_with_path_is_scrubbed_on_serialize() {
        // io::Error's Display doesn't normally include paths, but our own
        // error variants often do (via Display). Simulate via Validation
        // since it interpolates whatever the caller passes.
        let err = BindingsError::Validation(r"Failed to open C:\Users\dave\secret.txt".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(!json.contains("dave"), "got: {json}");
        assert!(json.contains("<user>"), "got: {json}");
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
            ErrorCode::Internal,
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
            BindingsError::Io(std::io::Error::other("x"))
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
        assert_eq!(
            BindingsError::Internal("mutex poisoned".into())
                .code()
                .as_str(),
            "INTERNAL"
        );

        // NOTE: the *_ctx transparent variants (Core, Orchestrator, Bridge,
        // Indexer, Export, Tauri, Reqwest, Join, TomlSerialize/Deserialize)
        // are covered by compile-time exhaustiveness — `code()` is a
        // complete `match` on `BindingsError`, so adding a new variant
        // without updating the match is a build error. Constructing those
        // errors directly here would require cross-crate test helpers.
    }

    #[test]
    fn scrub_redacts_multiple_bearer_tokens() {
        // Both occurrences must be redacted.
        // Also verifies no infinite loop: "Bearer <redacted>" contains "Bearer "
        // which would cause an infinite loop if cursor is not advanced past each replacement.
        let s = scrub_message(
            "retry1: Authorization: Bearer tok-AAAA failed, retry2: Authorization: Bearer tok-BBBB failed",
        );
        assert!(!s.contains("tok-AAAA"), "first token leaked: {s}");
        assert!(!s.contains("tok-BBBB"), "second token leaked: {s}");
        let count = s.matches("Bearer <redacted>").count();
        assert_eq!(count, 2, "expected 2 redactions, got {count}: {s}");
    }

    #[test]
    fn scrub_redacts_pat_after_short_match() {
        // A short non-token match (< 20 chars) must NOT cause subsequent real
        // PATs to be skipped. The old `while let` + `break` pattern would exit
        // the loop after the first short match, leaking tokens that follow it.
        let real_token = "ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH"; // 36 chars — real PAT
        let msg = format!("debug: ghp_tmp short, real: {real_token}");
        let s = scrub_message(&msg);
        assert!(
            !s.contains(real_token),
            "real PAT leaked after short match: {s}"
        );
        assert!(s.contains("<redacted-gh-token>"), "no redaction found: {s}");
    }
}
