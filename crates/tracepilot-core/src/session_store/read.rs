//! Reading one session's worth of enrichment from the source.
//!
//! The unit of work is a whole session: probe, read its rows inside one short
//! transaction, release the source, then hand the caller a value it can
//! replace atomically in TracePilot's own index. Nothing here writes, and
//! nothing here holds the source open while the index is written — a long
//! reader on a WAL database delays the CLI's own checkpoints.

mod coverage;
mod refs;
mod requests;

pub use coverage::{CoverageBuilder, SessionCoverage};
pub use refs::{MAX_REFS_PER_SESSION, list_session_ids, read_session_meta, read_session_refs};
pub use requests::{MAX_REQUESTS_PER_SESSION, read_session_requests};

use chrono::Utc;

use super::capability::{TABLE_USAGE, USAGE_COLUMNS};
use super::error::Result;
use super::model::{StoreRequest, StoreSessionMeta};
use super::open::SourceReader;
use super::status::SourceAvailability;
use super::work_ref::WorkRef;

/// Everything this adapter offers about one session.
#[derive(Debug, Clone)]
pub struct SessionEnrichment {
    pub session_id: String,
    pub meta: Option<StoreSessionMeta>,
    pub requests: Vec<StoreRequest>,
    pub work_refs: Vec<WorkRef>,
    pub coverage: SessionCoverage,
}

impl SessionEnrichment {
    /// Whether this read may prune previously cached rows for the session.
    ///
    /// Only a successful read that genuinely found nothing qualifies. A
    /// truncated or failed read produces an empty value too, and treating
    /// those the same would delete good data whenever the CLI held a lock.
    pub fn may_prune(&self) -> bool {
        self.coverage.is_successful()
    }
}

/// Read one session inside a short deferred read transaction.
///
/// The transaction gives the requests, references and metadata a single
/// consistent view of the source; it is committed before the caller writes
/// anything of its own.
pub fn read_session(reader: &SourceReader, session_id: &str) -> Result<SessionEnrichment> {
    let transaction = reader
        .connection()
        .unchecked_transaction()
        .map_err(|error| super::error::SessionStoreError::from_sqlite(&error))?;
    let generation = reader.generation_fingerprint()?;
    let capabilities = reader.capabilities();
    let mut coverage = CoverageBuilder::new(session_id, &reader.binding().source_id, generation)
        .with_schema(
            capabilities.schema_version,
            capabilities.missing_columns(TABLE_USAGE, USAGE_COLUMNS),
        );

    let meta = read_session_meta(reader, session_id)?;
    let repository = meta.as_ref().and_then(|meta| meta.repository.as_deref());

    let requests = read_session_requests(reader, session_id, &mut coverage)?;
    coverage.accept_request_rows(requests.len());

    let work_refs = read_session_refs(reader, session_id, repository, &mut coverage)?;
    coverage.accept_work_ref_rows(work_refs.len());

    transaction
        .commit()
        .map_err(|error| super::error::SessionStoreError::from_sqlite(&error))?;
    Ok(SessionEnrichment {
        session_id: session_id.to_string(),
        meta,
        requests,
        work_refs,
        coverage: coverage.build(SourceAvailability::Ready, Utc::now().to_rfc3339()),
    })
}
