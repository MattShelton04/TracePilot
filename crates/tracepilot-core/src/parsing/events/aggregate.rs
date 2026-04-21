//! Session-level aggregation helpers — extract session start and merge shutdown metrics.

use super::typed::{TypedEvent, TypedEventData};
use crate::models::event_types::{
    CodeChanges, ModelMetricDetail, RequestMetrics, SessionEventType, SessionSegment,
    SessionStartData, ShutdownData, UsageMetrics,
};
use chrono::{DateTime, Utc};
use std::collections::HashMap;

/// Metrics in each shutdown event are per-instance (not cumulative), so resumed
/// sessions require summing across all shutdown events. Returns `(combined_data, count)`.
pub fn extract_combined_shutdown_data(events: &[TypedEvent]) -> Option<(ShutdownData, u32)> {
    let shutdowns: Vec<(&ShutdownData, Option<DateTime<Utc>>)> = events
        .iter()
        .filter(|e| e.event_type == SessionEventType::SessionShutdown)
        .filter_map(|e| match &e.typed_data {
            TypedEventData::SessionShutdown(d) => Some((d, e.raw.timestamp)),
            _ => None,
        })
        .collect();

    if shutdowns.is_empty() {
        return None;
    }

    // Collect session start and resume timestamps to derive correct segment start times
    let session_start_ts: Option<DateTime<Utc>> = events
        .iter()
        .find(|e| e.event_type == SessionEventType::SessionStart)
        .and_then(|e| e.raw.timestamp);

    let mut resume_timestamps: Vec<DateTime<Utc>> = events
        .iter()
        .filter(|e| e.event_type == SessionEventType::SessionResume)
        .filter_map(|e| e.raw.timestamp)
        .collect();
    resume_timestamps.sort();

    let count = shutdowns.len() as u32;

    Some((
        combine_shutdown_data(&shutdowns, session_start_ts, &resume_timestamps)?,
        count,
    ))
}

/// Combine multiple `ShutdownData` instances into a single aggregate.
///
/// `session_start_ts` is the timestamp from the `session.start` event.
/// `resume_timestamps` are sorted timestamps from `session.resume` events,
/// used to derive accurate start times for each segment.
fn combine_shutdown_data(
    shutdowns: &[(&ShutdownData, Option<DateTime<Utc>>)],
    session_start_ts: Option<DateTime<Utc>>,
    resume_timestamps: &[DateTime<Utc>],
) -> Option<ShutdownData> {
    let (first, _) = shutdowns.first()?;
    let (last, _) = shutdowns.last()?;

    let mut segments: Vec<SessionSegment> = Vec::new();

    // First segment starts at session.start event timestamp, falling back to sessionStartTime epoch
    let session_start_str = session_start_ts
        .map(|dt| dt.to_rfc3339())
        .or_else(|| {
            first
                .session_start_time
                .and_then(|ms| DateTime::from_timestamp_millis(ms as i64))
                .map(|dt| dt.to_rfc3339())
        })
        .unwrap_or_else(|| "unknown".to_string());

    let mut resume_iter = resume_timestamps.iter().peekable();

    for (i, (sd, ts)) in shutdowns.iter().enumerate() {
        let end_str = ts
            .map(|t| t.to_rfc3339())
            .unwrap_or_else(|| "unknown".to_string());

        // Determine start: first segment uses session start, others use the
        // most recent resume event that occurred before this shutdown.
        let start_str = if i == 0 {
            session_start_str.clone()
        } else {
            // Advance the resume iterator past any resumes before this shutdown,
            // keeping the last one seen as the start time.
            let mut last_resume: Option<&DateTime<Utc>> = None;
            while let Some(&&rt) = resume_iter.peek().as_ref() {
                if ts.is_none_or(|shutdown_ts| *rt <= shutdown_ts) {
                    last_resume = Some(
                        resume_iter
                            .next()
                            .expect("BUG: peek() confirmed element exists"),
                    );
                } else {
                    break;
                }
            }
            last_resume
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| end_str.clone())
        };

        let mut tokens = 0u64;
        let mut total_requests = 0u64;
        if let Some(ref mm) = sd.model_metrics {
            for detail in mm.values() {
                if let Some(ref usage) = detail.usage {
                    tokens += usage.input_tokens.unwrap_or(0) + usage.output_tokens.unwrap_or(0);
                }
                if let Some(ref req) = detail.requests {
                    total_requests += req.count.unwrap_or(0);
                }
            }
        }

        segments.push(SessionSegment {
            start_timestamp: start_str,
            end_timestamp: end_str,
            tokens,
            total_requests,
            premium_requests: sd.total_premium_requests.unwrap_or(0.0),
            api_duration_ms: sd.total_api_duration_ms.unwrap_or(0),
            current_model: sd.current_model.clone(),
            model_metrics: sd.model_metrics.clone(),
        });
    }

    Some(ShutdownData {
        shutdown_type: last.shutdown_type.clone(),
        current_model: last.current_model.clone(),
        session_start_time: first.session_start_time,
        total_premium_requests: sum_opt_f64(
            shutdowns.iter().map(|(s, _)| s.total_premium_requests),
        ),
        total_api_duration_ms: sum_opt_u64(shutdowns.iter().map(|(s, _)| s.total_api_duration_ms)),
        // Token fields are point-in-time snapshots — use the last shutdown's values.
        current_tokens: last.current_tokens,
        system_tokens: last.system_tokens,
        conversation_tokens: last.conversation_tokens,
        tool_definitions_tokens: last.tool_definitions_tokens,
        code_changes: combine_code_changes(shutdowns.iter().map(|(s, _)| s.code_changes.as_ref())),
        model_metrics: Some(combine_model_metrics(
            shutdowns.iter().map(|(s, _)| s.model_metrics.as_ref()),
        )),
        session_segments: Some(segments),
    })
}

/// Sum Option<f64> values: None + Some(5) = Some(5), None + None = None.
fn sum_opt_f64(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    let mut has_any = false;
    let mut total = 0.0;
    for n in values.flatten() {
        has_any = true;
        total += n;
    }
    if has_any { Some(total) } else { None }
}

/// Sum Option<u64> values: None + Some(5) = Some(5), None + None = None.
fn sum_opt_u64(values: impl Iterator<Item = Option<u64>>) -> Option<u64> {
    let mut has_any = false;
    let mut total = 0u64;
    for n in values.flatten() {
        has_any = true;
        total += n;
    }
    if has_any { Some(total) } else { None }
}

/// Combine code changes: sum lines, deduplicate files.
fn combine_code_changes<'a>(
    changes: impl Iterator<Item = Option<&'a CodeChanges>>,
) -> Option<CodeChanges> {
    let items: Vec<&CodeChanges> = changes.flatten().collect();
    if items.is_empty() {
        return None;
    }

    let lines_added = sum_opt_u64(items.iter().map(|c| c.lines_added));
    let lines_removed = sum_opt_u64(items.iter().map(|c| c.lines_removed));

    // Deduplicated union of all modified files
    let files_modified = {
        let mut seen = std::collections::HashSet::new();
        let mut files = Vec::new();
        for c in &items {
            if let Some(ref f) = c.files_modified {
                for path in f {
                    if seen.insert(path.clone()) {
                        files.push(path.clone());
                    }
                }
            }
        }
        if files.is_empty() { None } else { Some(files) }
    };

    Some(CodeChanges {
        lines_added,
        lines_removed,
        files_modified,
    })
}

/// Merge per-model metric HashMaps: for each model key, sum all numeric fields.
fn combine_model_metrics<'a>(
    maps: impl Iterator<Item = Option<&'a HashMap<String, ModelMetricDetail>>>,
) -> HashMap<String, ModelMetricDetail> {
    let mut merged: HashMap<String, ModelMetricDetail> = HashMap::new();

    for map in maps.flatten() {
        for (model, detail) in map {
            let entry = merged
                .entry(model.clone())
                .or_insert_with(|| ModelMetricDetail {
                    requests: None,
                    usage: None,
                });

            // Merge requests
            if let Some(ref req) = detail.requests {
                let e_req = entry.requests.get_or_insert(RequestMetrics {
                    count: None,
                    cost: None,
                });
                e_req.count = sum_opt_u64([e_req.count, req.count].into_iter());
                e_req.cost = sum_opt_f64([e_req.cost, req.cost].into_iter());
            }

            // Merge usage
            if let Some(ref usg) = detail.usage {
                let e_usg = entry.usage.get_or_insert(UsageMetrics {
                    input_tokens: None,
                    output_tokens: None,
                    cache_read_tokens: None,
                    cache_write_tokens: None,
                    reasoning_tokens: None,
                });
                e_usg.input_tokens =
                    sum_opt_u64([e_usg.input_tokens, usg.input_tokens].into_iter());
                e_usg.output_tokens =
                    sum_opt_u64([e_usg.output_tokens, usg.output_tokens].into_iter());
                e_usg.cache_read_tokens =
                    sum_opt_u64([e_usg.cache_read_tokens, usg.cache_read_tokens].into_iter());
                e_usg.cache_write_tokens =
                    sum_opt_u64([e_usg.cache_write_tokens, usg.cache_write_tokens].into_iter());
                e_usg.reasoning_tokens =
                    sum_opt_u64([e_usg.reasoning_tokens, usg.reasoning_tokens].into_iter());
            }
        }
    }

    merged
}

/// Extract session start data from the FIRST `session.start` event.
pub fn extract_session_start(events: &[TypedEvent]) -> Option<SessionStartData> {
    events
        .iter()
        .find(|e| e.event_type == SessionEventType::SessionStart)
        .and_then(|e| match &e.typed_data {
            TypedEventData::SessionStart(d) => Some(d.clone()),
            _ => None,
        })
}
