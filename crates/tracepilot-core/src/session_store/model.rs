//! Normalised shapes for the rows this adapter reads.
//!
//! These types are deliberately lossy in one direction only: they drop source
//! text this feature has no use for (prompts, responses, FTS content) and keep
//! every counter, timing and billing entry verbatim, including values that
//! disagree with each other. Where the source contradicts itself — the flat
//! cache-write counter versus the billing entries, for instance — both sides
//! survive and the disagreement is recorded rather than resolved.

use serde::{Deserialize, Serialize};

use super::decimal::{ExactDecimal, Rational};

/// Who or what started a request, as recorded.
///
/// `initiator` is NULL on a large share of historical rows. The CLI's current
/// schema describes an absent value as user-initiated; this store's own data
/// contains explicit `user` rows *and* those NULLs, so they are kept apart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestInitiator {
    User,
    Agent,
    SubAgent,
    Compaction,
    /// A value this build has not seen. Preserved so a new CLI release does
    /// not silently become one of the known kinds.
    Other(String),
}

impl RequestInitiator {
    pub fn parse(value: &str) -> Self {
        match value {
            "user" => Self::User,
            "agent" => Self::Agent,
            "sub-agent" => Self::SubAgent,
            "compaction" => Self::Compaction,
            other => Self::Other(other.to_string()),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            Self::User => "user",
            Self::Agent => "agent",
            Self::SubAgent => "sub-agent",
            Self::Compaction => "compaction",
            Self::Other(value) => value,
        }
    }

    /// Whether this request is a subagent's own work rather than the main
    /// agent's. Used to keep concurrent worker calls out of root cache claims.
    pub fn is_sub_agent(&self) -> bool {
        matches!(self, Self::SubAgent)
    }

    pub fn is_compaction(&self) -> bool {
        matches!(self, Self::Compaction)
    }
}

/// One entry of a request's `token_details_json` array.
///
/// The source stores an array, not a map keyed by category, and repeated
/// categories with different rates do occur. Collapsing it into a map would
/// lose exactly the rate history that makes this worth reading.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingItem {
    /// Position in the source array, which is also its identity: two entries
    /// may otherwise be identical.
    pub ordinal: u32,
    /// `input`, `cache read`, `cache write`, `output`, or anything new.
    pub token_type: String,
    pub token_count: Option<u64>,
    pub batch_size: Option<u64>,
    /// Rate per batch in nano AI units, kept as recorded.
    pub cost_per_batch: Option<ExactDecimal>,
    /// Per-entry billing model, when the entry carries one.
    pub model: Option<String>,
}

impl BillingItem {
    /// `tokenCount * costPerBatch / batchSize` as an exact fraction.
    ///
    /// A zero or missing batch size yields `None` rather than a division by
    /// zero or an invented denominator of one.
    pub fn charge(&self) -> Option<Rational> {
        let count = Rational::from_i128(i128::from(self.token_count?));
        let batch = self.batch_size.filter(|size| *size > 0)?;
        let rate = self.cost_per_batch?.to_rational()?;
        count
            .checked_mul(rate)?
            .checked_div(Rational::from_i128(i128::from(batch)))
    }

    /// Which model this entry is billed against, given the request-level
    /// default. The execution model is deliberately *not* consulted here: it
    /// is a display fallback the caller labels as inferred, not recorded
    /// billing attribution.
    pub fn billing_model<'a>(&'a self, request_default: Option<&'a str>) -> Option<&'a str> {
        self.model.as_deref().or(request_default)
    }
}

/// Whether a request's billing array could be read, and how completely.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BillingItemsStatus {
    /// Every entry parsed.
    Complete,
    /// The column held no value.
    Absent,
    /// Some entries parsed and others did not.
    Partial,
    /// The value was not a JSON array, or exceeded the size budget.
    Invalid,
}

/// One recorded model request.
///
/// Optional counters distinguish three states the source genuinely has:
/// `None` for a NULL cell, `Some(0)` for a recorded zero, and an entry in
/// [`Self::invalid_fields`] for a cell that held something unusable. A zero
/// cache read is a recorded observation; a NULL one is not.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreRequest {
    /// `assistant_usage_events.id`. Row identity within one source generation
    /// only — it is not a provider request ID and must never be shown as one.
    pub source_row_id: i64,
    pub session_id: String,
    /// The source's own interaction counter. **Not** a TracePilot turn index;
    /// 85 of 383 local rows have no matching source turn at all.
    pub turn_index: Option<i64>,
    pub agent_id: Option<String>,
    /// Deprecated in the CLI's current schema. Its absence must not invalidate
    /// an otherwise valid agent-ID join.
    pub parent_tool_call_id: Option<String>,
    pub model: String,
    /// Includes the cache categories in observed data; not a "fresh tokens"
    /// figure.
    pub input_tokens: Option<u64>,
    /// Already includes reasoning tokens. Never add them again.
    pub output_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    /// The recorded charge. This is the request's cost; billing items explain
    /// it and must not be multiplied by the request multiplier again.
    pub total_nano_aiu: Option<ExactDecimal>,
    pub request_multiplier: Option<ExactDecimal>,
    /// Whole API-call duration in milliseconds.
    pub duration_ms: Option<f64>,
    pub time_to_first_token_ms: Option<f64>,
    /// First *observable* output, which includes reasoning and tool-call
    /// output. Not time to the first user-visible answer.
    pub output_ttft_ms: Option<f64>,
    pub inter_token_latency_ms: Option<f64>,
    pub initiator: Option<RequestInitiator>,
    pub api_endpoint: Option<String>,
    pub reasoning_effort: Option<String>,
    pub finish_reason: Option<String>,
    pub content_filter_triggered: Option<bool>,
    /// Default billing model for entries without their own.
    pub copilot_usage_model: Option<String>,
    pub billing_items: Vec<BillingItem>,
    pub billing_items_status: BillingItemsStatus,
    /// The source timestamp. Its DDL default is `datetime('now')`, so it is a
    /// recording time, not a guaranteed request start.
    pub recorded_at: Option<String>,
    /// Columns whose cells held something unusable. Bounded and deduplicated.
    pub invalid_fields: Vec<String>,
    /// Content hash of the normalised row, used to decide whether a refresh
    /// changed anything a reader would see.
    pub row_fingerprint: String,
}

impl StoreRequest {
    /// Recorded credits, i.e. nano AI units divided by 1e9.
    pub fn recorded_credits(&self) -> Option<ExactDecimal> {
        self.total_nano_aiu?.checked_div_pow10(9)
    }

    /// Ordinary (non-cache) input tokens, when every part is present.
    pub fn fresh_input_tokens(&self) -> Option<u64> {
        let input = self.input_tokens?;
        let read = self.cache_read_tokens.unwrap_or(0);
        let write = self.cache_write_tokens.unwrap_or(0);
        input.checked_sub(read)?.checked_sub(write)
    }

    /// Whether the row records positive cache reuse. `None` means the counter
    /// was absent, which is not the same as no reuse.
    pub fn reports_cache_reuse(&self) -> Option<bool> {
        Some(self.cache_read_tokens? > 0)
    }

    /// A row whose cache counters exceed its input is internally inconsistent
    /// and must be excluded from ratio populations rather than clamped.
    pub fn cache_counters_are_consistent(&self) -> bool {
        match (
            self.input_tokens,
            self.cache_read_tokens,
            self.cache_write_tokens,
        ) {
            (Some(input), read, write) => {
                read.unwrap_or(0).saturating_add(write.unwrap_or(0)) <= input
            }
            _ => true,
        }
    }
}

/// Session metadata as the store records it.
///
/// Deliberately never overwrites richer local metadata: this is used for
/// source binding, reference context, and a later store-only discovery view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreSessionMeta {
    pub session_id: String,
    pub cwd: Option<String>,
    pub repository: Option<String>,
    /// A NULL host type means "not recorded". It must not become "local".
    pub host_type: Option<String>,
    pub branch: Option<String>,
    pub summary: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Where a session's record exists, which decides what the UI may offer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionPresence {
    /// A session directory with an event log exists locally.
    LocalLog,
    /// A session directory exists but has no readable event log.
    LocalMetadataOnly,
    /// Only the store knows about it. No synthetic files, no replay or resume.
    StoreOnly,
}

impl SessionPresence {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LocalLog => "localLog",
            Self::LocalMetadataOnly => "localMetadataOnly",
            Self::StoreOnly => "storeOnly",
        }
    }
}
