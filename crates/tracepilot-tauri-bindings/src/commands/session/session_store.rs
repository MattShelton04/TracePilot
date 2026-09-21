//! Session-store enrichment: request ledger, linked work and source status.
//!
//! Every response carries its own availability and coverage, because the
//! answers "no requests were recorded", "the source is not installed" and
//! "the source could not be read right now" are different statements and the
//! UI has to say which one it is showing.

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::{
    RequestPerformanceResponse, SessionRequestUsageResponse, SessionStoreStatusResponse,
    SessionWorkRefsResponse,
};

use tracepilot_indexer::index_db::{IndexDb, RequestCursor, RequestLedgerFilter};

/// Filters accepted from the UI for the request ledger.
///
/// Every list is an OR within its dimension and an AND across dimensions,
/// matching the behaviour of the existing search filters.
#[derive(Debug, Default, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RequestUsageFilters {
    pub models: Vec<String>,
    pub agent_ids: Vec<String>,
    pub initiators: Vec<String>,
    pub reasoning_efforts: Vec<String>,
    pub finish_reasons: Vec<String>,
    pub api_endpoints: Vec<String>,
    /// `true` keeps requests with a positive recorded cache read, `false`
    /// those recording zero. Requests whose counter was never recorded are in
    /// neither population: "not recorded" is not "no reuse".
    pub reports_cache_reuse: Option<bool>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

/// The bound source's state, for Settings and status chips.
#[tauri::command]
#[tracing::instrument(skip_all, level = "debug")]
pub async fn get_session_store_status(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<SessionStoreStatusResponse> {
    let config = read_config(&state);
    let index_path = config.index_db_path();
    let enabled = config.features.session_store_enrichment;
    let resolved_path = tracepilot_indexer::default_source_binding()
        .map(|binding| binding.db_path.display().to_string());

    blocking_cmd!({
        // A read-only handle skips migrations, so an index predating the
        // enrichment tables reports "no source" rather than failing.
        let status = IndexDb::open_readonly(&index_path)
            .ok()
            .and_then(|db| db.session_store_status().ok().flatten());
        Ok::<_, BindingsError>(SessionStoreStatusResponse {
            enabled,
            resolved_path,
            source: status,
        })
    })
}

/// One page of a session's recorded requests.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_request_usage(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    filters: Option<RequestUsageFilters>,
    cursor: Option<String>,
    limit: Option<usize>,
) -> CmdResult<SessionRequestUsageResponse> {
    crate::validators::validate_session_id(&session_id)?;
    let config = read_config(&state);
    let index_path = config.index_db_path();
    let enabled = config.features.session_store_enrichment;
    let filters = filters.unwrap_or_default();

    blocking_cmd!({
        if !enabled {
            return Ok(SessionRequestUsageResponse::disabled());
        }
        // A cursor is opaque: it is echoed back from a previous page, never
        // assembled by the caller, so a malformed one is a client bug rather
        // than something to interpret.
        let after = match cursor.as_deref().map(parse_cursor).transpose() {
            Ok(after) => after,
            Err(error) => return Err(error),
        };

        let db = IndexDb::open_readonly(&index_path)?;
        let page = db.list_request_usage(&RequestLedgerFilter {
            session_id: Some(session_id.clone()),
            models: filters.models,
            agent_ids: filters.agent_ids,
            initiators: filters.initiators,
            reasoning_efforts: filters.reasoning_efforts,
            finish_reasons: filters.finish_reasons,
            api_endpoints: filters.api_endpoints,
            reports_cache_reuse: filters.reports_cache_reuse,
            repository: None,
            from_date: filters.from_date,
            to_date: filters.to_date,
            limit,
            after,
        })?;
        let coverage = db.session_store_coverage(&session_id)?;

        Ok::<_, BindingsError>(SessionRequestUsageResponse {
            enabled: true,
            page,
            coverage,
        })
    })
}

/// A session's linked pull requests, issues and Git refs.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_work_refs(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<SessionWorkRefsResponse> {
    crate::validators::validate_session_id(&session_id)?;
    let config = read_config(&state);
    let index_path = config.index_db_path();
    let enabled = config.features.session_store_enrichment;

    blocking_cmd!({
        if !enabled {
            return Ok(SessionWorkRefsResponse::disabled());
        }
        let db = IndexDb::open_readonly(&index_path)?;
        let refs = db.list_session_work_refs(&session_id)?;
        let status = db.session_store_status()?;
        Ok::<_, BindingsError>(SessionWorkRefsResponse {
            enabled: true,
            // Distinguishing "no references found" from "no source to search"
            // matters: the second must not read as evidence that no such work
            // exists.
            available: status.is_some() && db.has_session_store_enrichment(),
            refs,
            source_availability: status.map(|status| status.availability),
        })
    })
}

/// Observed request performance across one session.
///
/// Scoped to a session rather than the whole library for the first release:
/// a cross-session distribution needs the repository and date filters the
/// analytics surfaces already own, and mixing the two filter vocabularies
/// would produce populations the UI could not describe accurately.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_request_performance(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<RequestPerformanceResponse> {
    crate::validators::validate_session_id(&session_id)?;
    let config = read_config(&state);
    let index_path = config.index_db_path();
    let enabled = config.features.session_store_enrichment;

    blocking_cmd!({
        if !enabled {
            return Ok(RequestPerformanceResponse::disabled());
        }
        let db = IndexDb::open_readonly(&index_path)?;
        let requests = db.all_session_requests(&session_id)?;
        let coverage = db.session_store_coverage(&session_id)?;
        Ok::<_, BindingsError>(RequestPerformanceResponse::from_requests(
            &requests, coverage,
        ))
    })
}

fn parse_cursor(token: &str) -> Result<RequestCursor, BindingsError> {
    serde_json::from_value(serde_json::Value::String(token.to_string()))
        .map_err(|_| BindingsError::Validation("Invalid request ledger page token".to_string()))
}
