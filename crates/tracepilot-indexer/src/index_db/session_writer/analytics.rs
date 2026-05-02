use std::collections::HashMap;

use tracepilot_core::parsing::events::TypedEventData;

use super::super::types::*;

// ── Pure analytics extraction ──────────────────────────────────────────

/// Extract all analytics from a session's summary and events without any
/// database interaction. This is the core computation that powers
/// `upsert_session`, extracted as a pure function for testability.
pub(crate) fn extract_session_analytics(
    summary: &tracepilot_core::SessionSummary,
    typed_events: &Option<Vec<tracepilot_core::parsing::events::TypedEvent>>,
    _diagnostics: Option<&tracepilot_core::parsing::diagnostics::ParseDiagnostics>,
    file_meta: &SessionFileMeta,
) -> SessionAnalytics {
    let mut total_tokens: i64 = 0;
    let mut total_cost: f64 = 0.0;
    let mut lines_added: Option<i64> = None;
    let mut lines_removed: Option<i64> = None;
    let mut model_rows: Vec<ModelMetricsRow> = Vec::new();
    let mut session_segment_rows: Vec<SessionSegmentRow> = Vec::new();

    let current_model = summary
        .shutdown_metrics
        .as_ref()
        .and_then(|m| m.current_model.clone());
    let total_premium_requests = summary
        .shutdown_metrics
        .as_ref()
        .and_then(|m| m.total_premium_requests);
    let total_api_duration_ms = summary
        .shutdown_metrics
        .as_ref()
        .and_then(|m| m.total_api_duration_ms.map(|v| v as i64));
    let mut copilot_version: Option<String> = None;

    if let Some(ref metrics) = summary.shutdown_metrics {
        for (model_name, detail) in &metrics.model_metrics {
            let (input_t, output_t, cache_read, cache_write, reasoning) =
                if let Some(ref usage) = detail.usage {
                    (
                        usage.input_tokens.unwrap_or(0) as i64,
                        usage.output_tokens.unwrap_or(0) as i64,
                        usage.cache_read_tokens.unwrap_or(0) as i64,
                        usage.cache_write_tokens.unwrap_or(0) as i64,
                        usage.reasoning_tokens.map(|v| v as i64),
                    )
                } else {
                    (0, 0, 0, 0, None)
                };
            let model_tokens = input_t + output_t;
            total_tokens += model_tokens;

            let cost = detail.requests.as_ref().and_then(|r| r.cost).unwrap_or(0.0);
            total_cost += cost;

            let req_count = detail.requests.as_ref().and_then(|r| r.count).unwrap_or(0) as i64;

            model_rows.push(ModelMetricsRow {
                model: model_name.clone(),
                input_tokens: input_t,
                output_tokens: output_t,
                cache_read_tokens: cache_read,
                cache_write_tokens: cache_write,
                cost,
                premium_requests: req_count,
                reasoning_tokens: reasoning,
            });
        }

        if let Some(ref cc) = metrics.code_changes {
            lines_added = cc.lines_added.map(|v| v as i64);
            lines_removed = cc.lines_removed.map(|v| v as i64);
        }

        if let Some(ref segments) = metrics.session_segments {
            for seg in segments {
                let mut tokens: i64 = 0;
                if let Some(ref mm) = seg.model_metrics {
                    for detail in mm.values() {
                        if let Some(ref usage) = detail.usage {
                            tokens += (usage.input_tokens.unwrap_or(0)
                                + usage.output_tokens.unwrap_or(0))
                                as i64;
                        }
                    }
                }

                let mm_json = seg
                    .model_metrics
                    .as_ref()
                    .and_then(|mm| serde_json::to_string(mm).ok());
                session_segment_rows.push(SessionSegmentRow {
                    start_timestamp: seg.start_timestamp.clone(),
                    end_timestamp: seg.end_timestamp.clone(),
                    tokens,
                    total_requests: seg.total_requests as i64,
                    premium_requests: seg.premium_requests,
                    api_duration_ms: seg.api_duration_ms as i64,
                    current_model: seg.current_model.clone(),
                    model_metrics_json: mm_json,
                });
            }
        }
    }

    // ── Extract event-level analytics (single pass) ────────────
    let mut tool_call_rows: Vec<ToolCallRow> = Vec::new();
    let mut activity_rows: Vec<ActivityRow> = Vec::new();
    let mut modified_file_rows: Vec<ModifiedFileRow> = Vec::new();
    let mut actual_tool_call_count: i64 = 0;

    let mut error_count: i64 = 0;
    let mut rate_limit_count: i64 = 0;
    let mut compaction_count: i64 = 0;
    let mut truncation_count: i64 = 0;
    let mut total_compaction_input: i64 = 0;
    let mut total_compaction_output: i64 = 0;
    let mut incidents: Vec<IncidentRow> = Vec::new();

    if let Some(events) = typed_events {
        let mut tool_starts: HashMap<String, (String, Option<chrono::DateTime<chrono::Utc>>)> =
            HashMap::new();
        let mut tool_accum: HashMap<String, (i64, i64, i64, i64, i64)> = HashMap::new();
        let mut heatmap_accum: HashMap<(i64, i64), i64> = HashMap::new();

        for event in events {
            match &event.typed_data {
                TypedEventData::SessionStart(d) => {
                    if let Some(version) = d.copilot_version.as_ref().filter(|v| !v.is_empty()) {
                        copilot_version = Some(version.clone());
                    }
                }
                TypedEventData::SessionResume(d) => {
                    if let Some(version) = d.copilot_version.as_ref().filter(|v| !v.is_empty()) {
                        copilot_version = Some(version.clone());
                    }
                }
                TypedEventData::UserMessage(_) => {
                    // FTS content extraction moved to search_writer (Phase 2)
                }
                TypedEventData::AssistantMessage(_) => {
                    // FTS content extraction moved to search_writer (Phase 2)
                }
                TypedEventData::ToolExecutionStart(d) => {
                    if let Some(ref tool_call_id) = d.tool_call_id {
                        let name = d.tool_name.clone().unwrap_or_else(|| "unknown".into());
                        tool_starts.insert(tool_call_id.clone(), (name, event.raw.timestamp));
                    }
                }
                TypedEventData::ToolExecutionComplete(d) => {
                    actual_tool_call_count += 1;
                    if let Some(ref tool_call_id) = d.tool_call_id
                        && let Some((tool_name, start_ts)) = tool_starts.remove(tool_call_id)
                    {
                        let acc = tool_accum
                            .entry(tool_name.clone())
                            .or_insert((0, 0, 0, 0, 0));
                        acc.0 += 1;

                        match d.success {
                            Some(true) => acc.1 += 1,
                            Some(false) => acc.2 += 1,
                            None => {}
                        }

                        if let (Some(start), Some(end)) = (start_ts, event.raw.timestamp) {
                            let dur = (end - start).num_milliseconds().max(0);
                            acc.3 += dur;
                            acc.4 += 1;
                        }

                        if let Some(ts) = start_ts {
                            use chrono::{Datelike, Timelike};
                            let day = ts.weekday().num_days_from_monday() as i64;
                            let hour = ts.hour() as i64;
                            *heatmap_accum.entry((day, hour)).or_insert(0) += 1;
                        }
                    }
                }
                TypedEventData::SessionError(d) => {
                    error_count += 1;
                    let is_rate_limit = d.error_type.as_deref() == Some("rate_limit");
                    if is_rate_limit {
                        rate_limit_count += 1;
                    }
                    if incidents.len() < MAX_INCIDENTS_PER_SESSION {
                        let summary = if is_rate_limit {
                            "Rate limit hit".into()
                        } else {
                            d.message.clone().unwrap_or_default()
                        };
                        incidents.push(IncidentRow {
                            event_type: "error".into(),
                            source_event_type: "session.error".into(),
                            timestamp: event.raw.timestamp.as_ref().map(|t| t.to_rfc3339()),
                            severity: "error".into(),
                            summary,
                            detail_json: serde_json::to_string(&event.raw.data).ok(),
                        });
                    }
                }
                TypedEventData::SessionWarning(d) => {
                    if incidents.len() < MAX_INCIDENTS_PER_SESSION {
                        incidents.push(IncidentRow {
                            event_type: "warning".into(),
                            source_event_type: "session.warning".into(),
                            timestamp: event.raw.timestamp.as_ref().map(|t| t.to_rfc3339()),
                            severity: "warning".into(),
                            summary: d.message.clone().unwrap_or_default(),
                            detail_json: serde_json::to_string(&event.raw.data).ok(),
                        });
                    }
                }
                TypedEventData::CompactionComplete(d) => {
                    compaction_count += 1;
                    if let Some(usage) = &d.compaction_tokens_used {
                        total_compaction_input += usage.input.unwrap_or(0) as i64;
                        total_compaction_output += usage.output.unwrap_or(0) as i64;
                    }
                    if incidents.len() < MAX_INCIDENTS_PER_SESSION {
                        incidents.push(IncidentRow {
                            event_type: "compaction".into(),
                            source_event_type: "session.compaction_complete".into(),
                            timestamp: event.raw.timestamp.as_ref().map(|t| t.to_rfc3339()),
                            severity: if d.success == Some(true) {
                                "info"
                            } else {
                                "warning"
                            }
                            .into(),
                            summary: format!(
                                "Compaction {} (checkpoint #{}): {} tokens before compaction",
                                if d.success == Some(true) {
                                    "succeeded"
                                } else {
                                    "failed"
                                },
                                d.checkpoint_number.unwrap_or(0),
                                d.pre_compaction_tokens.unwrap_or(0),
                            ),
                            detail_json: serde_json::to_string(&event.raw.data).ok(),
                        });
                    }
                }
                TypedEventData::SessionTruncation(d) => {
                    truncation_count += 1;
                    if incidents.len() < MAX_INCIDENTS_PER_SESSION {
                        incidents.push(IncidentRow {
                            event_type: "truncation".into(),
                            source_event_type: "session.truncation".into(),
                            timestamp: event.raw.timestamp.as_ref().map(|t| t.to_rfc3339()),
                            severity: "warning".into(),
                            summary: format!(
                                "Truncated {} tokens ({} messages) by {}",
                                d.tokens_removed_during_truncation.unwrap_or(0),
                                d.messages_removed_during_truncation.unwrap_or(0),
                                d.performed_by.as_deref().unwrap_or("unknown"),
                            ),
                            detail_json: serde_json::to_string(&event.raw.data).ok(),
                        });
                    }
                }
                _ => {}
            }
        }

        for (name, (calls, success, failure, dur, dur_count)) in &tool_accum {
            tool_call_rows.push(ToolCallRow {
                name: name.clone(),
                calls: *calls,
                success: *success,
                failure: *failure,
                duration_ms: *dur,
                calls_with_duration: *dur_count,
            });
        }
        for ((day, hour), count) in &heatmap_accum {
            activity_rows.push(ActivityRow {
                day_of_week: *day,
                hour: *hour,
                tool_call_count: *count,
            });
        }
    }

    let final_tool_call_count = if actual_tool_call_count > 0 {
        Some(actual_tool_call_count)
    } else {
        None
    };

    // Modified files from shutdown metrics
    if let Some(ref metrics) = summary.shutdown_metrics
        && let Some(ref cc) = metrics.code_changes
        && let Some(ref files) = cc.files_modified
    {
        for file in files {
            let ext = std::path::Path::new(file)
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_string());
            modified_file_rows.push(ModifiedFileRow {
                file_path: file.clone(),
                extension: ext,
            });
        }
    }

    SessionAnalytics {
        total_tokens,
        total_cost,
        lines_added,
        lines_removed,
        tool_call_count: final_tool_call_count,
        current_model,
        copilot_version,
        total_premium_requests,
        total_api_duration_ms,
        workspace_mtime: file_meta.workspace_mtime.clone(),
        events_mtime: file_meta.events_mtime.clone(),
        events_size: file_meta.events_size,
        model_rows,
        tool_call_rows,
        activity_rows,
        modified_file_rows,
        session_segment_rows,
        error_count,
        rate_limit_count,
        compaction_count,
        truncation_count,
        total_compaction_input,
        total_compaction_output,
        incidents,
    }
}
