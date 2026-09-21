//! Read-only enrichment from the Copilot CLI's cross-session store.
//!
//! Since CLI 1.0.40 the agent keeps `~/.copilot/session-store.db`: session
//! metadata, flattened turns, compaction checkpoints, touched files, extracted
//! PR/issue/commit references and — the reason this module exists — one row
//! per model request with its tokens, timings and recorded charge. The
//! `assistant.usage` event that carries the same request detail live is marked
//! ephemeral and never reaches `events.jsonl`, so for historical sessions this
//! file is the only local record of where the credits and the latency went.
//!
//! ## What this module is not
//!
//! It is not a replacement for `events.jsonl`, which stays authoritative for
//! everything TracePilot already shows. It is not a billing statement. It is
//! not a record of every request — only 18 of 391 locally logged sessions had
//! any request rows at all, so **absence of rows is not evidence of zero
//! usage**, and every figure derived here travels with its
//! [`SessionCoverage`].
//!
//! ## Rules this module enforces
//!
//! - **Read-only, always.** The CLI writes this file live in WAL mode. Every
//!   connection is `SQLITE_OPEN_READ_ONLY` plus `query_only`, with a busy
//!   timeout and a total budget. No `VACUUM`, no checkpoint, no migration, no
//!   `immutable=1`, and never [`crate::utils::sqlite::configure_connection`],
//!   which would try to reconfigure a database this process does not own.
//! - **Capabilities, not versions.** `schema_version` has been seen at 1 and
//!   at 8 for near-identical schemas. [`StoreCapabilities`] probes the real
//!   tables and columns, and a feature that loses one optional column shows
//!   that cell as unavailable rather than disabling itself.
//! - **Absence, failure and emptiness are three different states.** See
//!   [`SourceAvailability`]. Only a successful read that found nothing may
//!   prune cached rows.
//! - **Source binding before session eligibility.** The store is global to a
//!   machine. A session qualifies only when it came from the same Copilot home
//!   ([`SourceBinding::owns_session_dir`]); a matching UUID on an imported
//!   session must not acquire unrelated telemetry.
//! - **No transcripts.** Only counters, timings, billing entries, references
//!   and provenance are read. Prompts, responses, FTS content and checkpoint
//!   prose stay in the source.
//!
//! The full investigation, including the field-level evidence behind these
//! rules, is in `docs/features/copilot-session-store-enrichment-design.md`.

pub mod billing;
mod capability;
pub mod decimal;
mod error;
mod model;
mod open;
mod read;
mod reconcile;
mod stats;
mod status;
mod values;
mod work_ref;

pub use billing::BillingCheck;
pub use capability::{
    REFS_COLUMNS, SESSION_COLUMNS, StoreCapabilities, TABLE_CHECKPOINTS, TABLE_REFS,
    TABLE_SESSIONS, TABLE_TURNS, TABLE_USAGE, USAGE_COLUMNS,
};
pub use decimal::{ExactDecimal, Rational};
pub use error::{Result, SessionStoreError};
pub use model::{
    BillingItem, BillingItemsStatus, RequestInitiator, SessionPresence, StoreRequest,
    StoreSessionMeta,
};
pub use open::{DEFAULT_BUSY_TIMEOUT_MS, DEFAULT_READ_BUDGET_MS, SourceBinding, SourceReader};
pub use read::{
    CoverageBuilder, MAX_REFS_PER_SESSION, MAX_REQUESTS_PER_SESSION, SessionCoverage,
    SessionEnrichment, list_session_ids, read_session, read_session_meta, read_session_refs,
    read_session_requests,
};
pub use reconcile::{ReconciliationScope, reconcile_session};
pub use stats::{
    LatencyDistribution, MIN_SAMPLES_FOR_P95, RequestPerformance, cache_reuse, quantile,
    request_performance,
};
pub use status::{
    AttributionStatus, FieldCoverage, Freshness, ReconciliationReport, ReconciliationStatus,
    SourceAvailability,
};
pub use work_ref::{RefResolution, WorkRef, WorkRefKind};

#[cfg(test)]
mod tests;
