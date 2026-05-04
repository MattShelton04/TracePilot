use crate::document::{IncidentExport, RawEvent, SectionId, ShutdownMetrics};
use crate::options::ExportOptions;
use tracepilot_core::parsing::events::{
    TypedEvent, TypedEventData, extract_combined_shutdown_data,
};

pub(in crate::builder) fn build_events(
    options: &ExportOptions,
    raw_events: Option<Vec<RawEvent>>,
    available: &mut Vec<SectionId>,
) -> Option<Vec<RawEvent>> {
    if !options.includes(SectionId::Events) {
        return None;
    }
    let events = raw_events?;
    if !events.is_empty() {
        available.push(SectionId::Events);
    }
    Some(events)
}

pub(in crate::builder) fn build_metrics(
    options: &ExportOptions,
    typed_events: Option<&[TypedEvent]>,
    available: &mut Vec<SectionId>,
) -> Option<ShutdownMetrics> {
    if !options.includes(SectionId::Metrics) {
        return None;
    }
    let events = typed_events?;
    let (sd, count) = extract_combined_shutdown_data(events)?;

    available.push(SectionId::Metrics);
    Some(ShutdownMetrics {
        shutdown_type: sd.shutdown_type,
        total_premium_requests: sd.total_premium_requests,
        total_api_duration_ms: sd.total_api_duration_ms,
        session_start_time: sd.session_start_time,
        current_model: sd.current_model,
        current_tokens: sd.current_tokens,
        system_tokens: sd.system_tokens,
        conversation_tokens: sd.conversation_tokens,
        tool_definitions_tokens: sd.tool_definitions_tokens,
        total_nano_aiu: sd.total_nano_aiu,
        token_details: sd.token_details,
        code_changes: sd.code_changes,
        model_metrics: sd.model_metrics.unwrap_or_default(),
        session_segments: sd.session_segments,
        shutdown_count: Some(count),
    })
}

pub(in crate::builder) fn build_incidents(
    options: &ExportOptions,
    typed_events: Option<&[TypedEvent]>,
    available: &mut Vec<SectionId>,
) -> Option<Vec<IncidentExport>> {
    if !options.includes(SectionId::Incidents) {
        return None;
    }
    let events = typed_events?;
    let mut incidents = Vec::new();

    for event in events {
        let raw = &event.raw;
        let severity = match raw.event_type.as_str() {
            "session.error" => "error",
            "session.warning" => "warning",
            "session.compaction_complete" => "info",
            "session.truncation" => "warning",
            _ => continue,
        };

        let summary = match &event.typed_data {
            TypedEventData::SessionError(d) => d
                .message
                .clone()
                .unwrap_or_else(|| "Unknown error".to_string()),
            TypedEventData::SessionWarning(d) => {
                d.message.clone().unwrap_or_else(|| "Warning".to_string())
            }
            TypedEventData::CompactionComplete(d) => {
                format!(
                    "Compaction {}",
                    if d.success.unwrap_or(false) {
                        "succeeded"
                    } else {
                        "failed"
                    }
                )
            }
            TypedEventData::SessionTruncation(_) => "Session truncated".to_string(),
            _ => continue,
        };

        incidents.push(IncidentExport {
            event_type: raw.event_type.clone(),
            timestamp: raw.timestamp,
            severity: severity.to_string(),
            summary,
        });
    }

    if !incidents.is_empty() {
        available.push(SectionId::Incidents);
    }
    Some(incidents)
}
