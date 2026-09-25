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
//! The implementation is documented here and in the frontend helpers; no
//! separate ADR currently covers this migration.

mod bindings;
mod code;
mod scrub;
mod serialization;

pub use bindings::BindingsError;
pub(crate) use bindings::CmdResult;
pub use code::ErrorCode;
pub(crate) use scrub::scrub_message;

#[cfg(test)]
mod tests;
