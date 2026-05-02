//! Parser for `events.jsonl` — the line-delimited JSON event log.
//!
//! ## Pipeline
//!
//! ```text
//! events.jsonl
//!   → parse_events_jsonl()  → Vec<RawEvent>  (skip malformed lines)
//!   → parse_typed_events()  → ParsedEvents { events: Vec<TypedEvent>, diagnostics }
//! ```
//!
//! Each line is a JSON object with at minimum: `{ type, data, id, timestamp }`.
//! Events form a tree via `parentId` and are linked by `interactionId`, `toolCallId`, `turnId`.
//!
//! Unknown event types and deserialization failures are tracked in
//! [`ParseDiagnostics`](crate::parsing::diagnostics::ParseDiagnostics) rather than being
//! silently swallowed, enabling debugging and parse-quality reporting.
//!
//! ## Submodules
//!
//! - [`raw`] — [`RawEvent`] envelope and line-oriented JSONL parsing.
//! - [`typed`] — [`TypedEvent`]/[`TypedEventData`] enums and typed deserialization.
//! - [`aggregate`] — Session-level extraction helpers (shutdown merge, session start).

mod aggregate;
mod raw;
#[cfg(test)]
mod tests;
mod typed;

pub use aggregate::{extract_combined_shutdown_data, extract_session_start};
pub use raw::RawEvent;
pub use typed::{
    ParsedEvents, TypedEvent, TypedEventData, parse_typed_events, parse_typed_events_if_exists,
};

#[cfg(test)]
pub(crate) use typed::typed_data_from_raw;
