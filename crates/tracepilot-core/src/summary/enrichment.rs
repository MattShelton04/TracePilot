use crate::ids::SessionId;
use crate::models::conversation::ConversationTurn;
use crate::models::event_types::ShutdownData;
use crate::models::session_summary::{SessionSummary, ShutdownMetrics};
use crate::parsing::events::{
    TypedEvent, current_session_effort, current_session_model, extract_combined_shutdown_data,
    extract_session_start,
};
use crate::turns::{reconstruct_turns, turn_stats};

use super::model_calls::metrics_from_model_calls;

/// A summary built from a session's normalized events alone, for providers
/// whose metadata lives in the event stream. Fields the events do not carry
/// (title, artifacts) are left for the provider to fill.
///
/// Returns the reconstructed turns for reuse.
pub fn summary_from_events(
    id: &SessionId,
    events: &[TypedEvent],
) -> (SessionSummary, Vec<ConversationTurn>) {
    let mut summary = SessionSummary {
        id: id.to_string(),
        summary: None,
        repository: None,
        branch: None,
        cwd: None,
        host_type: None,
        created_at: None,
        updated_at: None,
        event_count: None,
        has_events: !events.is_empty(),
        has_session_db: false,
        has_plan: false,
        has_checkpoints: false,
        checkpoint_count: None,
        turn_count: None,
        current_model: None,
        current_reasoning_effort: None,
        shutdown_metrics: None,
    };
    let turns = apply_event_enrichment(&mut summary, events);
    (summary, turns)
}

/// Enrich summary fields derivable from parsed events.
///
/// Returns the reconstructed turns so callers that need them (the indexer)
/// do not reconstruct a second time.
pub(crate) fn apply_event_enrichment(
    summary: &mut SessionSummary,
    typed_events: &[TypedEvent],
) -> Vec<ConversationTurn> {
    summary.event_count = Some(typed_events.len());

    if let Some((sd, count)) = extract_combined_shutdown_data(typed_events) {
        summary.shutdown_metrics = Some(shutdown_data_to_metrics(&sd, count));
    } else if let Some(metrics) = metrics_from_model_calls(typed_events) {
        summary.shutdown_metrics = Some(metrics.into());
    }

    summary.current_model = current_session_model(typed_events);
    summary.current_reasoning_effort = current_session_effort(typed_events);

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

    turns
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
        total_nano_aiu: data.total_nano_aiu,
        token_details: data.token_details.clone(),
        code_changes: data.code_changes.clone(),
        model_metrics: data.model_metrics.clone().unwrap_or_default(),
        session_segments: data.session_segments.clone(),
        source_metrics_scope: data.source_metrics_scope,
        shutdown_count: Some(shutdown_count),
        cost_amount: None,
        cost_unit: None,
        cost_basis: None,
        ..ShutdownMetrics::default()
    }
}
