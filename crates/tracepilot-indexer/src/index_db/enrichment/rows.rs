//! Turning normalised core values into the index's own row shapes.
//!
//! Split from the writer so each file stays inside the repository's per-file
//! budget; the two belong to the same concern and change together.

use rusqlite::{Connection, ToSql, params};
use tracepilot_core::session_store::{StoreRequest, WorkRef, billing};

use crate::Result;

use super::super::batch_insert::batched_insert;
use super::types::{
    CURRENT_ENRICHMENT_VERSION, CURRENT_MAPPING_VERSION, RequestLinkRow, SessionEnrichmentWrite,
};

/// Owned, SQL-ready form of a [`StoreRequest`].
struct RequestRow<'a> {
    request: &'a StoreRequest,
    initiator: Option<String>,
    total_nano_aiu: Option<String>,
    request_multiplier: Option<String>,
    content_filter_triggered: Option<i64>,
    billing_items_status: String,
    billing_check: String,
    invalid_fields: Option<String>,
}

impl<'a> RequestRow<'a> {
    fn new(request: &'a StoreRequest) -> Self {
        Self {
            request,
            initiator: request
                .initiator
                .as_ref()
                .map(|initiator| initiator.as_str().to_string()),
            total_nano_aiu: request.total_nano_aiu.map(|value| value.to_string()),
            request_multiplier: request.request_multiplier.map(|value| value.to_string()),
            content_filter_triggered: request.content_filter_triggered.map(i64::from),
            billing_items_status: serde_plain(&request.billing_items_status),
            billing_check: billing::check(&request.billing_items, request.total_nano_aiu)
                .as_str()
                .to_string(),
            invalid_fields: (!request.invalid_fields.is_empty())
                .then(|| request.invalid_fields.join(",")),
        }
    }
}

/// Serialise a small enum through its serde representation, so the stored
/// string and the one the UI receives cannot drift apart.
fn serde_plain<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string())
}

/// One entry of a request's billing array.
struct BillingRow<'a> {
    source_row_id: i64,
    ordinal: i64,
    item: &'a tracepilot_core::session_store::BillingItem,
    cost_per_batch: Option<String>,
    billing_model: Option<String>,
    token_count: Option<i64>,
    batch_size: Option<i64>,
}

/// Owned form of a [`WorkRef`].
struct WorkRefRow<'a> {
    work_ref: &'a WorkRef,
    identity: String,
    kind: String,
    resolution: String,
    sha_shaped: i64,
}

fn to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

pub(super) fn write_requests(conn: &Connection, write: &SessionEnrichmentWrite<'_>) -> Result<()> {
    let rows: Vec<RequestRow<'_>> = write.requests.iter().map(RequestRow::new).collect();
    batched_insert(
        conn,
        "INSERT OR REPLACE INTO session_request_usage \
         (source_id, generation, source_row_id, session_id, source_turn_index, agent_id, \
          parent_tool_call_id, model, input_tokens, output_tokens, cache_read_tokens, \
          cache_write_tokens, reasoning_tokens, total_nano_aiu, request_multiplier, duration_ms, \
          time_to_first_token_ms, output_ttft_ms, inter_token_latency_ms, initiator, api_endpoint, \
          reasoning_effort, finish_reason, content_filter_triggered, copilot_usage_model, \
          billing_items_status, billing_check, recorded_at, invalid_fields, row_fingerprint) VALUES",
        30,
        &rows,
        |row, params| {
            let request = row.request;
            let values: [&dyn ToSql; 30] = [
                &write.source_id,
                &write.generation,
                &request.source_row_id,
                &write.session_id,
                &request.turn_index,
                &request.agent_id,
                &request.parent_tool_call_id,
                &request.model,
                &request.input_tokens,
                &request.output_tokens,
                &request.cache_read_tokens,
                &request.cache_write_tokens,
                &request.reasoning_tokens,
                &row.total_nano_aiu,
                &row.request_multiplier,
                &request.duration_ms,
                &request.time_to_first_token_ms,
                &request.output_ttft_ms,
                &request.inter_token_latency_ms,
                &row.initiator,
                &request.api_endpoint,
                &request.reasoning_effort,
                &request.finish_reason,
                &row.content_filter_triggered,
                &request.copilot_usage_model,
                &row.billing_items_status,
                &row.billing_check,
                &request.recorded_at,
                &row.invalid_fields,
                &request.row_fingerprint,
            ];
            params.extend(values);
        },
    )?;
    write_billing_items(conn, write)
}

pub(super) fn write_billing_items(
    conn: &Connection,
    write: &SessionEnrichmentWrite<'_>,
) -> Result<()> {
    let rows: Vec<BillingRow<'_>> = write
        .requests
        .iter()
        .flat_map(|request| {
            request.billing_items.iter().map(|item| BillingRow {
                source_row_id: request.source_row_id,
                ordinal: i64::from(item.ordinal),
                item,
                cost_per_batch: item.cost_per_batch.map(|rate| rate.to_string()),
                // Entry model first, then the request default. The execution
                // model is never used here: it would be inferred attribution
                // presented as recorded.
                billing_model: item
                    .billing_model(request.copilot_usage_model.as_deref())
                    .map(str::to_string),
                token_count: item.token_count.map(to_i64),
                batch_size: item.batch_size.map(to_i64),
            })
        })
        .collect();
    batched_insert(
        conn,
        "INSERT OR REPLACE INTO session_request_billing_items \
         (source_id, generation, source_row_id, ordinal, session_id, token_type, token_count, \
          batch_size, cost_per_batch, billing_model) VALUES",
        10,
        &rows,
        |row, params| {
            let values: [&dyn ToSql; 10] = [
                &write.source_id,
                &write.generation,
                &row.source_row_id,
                &row.ordinal,
                &write.session_id,
                &row.item.token_type,
                &row.token_count,
                &row.batch_size,
                &row.cost_per_batch,
                &row.billing_model,
            ];
            params.extend(values);
        },
    )
}

pub(super) fn write_work_refs(conn: &Connection, write: &SessionEnrichmentWrite<'_>) -> Result<()> {
    let rows: Vec<WorkRefRow<'_>> = write
        .work_refs
        .iter()
        .map(|work_ref| WorkRefRow {
            identity: work_ref.identity(),
            kind: work_ref.kind.as_str().to_string(),
            resolution: work_ref.resolution.as_str().to_string(),
            sha_shaped: i64::from(work_ref.is_commit_sha_shaped()),
            work_ref,
        })
        .collect();
    batched_insert(
        conn,
        "INSERT OR REPLACE INTO session_work_refs \
         (source_id, generation, ref_identity, session_id, source_row_id, kind, raw_value, \
          normalized_value, resolved_host, resolved_repository, candidate_repository, resolution, \
          sha_shaped, source_turn_index, recorded_at) VALUES",
        15,
        &rows,
        |row, params| {
            let work_ref = row.work_ref;
            let values: [&dyn ToSql; 15] = [
                &write.source_id,
                &write.generation,
                &row.identity,
                &write.session_id,
                &work_ref.source_row_id,
                &row.kind,
                &work_ref.raw_value,
                &work_ref.normalized_value,
                &work_ref.resolved_host,
                &work_ref.resolved_repository,
                &work_ref.candidate_repository,
                &row.resolution,
                &row.sha_shaped,
                &work_ref.turn_index,
                &work_ref.recorded_at,
            ];
            params.extend(values);
        },
    )
}

pub(super) fn write_links(conn: &Connection, write: &SessionEnrichmentWrite<'_>) -> Result<()> {
    struct LinkRow<'a> {
        link: &'a RequestLinkRow,
        join_status: String,
    }
    let rows: Vec<LinkRow<'_>> = write
        .links
        .iter()
        .map(|link| LinkRow {
            join_status: link.join_status.as_str().to_string(),
            link,
        })
        .collect();
    batched_insert(
        conn,
        "INSERT OR REPLACE INTO session_request_links \
         (source_id, generation, source_row_id, session_id, run_key, turn_index, event_index, \
          join_method, join_status, event_fingerprint, mapping_version) VALUES",
        11,
        &rows,
        |row, params| {
            let link = row.link;
            let values: [&dyn ToSql; 11] = [
                &write.source_id,
                &write.generation,
                &link.source_row_id,
                &link.session_id,
                &link.run_key,
                &link.turn_index,
                &link.event_index,
                &link.join_method,
                &row.join_status,
                &link.event_fingerprint,
                &CURRENT_MAPPING_VERSION,
            ];
            params.extend(values);
        },
    )
}

pub(super) fn write_coverage(conn: &Connection, write: &SessionEnrichmentWrite<'_>) -> Result<()> {
    let coverage = write.coverage;
    let fields = serde_json::to_string(&coverage.fields)?;
    conn.execute(
        "INSERT OR REPLACE INTO session_store_coverage (
             source_id, generation, session_id, availability, freshness,
             request_rows, request_rows_rejected, work_ref_rows, work_ref_rows_rejected,
             billing_absent, billing_partial, billing_invalid, field_coverage_json,
             missing_columns, source_schema_version, reconciliation_status,
             reconciliation_scope, reconciliation_metrics, reconciliation_differences,
             event_fingerprint, read_at, revision, enrichment_version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                 ?17, ?18, ?19, ?20, ?21,
                 COALESCE((SELECT revision FROM session_store_sources WHERE source_id = ?1), 0),
                 ?22)",
        params![
            write.source_id,
            write.generation,
            write.session_id,
            coverage.availability.as_str(),
            coverage.freshness.as_str(),
            coverage.request_rows,
            coverage.request_rows_rejected,
            coverage.work_ref_rows,
            coverage.work_ref_rows_rejected,
            coverage.billing_absent,
            coverage.billing_partial,
            coverage.billing_invalid,
            fields,
            coverage.missing_columns.join(","),
            coverage.schema_version,
            coverage.reconciliation.status.as_str(),
            coverage.reconciliation.scope,
            coverage.reconciliation.metrics.join(","),
            coverage.reconciliation.differences.join("; "),
            coverage.reconciliation.snapshot_fingerprint,
            coverage.read_at,
            CURRENT_ENRICHMENT_VERSION,
        ],
    )?;
    Ok(())
}

/// Clear a session's enrichment before replacing it.
///
/// Scoped to the session, never to a whole table: another session's rows are
/// none of this refresh's business.
pub(super) fn delete_session_enrichment(conn: &Connection, session_id: &str) -> Result<()> {
    for sql in [
        "DELETE FROM session_request_billing_items WHERE session_id = ?1",
        "DELETE FROM session_request_links WHERE session_id = ?1",
        "DELETE FROM session_request_usage WHERE session_id = ?1",
        "DELETE FROM session_work_refs WHERE session_id = ?1",
        "DELETE FROM session_store_coverage WHERE session_id = ?1",
    ] {
        conn.execute(sql, [session_id])?;
    }
    Ok(())
}
