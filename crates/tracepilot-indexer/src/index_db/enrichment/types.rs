//! Row shapes and version counters for session-store enrichment.

use serde::de::{Error as DeError, Unexpected};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use tracepilot_core::session_store::{
    AttributionStatus, SessionCoverage, SourceAvailability, SourceBinding, StoreCapabilities,
};

/// Bump when the enrichment extraction or storage format changes, forcing a
/// re-read of every cached session.
///
/// Deliberately separate from `CURRENT_ANALYTICS_VERSION`: enrichment comes
/// from an external file on its own refresh schedule, and tying the two would
/// mean every analytics change discarded enrichment that the store might not
/// be available to rebuild.
///
/// v1: initial per-request ledger, itemised billing and linked-work refs.
pub(crate) const CURRENT_ENRICHMENT_VERSION: i64 = 1;

/// Bump when the request-to-run/turn mapping logic changes, so stored links
/// are recomputed without discarding the request rows themselves.
///
/// v1: exact agent/tool linkage only; conservative turn mapping.
pub(crate) const CURRENT_MAPPING_VERSION: i64 = 1;

/// A bound source, as stored.
#[derive(Debug, Clone)]
pub(crate) struct StoreSourceRow {
    pub source_id: String,
    pub db_path: String,
    pub copilot_home: String,
    pub session_state_dir: String,
    pub generation: String,
    pub capability_fingerprint: Option<String>,
    pub source_schema_version: Option<i64>,
    pub capabilities: String,
    pub availability: String,
    /// A short diagnostic for a non-ready state. Never a path or a payload:
    /// routine status telemetry must not leak either.
    pub status_detail: Option<String>,
}

impl StoreSourceRow {
    /// Describe a source that opened successfully.
    pub(crate) fn ready(
        binding: &SourceBinding,
        generation: &str,
        capabilities: &StoreCapabilities,
    ) -> Self {
        Self {
            source_id: binding.source_id.clone(),
            db_path: binding.db_path.display().to_string(),
            copilot_home: binding.copilot_home.display().to_string(),
            session_state_dir: binding.session_state_dir.display().to_string(),
            generation: generation.to_string(),
            capability_fingerprint: Some(capabilities.fingerprint.clone()),
            source_schema_version: capabilities.schema_version,
            capabilities: capability_names(capabilities).join(","),
            availability: SourceAvailability::Ready.as_str().to_string(),
            status_detail: None,
        }
    }
}

/// Which capabilities this build found usable, for the Settings surface.
pub(crate) fn capability_names(capabilities: &StoreCapabilities) -> Vec<&'static str> {
    let mut names = Vec::new();
    if capabilities.supports_requests() {
        names.push("requests");
    }
    if capabilities.supports_work_refs() {
        names.push("workRefs");
    }
    if capabilities.supports_sessions() {
        names.push("sessions");
    }
    names
}

/// One request's join to TracePilot's own structure.
///
/// Stored apart from the request so a rewritten log or a changed
/// reconstructor can invalidate mappings without discarding the requests,
/// which remain useful in the ledger with no join at all.
#[derive(Debug, Clone)]
pub(crate) struct RequestLinkRow {
    pub source_row_id: i64,
    pub session_id: String,
    pub run_key: Option<String>,
    pub turn_index: Option<i64>,
    pub event_index: Option<i64>,
    pub join_method: &'static str,
    pub join_status: AttributionStatus,
    pub event_fingerprint: Option<String>,
}

/// How a request was attached, recorded so a reader can judge the claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum JoinMethod {
    /// The request's agent ID matched a reconstructed agent run.
    AgentId,
    /// The deprecated parent tool-call ID matched a tool execution.
    ParentToolCall,
    /// A uniquely identified compaction event matched on model, counters
    /// and time.
    CompactionEvent,
    /// No candidate. The request stays in the ledger unjoined.
    None,
}

impl JoinMethod {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::AgentId => "agentId",
            Self::ParentToolCall => "parentToolCallId",
            Self::CompactionEvent => "compactionEvent",
            Self::None => "none",
        }
    }
}

/// Everything one refresh wants to write for one session.
pub(crate) struct SessionEnrichmentWrite<'a> {
    pub source_id: &'a str,
    pub generation: &'a str,
    pub session_id: &'a str,
    pub requests: &'a [tracepilot_core::session_store::StoreRequest],
    pub work_refs: &'a [tracepilot_core::session_store::WorkRef],
    pub links: &'a [RequestLinkRow],
    pub coverage: &'a SessionCoverage,
}

/// Filters for reading the request ledger back out.
#[derive(Debug, Default, Clone)]
pub struct RequestLedgerFilter {
    pub session_id: Option<String>,
    pub models: Vec<String>,
    pub agent_ids: Vec<String>,
    pub initiators: Vec<String>,
    pub reasoning_efforts: Vec<String>,
    pub finish_reasons: Vec<String>,
    pub api_endpoints: Vec<String>,
    /// `Some(true)` keeps only requests with a positive recorded cache read;
    /// `Some(false)` keeps only those recording zero. Requests whose counter
    /// is absent are in neither population.
    pub reports_cache_reuse: Option<bool>,
    pub repository: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub limit: Option<usize>,
    /// Opaque cursor position, resolved by the caller from a page token.
    pub after: Option<RequestCursor>,
}

/// Where a page of the ledger resumes.
///
/// Carries the generation so a page cannot be continued across a source
/// replacement: the row IDs on the far side belong to different requests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestCursor {
    pub generation: String,
    /// Sort key of the last row returned. `recorded_at` alone is not unique,
    /// so the row ID breaks ties and makes paging stable.
    pub recorded_at: Option<String>,
    pub source_row_id: i64,
}

/// Cursors cross the wire as one opaque token.
///
/// Opaque because a client must not be able to assemble one: a hand-made
/// cursor could name a generation that no longer exists and silently read
/// rows from a different version of the source. Callers echo back the token
/// they were given, and a token from a superseded generation is rejected
/// rather than honoured.
impl Serialize for RequestCursor {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!(
            "v1.{}.{}.{}",
            self.generation,
            self.recorded_at.as_deref().unwrap_or(""),
            self.source_row_id
        ))
    }
}

impl<'de> Deserialize<'de> for RequestCursor {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let token = String::deserialize(deserializer)?;
        let invalid = || DeError::invalid_value(Unexpected::Str(&token), &"a ledger page token");
        let rest = token.strip_prefix("v1.").ok_or_else(invalid)?;
        // Split from the right: only the row ID and the timestamp have fixed
        // shapes, while a generation hash never contains a dot.
        let (generation, rest) = rest.split_once('.').ok_or_else(invalid)?;
        let (recorded_at, row_id) = rest.rsplit_once('.').ok_or_else(invalid)?;
        Ok(Self {
            generation: generation.to_string(),
            recorded_at: (!recorded_at.is_empty()).then(|| recorded_at.to_string()),
            source_row_id: row_id.parse().map_err(|_| invalid())?,
        })
    }
}

/// Largest page the ledger will return, whatever the caller asks for.
pub const MAX_REQUEST_PAGE: usize = 200;
/// Page size used when the caller does not specify one.
pub const DEFAULT_REQUEST_PAGE: usize = 50;
