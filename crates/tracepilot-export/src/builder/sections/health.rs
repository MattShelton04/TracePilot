use crate::document::{SectionId, SessionHealth, ShutdownMetrics};
use crate::options::ExportOptions;
use tracepilot_core::health::{SessionIncidentCounts, compute_health};
use tracepilot_core::parsing::events::{TypedEvent, extract_combined_shutdown_data};

pub(in crate::builder) fn build_health(
    options: &ExportOptions,
    typed_events: Option<&[TypedEvent]>,
    diagnostics: Option<&tracepilot_core::parsing::diagnostics::ParseDiagnostics>,
    available: &mut Vec<SectionId>,
) -> Option<SessionHealth> {
    if !options.includes(SectionId::Health) {
        return None;
    }

    // Count incidents for health scoring
    let incident_counts = typed_events.map(|events| {
        let mut counts = SessionIncidentCounts::default();
        for event in events {
            match event.raw.event_type.as_str() {
                "session.error" => counts.error_count += 1,
                "session.warning" => counts.warning_count += 1,
                "session.compaction_complete" => counts.compaction_count += 1,
                "session.truncation" => counts.truncation_count += 1,
                _ => {}
            }
        }
        counts
    });

    let event_count = typed_events.map(|e| e.len());
    let shutdown_metrics = typed_events.and_then(|events| {
        extract_combined_shutdown_data(events).map(|(sd, count)| ShutdownMetrics {
            shutdown_type: sd.shutdown_type,
            total_premium_requests: sd.total_premium_requests,
            total_api_duration_ms: sd.total_api_duration_ms,
            session_start_time: sd.session_start_time,
            current_model: sd.current_model,
            current_tokens: sd.current_tokens,
            system_tokens: sd.system_tokens,
            conversation_tokens: sd.conversation_tokens,
            tool_definitions_tokens: sd.tool_definitions_tokens,
            code_changes: sd.code_changes,
            model_metrics: sd.model_metrics.unwrap_or_default(),
            session_segments: sd.session_segments,
            shutdown_count: Some(count),
        })
    });

    let health = compute_health(
        event_count,
        shutdown_metrics.as_ref(),
        diagnostics,
        incident_counts.as_ref(),
    );

    available.push(SectionId::Health);
    Some(health)
}
