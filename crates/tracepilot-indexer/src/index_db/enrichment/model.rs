//! Shapes returned from the enrichment cache.
//!
//! Exact decimals (nano AI units, per-batch rates) stay `String` all the way
//! out. A nano-AIU total routinely exceeds JavaScript's safe integer range,
//! and a rate is routinely a decimal binary floating point cannot hold, so
//! converting either to a number anywhere on this path would corrupt the
//! figure the feature exists to explain.

use serde::{Deserialize, Serialize};

use super::types::RequestCursor;

/// One cached request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRequest {
    pub source_id: String,
    pub generation: String,
    pub source_row_id: i64,
    pub session_id: String,
    /// The source's own interaction counter. Not a TracePilot turn index,
    /// and not a navigation target on its own.
    pub source_turn_index: Option<i64>,
    pub agent_id: Option<String>,
    pub parent_tool_call_id: Option<String>,
    pub model: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_write_tokens: Option<i64>,
    pub reasoning_tokens: Option<i64>,
    /// Exact decimal string of nano AI units.
    pub total_nano_aiu: Option<String>,
    pub request_multiplier: Option<String>,
    pub duration_ms: Option<f64>,
    pub time_to_first_token_ms: Option<f64>,
    pub output_ttft_ms: Option<f64>,
    pub inter_token_latency_ms: Option<f64>,
    pub initiator: Option<String>,
    pub api_endpoint: Option<String>,
    pub reasoning_effort: Option<String>,
    pub finish_reason: Option<String>,
    pub content_filter_triggered: Option<bool>,
    pub copilot_usage_model: Option<String>,
    pub billing_items_status: String,
    /// exact | differs | notComparable | incomputable.
    pub billing_check: String,
    pub recorded_at: Option<String>,
    /// Source columns whose cells were unusable on this row.
    pub invalid_fields: Vec<String>,
    pub row_fingerprint: String,
    pub billing_items: Vec<StoredBillingItem>,
}

/// One itemised billing entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBillingItem {
    pub ordinal: i64,
    pub token_type: String,
    pub token_count: Option<i64>,
    pub batch_size: Option<i64>,
    /// Exact decimal string, nano AI units per batch.
    pub cost_per_batch: Option<String>,
    /// Recorded billing model: the entry's own, else the request default.
    /// Never the execution model, which would be inferred attribution.
    pub billing_model: Option<String>,
}

/// One page of the ledger.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLedgerPage {
    pub requests: Vec<StoredRequest>,
    pub next_cursor: Option<RequestCursor>,
    pub generation: Option<String>,
    /// False when the enrichment tables do not exist or nothing is bound.
    /// Distinct from an empty page, which means the source genuinely
    /// recorded no requests for this filter.
    pub available: bool,
    /// True when the supplied cursor belonged to a superseded generation.
    /// The caller restarts from the first page rather than silently mixing
    /// rows from two versions of the source.
    pub cursor_expired: bool,
}

impl RequestLedgerPage {
    pub(crate) fn unavailable() -> Self {
        Self {
            requests: Vec::new(),
            next_cursor: None,
            generation: None,
            available: false,
            cursor_expired: false,
        }
    }

    pub(crate) fn stale_cursor(generation: String) -> Self {
        Self {
            requests: Vec::new(),
            next_cursor: None,
            generation: Some(generation),
            available: true,
            cursor_expired: true,
        }
    }
}

/// One cached linked-work reference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredWorkRef {
    pub identity: String,
    pub session_id: String,
    pub source_row_id: Option<i64>,
    pub kind: String,
    pub raw_value: String,
    pub normalized_value: String,
    pub resolved_host: Option<String>,
    pub resolved_repository: Option<String>,
    pub candidate_repository: Option<String>,
    /// explicit | sessionContext | unresolved. Only `explicit` may be
    /// presented as a verified link.
    pub resolution: String,
    /// Whether a Git ref is 7–40 hex characters. A candidate commit, not
    /// proof the commit exists anywhere.
    pub sha_shaped: bool,
    pub source_turn_index: Option<i64>,
    pub recorded_at: Option<String>,
}

/// One session's refresh completeness.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCoverageRow {
    pub session_id: String,
    pub generation: String,
    pub availability: String,
    pub freshness: String,
    pub request_rows: i64,
    pub request_rows_rejected: i64,
    pub work_ref_rows: i64,
    pub work_ref_rows_rejected: i64,
    pub billing_absent: i64,
    pub billing_partial: i64,
    pub billing_invalid: i64,
    /// JSON object of per-metric `{valid, missing, invalid}` tallies.
    pub field_coverage_json: Option<String>,
    pub missing_columns: Vec<String>,
    pub reconciliation_status: Option<String>,
    /// The accounting scope the verdict used. A status without it does not
    /// say what was compared.
    pub reconciliation_scope: Option<String>,
    pub reconciliation_metrics: Vec<String>,
    pub reconciliation_differences: Option<String>,
    pub read_at: String,
    pub revision: i64,
}

/// The bound source's state, for Settings and for status chips.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreSourceStatus {
    pub source_id: String,
    pub db_path: String,
    pub copilot_home: String,
    pub generation: String,
    pub capability_fingerprint: Option<String>,
    /// The source's own recorded version. Diagnostic only: it has been seen
    /// at 1 and at 8 for near-identical schemas.
    pub source_schema_version: Option<i64>,
    pub capabilities: Vec<String>,
    pub availability: String,
    pub status_detail: Option<String>,
    pub last_attempt_at: Option<String>,
    pub last_success_at: Option<String>,
    pub revision: i64,
    pub enrichment_version: i64,
    pub sessions_with_requests: i64,
    pub total_requests: i64,
}
