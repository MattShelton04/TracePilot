//! Redaction engine — walks a [`crate::document::SessionArchive`] and applies pattern-based
//! scrubbing to sensitive fields.
//!
//! # Architecture
//!
//! The engine applies three optional categories of redaction:
//! - **Paths:** Anonymize filesystem paths (Windows, Unix home, abs paths)
//! - **Secrets:** Strip API keys, tokens, passwords, env var assignments
//! - **PII:** Remove email addresses and IP addresses
//!
//! Each category can be independently toggled via [`crate::options::RedactionOptions`].
//! The engine traverses all string-bearing fields in the archive, including
//! recursive JSON values in raw events, tool arguments, and custom tables.

mod engine;
pub mod patterns;
mod policy;
mod primitives;
mod stats;

pub use engine::apply_redaction;
pub use stats::RedactionStats;

#[cfg(test)]
mod tests;
