//! Analytics Tauri commands (3 commands).
//!
//! All commands follow a consistent pattern using the `analytics_executor` module:
//! 1. Extract context and params from Tauri state
//! 2. Execute with SQL fast-path and disk scan fallback
//!
//! This eliminates ~80 lines of duplicated code compared to the original implementation.

use crate::commands::analytics_executor::{
    AnalyticsContext, AnalyticsQueryParams, execute_analytics_query,
};
use crate::config::SharedConfig;
use crate::error::CmdResult;

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_analytics(
    state: tauri::State<'_, SharedConfig>,
    from_date: Option<String>,
    to_date: Option<String>,
    repo: Option<String>,
    hide_empty: Option<bool>,
) -> CmdResult<tracepilot_core::analytics::AnalyticsData> {
    crate::validators::validate_iso_date_range(&from_date, &to_date)?;
    let ctx = AnalyticsContext::from_state(&state);
    let params = AnalyticsQueryParams::from_options(from_date, to_date, repo, hide_empty);

    execute_analytics_query(
        ctx,
        params,
        "Analytics",
        // SQL fast path
        |db, params| {
            let (from, to, repo, hide) = params.as_refs();
            Ok(db.query_analytics(from, to, repo, hide)?)
        },
        // Disk scan fallback
        |session_dir, params| {
            let (from, to, repo, hide) = params.as_refs();
            let inputs = tracepilot_core::analytics::load_full_sessions_filtered(
                session_dir,
                from,
                to,
                repo,
                hide,
            )?;
            Ok(tracepilot_core::analytics::compute_analytics(&inputs))
        },
    )
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_tool_analysis(
    state: tauri::State<'_, SharedConfig>,
    from_date: Option<String>,
    to_date: Option<String>,
    repo: Option<String>,
    hide_empty: Option<bool>,
) -> CmdResult<tracepilot_core::analytics::ToolAnalysisData> {
    crate::validators::validate_iso_date_range(&from_date, &to_date)?;
    let ctx = AnalyticsContext::from_state(&state);
    let params = AnalyticsQueryParams::from_options(from_date, to_date, repo, hide_empty);

    execute_analytics_query(
        ctx,
        params,
        "Tool analysis",
        // SQL fast path
        |db, params| {
            let (from, to, repo, hide) = params.as_refs();
            Ok(db.query_tool_analysis(from, to, repo, hide)?)
        },
        // Disk scan fallback
        |session_dir, params| {
            let (from, to, repo, hide) = params.as_refs();
            let inputs = tracepilot_core::analytics::load_full_sessions_filtered(
                session_dir,
                from,
                to,
                repo,
                hide,
            )?;
            Ok(tracepilot_core::analytics::compute_tool_analysis(&inputs))
        },
    )
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn get_code_impact(
    state: tauri::State<'_, SharedConfig>,
    from_date: Option<String>,
    to_date: Option<String>,
    repo: Option<String>,
    hide_empty: Option<bool>,
) -> CmdResult<tracepilot_core::analytics::CodeImpactData> {
    crate::validators::validate_iso_date_range(&from_date, &to_date)?;
    let ctx = AnalyticsContext::from_state(&state);
    let params = AnalyticsQueryParams::from_options(from_date, to_date, repo, hide_empty);

    execute_analytics_query(
        ctx,
        params,
        "Code impact",
        // SQL fast path
        |db, params| {
            let (from, to, repo, hide) = params.as_refs();
            Ok(db.query_code_impact(from, to, repo, hide)?)
        },
        // Disk scan fallback
        |session_dir, params| {
            let (from, to, repo, hide) = params.as_refs();
            let inputs = tracepilot_core::analytics::load_session_summaries_filtered(
                session_dir,
                from,
                to,
                repo,
                hide,
            )?;
            Ok(tracepilot_core::analytics::compute_code_impact(&inputs))
        },
    )
    .await
}
