//! Cross-session distributions over the recorded request ledger.
//!
//! These are **observational comparisons, not controlled benchmarks**. Prompt
//! sizes and agent roles vary enormously between sessions and can easily
//! dominate any difference between models, so nothing here is a quality
//! ranking or a reason to switch model.
//!
//! Two rules shape the SQL. Rows are selected by the request's own recorded
//! time, never by its session's creation date — assigning a long-running
//! session's whole history to the day it started would pile weeks of requests
//! onto one bucket. And the statistics themselves are computed in
//! `tracepilot_core::session_store::stats` over the returned rows rather than
//! in SQL, so the rules about identical populations, per-metric coverage and
//! p95 suppression live in exactly one place.

use rusqlite::{Connection, ToSql, params_from_iter};
use tracepilot_core::session_store::RequestPerformance;

use crate::Result;
use crate::index_db::enrichment::StoredRequest;

/// Most requests one cross-session query will read.
///
/// The whole local corpus was 383 rows, so this is generous; it exists to
/// bound a pathological store rather than to shape normal results.
pub(super) const MAX_PERFORMANCE_ROWS: usize = 100_000;

/// Which requests a performance query covers.
#[derive(Debug, Default, Clone)]
pub struct RequestPerformanceFilter {
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub repository: Option<String>,
    pub models: Vec<String>,
    pub reasoning_efforts: Vec<String>,
    pub initiators: Vec<String>,
    pub api_endpoints: Vec<String>,
}

/// One model's observed request performance.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRequestPerformance {
    pub model: String,
    pub performance: RequestPerformance,
}

/// Observed performance per model, plus the population as a whole.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPerformanceReport {
    /// False when no source is bound or the enrichment tables are absent —
    /// which is not the same as a filter matching no requests.
    pub available: bool,
    pub stale: bool,
    pub last_success_at: Option<String>,
    pub overall: Option<RequestPerformance>,
    pub by_model: Vec<ModelRequestPerformance>,
    /// Sessions represented, so a distribution dominated by one long session
    /// is visible as such.
    pub session_count: u32,
}

impl RequestPerformanceReport {
    pub(super) fn unavailable() -> Self {
        Self {
            available: false,
            stale: false,
            last_success_at: None,
            overall: None,
            by_model: Vec::new(),
            session_count: 0,
        }
    }
}

pub(super) fn query_request_performance(
    conn: &Connection,
    generation: Option<&str>,
    filter: &RequestPerformanceFilter,
) -> Result<RequestPerformanceReport> {
    let Some(generation) = generation else {
        return Ok(RequestPerformanceReport::unavailable());
    };
    let rows = load_rows(conn, generation, filter)?;
    if rows.is_empty() {
        // An empty population is still an available source: the filter simply
        // matched nothing. A zero-valued distribution would read as a
        // measurement, so none is returned.
        return Ok(RequestPerformanceReport {
            available: true,
            stale: false,
            last_success_at: None,
            overall: None,
            by_model: Vec::new(),
            session_count: 0,
        });
    }

    let core: Vec<_> = rows.iter().map(StoredRequest::to_core).collect();
    let overall = tracepilot_core::session_store::request_performance(&core);
    let session_count = overall.session_count;

    let mut models: Vec<&str> = core.iter().map(|request| request.model.as_str()).collect();
    models.sort_unstable();
    models.dedup();
    let by_model = models
        .into_iter()
        .map(|model| {
            let subset: Vec<_> = core
                .iter()
                .filter(|request| request.model == model)
                .cloned()
                .collect();
            ModelRequestPerformance {
                model: model.to_string(),
                performance: tracepilot_core::session_store::request_performance(&subset),
            }
        })
        .collect();

    Ok(RequestPerformanceReport {
        available: true,
        stale: false,
        last_success_at: None,
        overall: Some(overall),
        by_model,
        session_count,
    })
}

/// Only the columns the statistics need, so a cross-session query does not
/// carry every request's billing payload through memory.
fn load_rows(
    conn: &Connection,
    generation: &str,
    filter: &RequestPerformanceFilter,
) -> Result<Vec<StoredRequest>> {
    let mut clauses = vec!["u.generation = ?".to_string()];
    let mut params: Vec<Box<dyn ToSql>> = vec![Box::new(generation.to_string())];

    if let Some(from) = &filter.from_date {
        clauses.push("u.recorded_at >= ?".to_string());
        params.push(Box::new(from.clone()));
    }
    if let Some(to) = &filter.to_date {
        clauses.push("u.recorded_at < date(?, '+1 day')".to_string());
        params.push(Box::new(to.clone()));
    }
    if let Some(repository) = &filter.repository {
        clauses.push(
            "EXISTS (SELECT 1 FROM sessions s WHERE s.id = u.session_id AND s.repository = ?)"
                .to_string(),
        );
        params.push(Box::new(repository.clone()));
    }
    for (column, values) in [
        ("u.model", &filter.models),
        ("u.reasoning_effort", &filter.reasoning_efforts),
        ("u.initiator", &filter.initiators),
        ("u.api_endpoint", &filter.api_endpoints),
    ] {
        if values.is_empty() {
            continue;
        }
        let placeholders = vec!["?"; values.len()].join(", ");
        clauses.push(format!("{column} IN ({placeholders})"));
        for value in values {
            params.push(Box::new(value.clone()));
        }
    }

    let sql = format!(
        "SELECT u.source_row_id, u.session_id, u.model, u.input_tokens, u.output_tokens, \
                u.cache_read_tokens, u.cache_write_tokens, u.duration_ms, \
                u.time_to_first_token_ms, u.output_ttft_ms, u.inter_token_latency_ms, \
                u.initiator, u.recorded_at, u.invalid_fields \
         FROM session_request_usage u WHERE {} \
         ORDER BY u.recorded_at ASC, u.source_row_id ASC LIMIT ?",
        clauses.join(" AND ")
    );
    params.push(Box::new(
        i64::try_from(MAX_PERFORMANCE_ROWS + 1).unwrap_or(i64::MAX),
    ));

    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<StoredRequest> = stmt
        .query_map(
            params_from_iter(params.iter().map(|param| param.as_ref())),
            |row| {
                Ok(StoredRequest {
                    source_id: String::new(),
                    generation: String::new(),
                    source_row_id: row.get(0)?,
                    session_id: row.get(1)?,
                    source_turn_index: None,
                    agent_id: None,
                    parent_tool_call_id: None,
                    model: row.get(2)?,
                    input_tokens: row.get(3)?,
                    output_tokens: row.get(4)?,
                    cache_read_tokens: row.get(5)?,
                    cache_write_tokens: row.get(6)?,
                    reasoning_tokens: None,
                    total_nano_aiu: None,
                    request_multiplier: None,
                    duration_ms: row.get(7)?,
                    time_to_first_token_ms: row.get(8)?,
                    output_ttft_ms: row.get(9)?,
                    inter_token_latency_ms: row.get(10)?,
                    initiator: row.get(11)?,
                    api_endpoint: None,
                    reasoning_effort: None,
                    finish_reason: None,
                    content_filter_triggered: None,
                    copilot_usage_model: None,
                    billing_items_status: String::new(),
                    billing_check: String::new(),
                    recorded_at: row.get(12)?,
                    invalid_fields: row
                        .get::<_, Option<String>>(13)?
                        .unwrap_or_default()
                        .split(',')
                        .filter(|field| !field.is_empty())
                        .map(str::to_string)
                        .collect(),
                    row_fingerprint: String::new(),
                    billing_items: Vec::new(),
                })
            },
        )?
        .collect::<rusqlite::Result<_>>()?;
    if rows.len() > MAX_PERFORMANCE_ROWS {
        return Err(crate::error::IndexerError::QueryLimit(
            "More than 100,000 requests match; narrow the date range or repository".to_string(),
        ));
    }
    Ok(rows)
}

/// Per-agent request figures for one session, keyed by the agent run.
///
/// `own` figures only: a branch total is derived by summing descendants once,
/// as the existing Agents metrics UI does. Adding a branch total and its
/// children into a session total would double-count.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRequestRollup {
    pub run_key: Option<String>,
    pub agent_id: Option<String>,
    pub request_count: u32,
    /// Exact decimal string of own nano AI units, summed over the agent's
    /// own requests.
    pub own_nano_aiu: Option<String>,
    pub cache_read_tokens: u64,
    pub input_tokens: u64,
    /// Requests whose join to a run was not exact. Shown rather than hidden:
    /// unattributed work is a real gap in the breakdown.
    pub unattributed_requests: u32,
}

/// Per-agent request rollups for one session.
pub(super) fn query_agent_request_rollups(
    conn: &Connection,
    generation: Option<&str>,
    session_id: &str,
) -> Result<Vec<AgentRequestRollup>> {
    let Some(generation) = generation else {
        return Ok(Vec::new());
    };
    // The join is left-outer on purpose: a request with no link still belongs
    // in the rollup, grouped under "unattributed", rather than vanishing.
    let mut stmt = conn.prepare(
        "SELECT l.run_key, u.agent_id, COUNT(*), \
                COALESCE(SUM(CASE WHEN u.cache_read_tokens BETWEEN 0 AND u.input_tokens THEN u.cache_read_tokens END), 0), \
                COALESCE(SUM(CASE WHEN u.cache_read_tokens BETWEEN 0 AND u.input_tokens THEN u.input_tokens END), 0), \
                SUM(CASE WHEN l.join_status = 'exact' AND l.run_key IS NOT NULL THEN 0 ELSE 1 END) \
         FROM session_request_usage u \
         LEFT JOIN session_request_links l \
           ON l.source_id = u.source_id AND l.generation = u.generation \
          AND l.source_row_id = u.source_row_id \
         WHERE u.generation = ?1 AND u.session_id = ?2 \
         GROUP BY l.run_key, u.agent_id \
         ORDER BY COUNT(*) DESC",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![generation, session_id], |row| {
            Ok(AgentRequestRollup {
                run_key: row.get(0)?,
                agent_id: row.get(1)?,
                request_count: row.get::<_, i64>(2)? as u32,
                own_nano_aiu: None,
                cache_read_tokens: row.get::<_, i64>(3)?.max(0) as u64,
                input_tokens: row.get::<_, i64>(4)?.max(0) as u64,
                unattributed_requests: row.get::<_, Option<i64>>(5)?.unwrap_or(0).max(0) as u32,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    sum_own_credits(conn, generation, session_id, rows)
}

/// Sum each group's recorded credits with exact decimal arithmetic.
///
/// Done in Rust rather than with SQL `SUM`: the totals are decimal strings
/// well past the range binary floating point holds exactly, and SQLite would
/// coerce them before adding.
fn sum_own_credits(
    conn: &Connection,
    generation: &str,
    session_id: &str,
    mut rollups: Vec<AgentRequestRollup>,
) -> Result<Vec<AgentRequestRollup>> {
    use tracepilot_core::session_store::ExactDecimal;

    let mut stmt = conn.prepare(
        "SELECT l.run_key, u.agent_id, u.total_nano_aiu \
         FROM session_request_usage u \
         LEFT JOIN session_request_links l \
           ON l.source_id = u.source_id AND l.generation = u.generation \
          AND l.source_row_id = u.source_row_id \
         WHERE u.generation = ?1 AND u.session_id = ?2",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![generation, session_id], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut totals = std::collections::BTreeMap::new();
    for (run_key, agent_id, total) in rows {
        let sum = totals
            .entry((run_key, agent_id))
            .or_insert(Some(ExactDecimal::ZERO));
        *sum = sum.and_then(|current| {
            total
                .as_deref()
                .and_then(ExactDecimal::parse)
                .and_then(|value| current.checked_add(value))
        });
    }
    for rollup in &mut rollups {
        rollup.own_nano_aiu = totals
            .get(&(rollup.run_key.clone(), rollup.agent_id.clone()))
            .copied()
            .flatten()
            .map(|total| total.to_string());
    }
    Ok(rollups)
}
