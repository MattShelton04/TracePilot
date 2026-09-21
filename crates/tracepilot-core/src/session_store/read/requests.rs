//! Reading `assistant_usage_events` into [`StoreRequest`]s.

use rusqlite::Row;
use sha2::{Digest, Sha256};

use crate::session_store::billing;
use crate::session_store::capability::{TABLE_USAGE, USAGE_COLUMNS};
use crate::session_store::decimal::ExactDecimal;
use crate::session_store::error::{Result, SessionStoreError};
use crate::session_store::model::{RequestInitiator, StoreRequest};
use crate::session_store::open::SourceReader;
use crate::session_store::status::FieldCoverage;
use crate::session_store::values::{self, Cell, MAX_JSON_BYTES};

use super::coverage::CoverageBuilder;

/// Most request rows read for one session in one pass. Far above the 112 of
/// the busiest locally observed session, and a guard against a pathological
/// store monopolising a refresh.
pub const MAX_REQUESTS_PER_SESSION: usize = 10_000;

// Column indices into the fixed `USAGE_COLUMNS` projection. They stay valid
// across schema versions because missing columns project as NULL.
const COL_ID: usize = 0;
const COL_SESSION_ID: usize = 1;
const COL_TURN_INDEX: usize = 2;
const COL_AGENT_ID: usize = 3;
const COL_PARENT_TOOL_CALL_ID: usize = 4;
const COL_MODEL: usize = 5;
const COL_INPUT_TOKENS: usize = 6;
const COL_OUTPUT_TOKENS: usize = 7;
const COL_CACHE_READ_TOKENS: usize = 8;
const COL_CACHE_WRITE_TOKENS: usize = 9;
const COL_REASONING_TOKENS: usize = 10;
const COL_TOTAL_NANO_AIU: usize = 11;
const COL_REQUEST_MULTIPLIER: usize = 12;
const COL_DURATION_MS: usize = 13;
const COL_TTFT_MS: usize = 14;
const COL_OUTPUT_TTFT_MS: usize = 15;
const COL_INTER_TOKEN_LATENCY_MS: usize = 16;
const COL_INITIATOR: usize = 17;
const COL_API_ENDPOINT: usize = 18;
const COL_REASONING_EFFORT: usize = 19;
const COL_FINISH_REASON: usize = 20;
const COL_CONTENT_FILTER: usize = 21;
const COL_TOKEN_DETAILS_JSON: usize = 22;
const COL_CREATED_AT: usize = 23;
const COL_COPILOT_USAGE_MODEL: usize = 24;

/// Read every recorded request for one session.
///
/// A full per-session read rather than an `id > last_seen` cursor: the source
/// has no update or deletion feed, so a high-water mark silently misses a
/// mutated row and breaks outright after the store is rebuilt with reused IDs.
/// At the observed scale a complete reread is cheap and always correct.
pub fn read_session_requests(
    reader: &SourceReader,
    session_id: &str,
    coverage: &mut CoverageBuilder,
) -> Result<Vec<StoreRequest>> {
    if !reader.capabilities().supports_requests() {
        return Ok(Vec::new());
    }
    reader.check_budget()?;
    let projection = reader.capabilities().projection(TABLE_USAGE, USAGE_COLUMNS);
    let sql = format!(
        "SELECT {projection} FROM \"{TABLE_USAGE}\" WHERE \"session_id\" = ?1 \
         ORDER BY \"id\" ASC LIMIT ?2"
    );
    let mut stmt = reader
        .connection()
        .prepare(&sql)
        .map_err(|error| SessionStoreError::from_sqlite(&error))?;
    let limit = i64::try_from(MAX_REQUESTS_PER_SESSION).unwrap_or(i64::MAX);
    let mut rows = stmt
        .query(rusqlite::params![session_id, limit])
        .map_err(|error| SessionStoreError::from_sqlite(&error))?;

    let mut requests = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| SessionStoreError::from_sqlite(&error))?
    {
        match parse_request(row, coverage) {
            Some(request) => requests.push(request),
            None => coverage.reject_request_row(),
        }
    }
    Ok(requests)
}

/// Turn one row into a request, or reject it.
///
/// Only the identity columns can reject a row. Every other unusable cell
/// becomes a recorded invalid field, because a malformed latency is no reason
/// to lose a request's tokens and charge.
fn parse_request(row: &Row<'_>, coverage: &mut CoverageBuilder) -> Option<StoreRequest> {
    let source_row_id = values::integer(row, COL_ID).into_option()?;
    let session_id = values::text(row, COL_SESSION_ID).into_option()?;
    let model = values::text(row, COL_MODEL).into_option()?;

    let mut invalid_fields = Vec::new();
    let mut take_count = |cell: Cell<u64>, name: &str, coverage: &mut FieldCoverage| {
        if cell.is_invalid() {
            invalid_fields.push(name.to_string());
        }
        cell.tally(coverage)
    };

    let input_tokens = take_count(
        values::count(row, COL_INPUT_TOKENS),
        "input_tokens",
        coverage.field("inputTokens"),
    );
    let output_tokens = take_count(
        values::count(row, COL_OUTPUT_TOKENS),
        "output_tokens",
        coverage.field("outputTokens"),
    );
    let cache_read_tokens = take_count(
        values::count(row, COL_CACHE_READ_TOKENS),
        "cache_read_tokens",
        coverage.field("cacheReadTokens"),
    );
    let cache_write_tokens = take_count(
        values::count(row, COL_CACHE_WRITE_TOKENS),
        "cache_write_tokens",
        coverage.field("cacheWriteTokens"),
    );
    let reasoning_tokens = take_count(
        values::count(row, COL_REASONING_TOKENS),
        "reasoning_tokens",
        coverage.field("reasoningTokens"),
    );

    let mut take_millis = |cell: Cell<f64>, name: &str, coverage: &mut FieldCoverage| {
        if cell.is_invalid() {
            invalid_fields.push(name.to_string());
        }
        cell.tally(coverage)
    };
    let duration_ms = take_millis(
        values::millis(row, COL_DURATION_MS),
        "duration_ms",
        coverage.field("durationMs"),
    );
    let time_to_first_token_ms = take_millis(
        values::millis(row, COL_TTFT_MS),
        "time_to_first_token_ms",
        coverage.field("timeToFirstTokenMs"),
    );
    let output_ttft_ms = take_millis(
        values::millis(row, COL_OUTPUT_TTFT_MS),
        "output_ttft_ms",
        coverage.field("outputTtftMs"),
    );
    let inter_token_latency_ms = take_millis(
        values::millis(row, COL_INTER_TOKEN_LATENCY_MS),
        "inter_token_latency_ms",
        coverage.field("interTokenLatencyMs"),
    );

    let total_nano_aiu = tally_decimal(
        row,
        COL_TOTAL_NANO_AIU,
        "total_nano_aiu",
        coverage.field("totalNanoAiu"),
        &mut invalid_fields,
    );
    let request_multiplier = tally_decimal(
        row,
        COL_REQUEST_MULTIPLIER,
        "request_multiplier",
        coverage.field("requestMultiplier"),
        &mut invalid_fields,
    );

    let token_details = values::bounded_text(row, COL_TOKEN_DETAILS_JSON, MAX_JSON_BYTES);
    if token_details.is_invalid() {
        invalid_fields.push("token_details_json".to_string());
    }
    let (billing_items, billing_items_status) =
        billing::parse_items(token_details.into_option().as_deref());
    coverage.record_billing(billing_items_status);

    invalid_fields.sort();
    invalid_fields.dedup();

    let mut request = StoreRequest {
        source_row_id,
        session_id,
        turn_index: values::integer(row, COL_TURN_INDEX).into_option(),
        agent_id: values::text(row, COL_AGENT_ID).into_option(),
        parent_tool_call_id: values::text(row, COL_PARENT_TOOL_CALL_ID).into_option(),
        model,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        reasoning_tokens,
        total_nano_aiu,
        request_multiplier,
        duration_ms,
        time_to_first_token_ms,
        output_ttft_ms,
        inter_token_latency_ms,
        initiator: values::text(row, COL_INITIATOR)
            .into_option()
            .map(|value| RequestInitiator::parse(&value)),
        api_endpoint: values::text(row, COL_API_ENDPOINT).into_option(),
        reasoning_effort: values::text(row, COL_REASONING_EFFORT).into_option(),
        finish_reason: values::text(row, COL_FINISH_REASON).into_option(),
        content_filter_triggered: values::boolean(row, COL_CONTENT_FILTER).into_option(),
        copilot_usage_model: values::text(row, COL_COPILOT_USAGE_MODEL).into_option(),
        billing_items,
        billing_items_status,
        recorded_at: values::text(row, COL_CREATED_AT).into_option(),
        invalid_fields,
        row_fingerprint: String::new(),
    };
    request.row_fingerprint = fingerprint(&request);
    Some(request)
}

fn tally_decimal(
    row: &Row<'_>,
    index: usize,
    name: &str,
    coverage: &mut FieldCoverage,
    invalid_fields: &mut Vec<String>,
) -> Option<ExactDecimal> {
    let cell = values::decimal(row, index);
    if cell.is_invalid() {
        invalid_fields.push(name.to_string());
    }
    cell.tally(coverage)
}

/// Hash of everything a reader would see, so a refresh that changes nothing
/// can skip publishing a new revision.
fn fingerprint(request: &StoreRequest) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"session-store-request-v1");
    hasher.update(request.source_row_id.to_le_bytes());
    hasher.update(request.model.as_bytes());
    for value in [
        request.input_tokens,
        request.output_tokens,
        request.cache_read_tokens,
        request.cache_write_tokens,
        request.reasoning_tokens,
    ] {
        hasher.update(value.unwrap_or(u64::MAX).to_le_bytes());
    }
    for value in [
        request.duration_ms,
        request.time_to_first_token_ms,
        request.output_ttft_ms,
        request.inter_token_latency_ms,
    ] {
        hasher.update(value.unwrap_or(f64::NAN).to_bits().to_le_bytes());
    }
    for value in [
        request.total_nano_aiu.map(|value| value.to_string()),
        request.request_multiplier.map(|value| value.to_string()),
        request.agent_id.clone(),
        request.parent_tool_call_id.clone(),
        request.initiator.as_ref().map(|i| i.as_str().to_string()),
        request.api_endpoint.clone(),
        request.reasoning_effort.clone(),
        request.finish_reason.clone(),
        request.recorded_at.clone(),
        request.copilot_usage_model.clone(),
    ] {
        hasher.update(value.unwrap_or_default().as_bytes());
        hasher.update(b"\x1f");
    }
    for item in &request.billing_items {
        hasher.update(item.token_type.as_bytes());
        hasher.update(item.token_count.unwrap_or(u64::MAX).to_le_bytes());
        hasher.update(item.batch_size.unwrap_or(u64::MAX).to_le_bytes());
        hasher.update(
            item.cost_per_batch
                .map(|rate| rate.to_string())
                .unwrap_or_default()
                .as_bytes(),
        );
        hasher.update(item.model.clone().unwrap_or_default().as_bytes());
        hasher.update(b"\x1e");
    }
    format!("{:x}", hasher.finalize())
}
