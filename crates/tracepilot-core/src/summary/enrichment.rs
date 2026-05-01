use crate::models::event_types::ShutdownData;
use crate::models::session_summary::{SessionSummary, ShutdownMetrics};
use crate::parsing::events::{TypedEvent, extract_combined_shutdown_data, extract_session_start};
use crate::turns::{reconstruct_turns, turn_stats};

/// Enrich summary fields derivable from parsed events.
pub(super) fn apply_event_enrichment(summary: &mut SessionSummary, typed_events: &[TypedEvent]) {
    summary.event_count = Some(typed_events.len());

    if let Some((sd, count)) = extract_combined_shutdown_data(typed_events) {
        summary.shutdown_metrics = Some(shutdown_data_to_metrics(&sd, count));
    }

    let turns = reconstruct_turns(typed_events);
    let stats = turn_stats(&turns);
    summary.turn_count = Some(stats.total_turns);

    if let Some(start_data) = extract_session_start(typed_events) {
        if let Some(ctx) = &start_data.context {
            if summary.repository.is_none() {
                summary.repository = ctx.repository.clone();
            }
            if summary.branch.is_none() {
                summary.branch = ctx.branch.clone();
            }
            if summary.host_type.is_none() {
                summary.host_type = ctx.host_type.clone();
            }
            if summary.cwd.is_none() {
                summary.cwd = ctx.cwd.clone();
            }
        }

        if summary.created_at.is_none()
            && let Some(ref ts) = start_data.start_time
        {
            summary.created_at = chrono::DateTime::parse_from_rfc3339(ts)
                .ok()
                .map(|d| d.with_timezone(&chrono::Utc));
        }
    }
}

/// Convert [`ShutdownData`] (event-level) to [`ShutdownMetrics`] (summary-level).
fn shutdown_data_to_metrics(data: &ShutdownData, shutdown_count: u32) -> ShutdownMetrics {
    ShutdownMetrics {
        shutdown_type: data.shutdown_type.clone(),
        total_premium_requests: data.total_premium_requests,
        total_api_duration_ms: data.total_api_duration_ms,
        session_start_time: data.session_start_time,
        current_model: data.current_model.clone(),
        current_tokens: data.current_tokens,
        system_tokens: data.system_tokens,
        conversation_tokens: data.conversation_tokens,
        tool_definitions_tokens: data.tool_definitions_tokens,
        code_changes: data.code_changes.clone(),
        model_metrics: data.model_metrics.clone().unwrap_or_default(),
        session_segments: data.session_segments.clone(),
        shutdown_count: Some(shutdown_count),
    }
}
