//! Cached enrichment from the Copilot CLI's cross-session store.
//!
//! This is the persistence half of `tracepilot_core::session_store`: the core
//! crate reads and normalises the external file, and this module stores the
//! result, reads it back and decides when a session is worth refreshing.
//!
//! Its lifecycle is deliberately independent of baseline indexing. Baseline
//! staleness is a fingerprint of `events.jsonl`, but request rows appear in
//! the store without the log changing at all, and the store can be missing or
//! locked exactly when the log does change. Coupling the two would mean
//! enrichment refreshed at the wrong times and was discarded at the worst
//! ones — so these tables are absent from
//! [`super::session_writer`]'s unconditional delete list and are refreshed by
//! their own pass, following the `search_content` precedent.

mod attribution;
mod lifecycle;
mod model;
mod reader;
mod rows;
mod summary;
mod types;
mod writer;

pub use model::{
    RequestLedgerFacets, RequestLedgerPage, RequestLedgerSummary, SessionCoverageRow,
    StoreSourceStatus, StoredBillingItem, StoredRequest, StoredWorkRef,
};
pub use types::{DEFAULT_REQUEST_PAGE, MAX_REQUEST_PAGE, RequestCursor, RequestLedgerFilter};

pub(crate) use types::{SessionEnrichmentWrite, StoreSourceRow};
