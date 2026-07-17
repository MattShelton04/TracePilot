//! Session-level aggregation helpers — extract session start and merge shutdown metrics.

use super::typed::{TypedEvent, TypedEventData};
use crate::models::event_types::{
    CodeChanges, ModelMetricDetail, RequestMetrics, SessionEventType, SessionSegment,
    SessionStartData, ShutdownData, ShutdownMetricsScope, ShutdownTokenDetail, UsageMetrics,
};
use chrono::{DateTime, Utc};
use std::collections::HashMap;

/// Normalizes legacy per-instance shutdown metrics and newer cumulative
/// shutdown snapshots into one session aggregate. Returns `(combined_data, count)`.
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
    // Newer Copilot builds restore accounting from prior shutdowns when a
    // session resumes, so each later shutdown is cumulative. `eventsFileSizeBytes`
    // arrived with that persisted snapshot behavior and is a data-shape marker,
    // avoiding an unreliable producer-version cutoff.
    let cumulative_snapshot_count = shutdowns
        .iter()
        .filter(|(shutdown, _)| shutdown.events_file_size_bytes.is_some())
        .count();
    let source_metrics_scope = match cumulative_snapshot_count {
        0 => ShutdownMetricsScope::Segment,
        count if count == shutdowns.len() => ShutdownMetricsScope::Cumulative,
        _ => ShutdownMetricsScope::Mixed,
    };
    // If a session crossed the producer change, the first cumulative snapshot
    // includes the immediately preceding legacy segment (the resume path
    // restores that shutdown). Earlier legacy segments still need adding.
    let first_cumulative_snapshot = shutdowns
        .iter()
        .position(|(shutdown, _)| shutdown.events_file_size_bytes.is_some());
    let aggregate_sources: Vec<&ShutdownData> = match first_cumulative_snapshot {
        None => shutdowns.iter().map(|(shutdown, _)| *shutdown).collect(),
        Some(0) => vec![*last],
        Some(first_cumulative) => shutdowns[..first_cumulative - 1]
            .iter()
            .map(|(shutdown, _)| *shutdown)
            .chain(std::iter::once(*last))
            .collect(),
    };

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

        let previous_shutdown = i
            .checked_sub(1)
            .and_then(|previous_index| shutdowns.get(previous_index))
            .map(|(shutdown, _)| *shutdown);
        let is_cumulative_snapshot =
            sd.events_file_size_bytes.is_some() && previous_shutdown.is_some();
        let segment_model_metrics = if is_cumulative_snapshot {
            Some(subtract_model_metrics(
                sd.model_metrics.as_ref(),
                previous_shutdown.and_then(|previous| previous.model_metrics.as_ref()),
            ))
        } else {
            sd.model_metrics.clone()
        };
        let segment_premium_requests = if is_cumulative_snapshot {
            diff_opt_f64(
                sd.total_premium_requests,
                previous_shutdown.and_then(|previous| previous.total_premium_requests),
            )
        } else {
            sd.total_premium_requests
        };
        let segment_api_duration_ms = if is_cumulative_snapshot {
            diff_opt_u64(
                sd.total_api_duration_ms,
                previous_shutdown.and_then(|previous| previous.total_api_duration_ms),
            )
        } else {
            sd.total_api_duration_ms
        };
        let segment_total_nano_aiu = if is_cumulative_snapshot {
            diff_opt_u64(
                sd.total_nano_aiu,
                previous_shutdown.and_then(|previous| previous.total_nano_aiu),
            )
        } else {
            sd.total_nano_aiu
        };
        let mut tokens = 0u64;
        let mut total_requests = 0u64;
        if let Some(ref mm) = segment_model_metrics {
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
            premium_requests: segment_premium_requests.unwrap_or(0.0),
            api_duration_ms: segment_api_duration_ms.unwrap_or(0),
            total_nano_aiu: segment_total_nano_aiu,
            current_model: sd.current_model.clone(),
            model_metrics: segment_model_metrics,
        });
    }

    Some(ShutdownData {
        shutdown_type: last.shutdown_type.clone(),
        error_reason: last.error_reason.clone(),
        current_model: last.current_model.clone(),
        session_start_time: first.session_start_time,
        events_file_size_bytes: last.events_file_size_bytes,
        source_metrics_scope: Some(source_metrics_scope),
        total_premium_requests: sum_opt_f64(
            aggregate_sources
                .iter()
                .map(|shutdown| shutdown.total_premium_requests),
        ),
        total_api_duration_ms: sum_opt_u64(
            aggregate_sources
                .iter()
                .map(|shutdown| shutdown.total_api_duration_ms),
        ),
        // Token fields are point-in-time snapshots — use the last shutdown's values.
        current_tokens: last.current_tokens,
        system_tokens: last.system_tokens,
        conversation_tokens: last.conversation_tokens,
        tool_definitions_tokens: last.tool_definitions_tokens,
        total_nano_aiu: sum_opt_u64(
            aggregate_sources
                .iter()
                .map(|shutdown| shutdown.total_nano_aiu),
        ),
        token_details: combine_token_details(
            aggregate_sources
                .iter()
                .map(|shutdown| shutdown.token_details.as_ref()),
        ),
        code_changes: combine_code_changes(
            aggregate_sources
                .iter()
                .map(|shutdown| shutdown.code_changes.as_ref()),
        ),
        model_metrics: Some(combine_model_metrics(
            aggregate_sources
                .iter()
                .map(|shutdown| shutdown.model_metrics.as_ref()),
        )),
        session_segments: Some(segments),
    })
}

fn combine_token_details<'a>(
    details: impl Iterator<Item = Option<&'a HashMap<String, ShutdownTokenDetail>>>,
) -> Option<HashMap<String, ShutdownTokenDetail>> {
    let mut combined: HashMap<String, ShutdownTokenDetail> = HashMap::new();
    for detail_map in details.flatten() {
        for (token_type, detail) in detail_map {
            let entry = combined.entry(token_type.clone()).or_default();
            entry.token_count = sum_pair_opt_u64(entry.token_count, detail.token_count);
        }
    }
    if combined.is_empty() {
        None
    } else {
        Some(combined)
    }
}

fn diff_opt_u64(current: Option<u64>, previous: Option<u64>) -> Option<u64> {
    current.map(|value| value.saturating_sub(previous.unwrap_or(0)))
}

fn diff_opt_f64(current: Option<f64>, previous: Option<f64>) -> Option<f64> {
    current.map(|value| (value - previous.unwrap_or(0.0)).max(0.0))
}

fn subtract_token_details(
    current: Option<&HashMap<String, ShutdownTokenDetail>>,
    previous: Option<&HashMap<String, ShutdownTokenDetail>>,
) -> Option<HashMap<String, ShutdownTokenDetail>> {
    let current = current?;
    let mut result = HashMap::new();
    for (token_type, detail) in current {
        let previous_count = previous
            .and_then(|details| details.get(token_type))
            .and_then(|detail| detail.token_count);
        result.insert(
            token_type.clone(),
            ShutdownTokenDetail {
                token_count: diff_opt_u64(detail.token_count, previous_count),
            },
        );
    }
    Some(result)
}

fn subtract_model_metrics(
    current: Option<&HashMap<String, ModelMetricDetail>>,
    previous: Option<&HashMap<String, ModelMetricDetail>>,
) -> HashMap<String, ModelMetricDetail> {
    let mut result = HashMap::new();
    for (model, detail) in current.into_iter().flatten() {
        let previous_detail = previous.and_then(|metrics| metrics.get(model));
        let requests = detail.requests.as_ref().map(|requests| RequestMetrics {
            count: diff_opt_u64(
                requests.count,
                previous_detail
                    .and_then(|detail| detail.requests.as_ref())
                    .and_then(|requests| requests.count),
            ),
            cost: diff_opt_f64(
                requests.cost,
                previous_detail
                    .and_then(|detail| detail.requests.as_ref())
                    .and_then(|requests| requests.cost),
            ),
        });
        let usage = detail.usage.as_ref().map(|usage| {
            let previous_usage = previous_detail.and_then(|detail| detail.usage.as_ref());
            UsageMetrics {
                input_tokens: diff_opt_u64(
                    usage.input_tokens,
                    previous_usage.and_then(|usage| usage.input_tokens),
                ),
                output_tokens: diff_opt_u64(
                    usage.output_tokens,
                    previous_usage.and_then(|usage| usage.output_tokens),
                ),
                cache_read_tokens: diff_opt_u64(
                    usage.cache_read_tokens,
                    previous_usage.and_then(|usage| usage.cache_read_tokens),
                ),
                cache_write_tokens: diff_opt_u64(
                    usage.cache_write_tokens,
                    previous_usage.and_then(|usage| usage.cache_write_tokens),
                ),
                reasoning_tokens: diff_opt_u64(
                    usage.reasoning_tokens,
                    previous_usage.and_then(|usage| usage.reasoning_tokens),
                ),
            }
        });

        result.insert(
            model.clone(),
            ModelMetricDetail {
                requests,
                usage,
                total_nano_aiu: diff_opt_u64(
                    detail.total_nano_aiu,
                    previous_detail.and_then(|detail| detail.total_nano_aiu),
                ),
                token_details: subtract_token_details(
                    detail.token_details.as_ref(),
                    previous_detail.and_then(|detail| detail.token_details.as_ref()),
                ),
            },
        );
    }
    result
}

fn sum_pair_opt_u64(a: Option<u64>, b: Option<u64>) -> Option<u64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a + b),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

/// Sum Option<f64> values: None + Some(5) = Some(5), None + None = None.
fn sum_opt_f64(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    let mut has_any = false;
    let mut total = 0.0;
    for n in values.flatten() {
        has_any = true;
        total += n;
    }
    if has_any {
        Some(total)
    } else {
        None
    }
}

/// Sum Option<u64> values: None + Some(5) = Some(5), None + None = None.
fn sum_opt_u64(values: impl Iterator<Item = Option<u64>>) -> Option<u64> {
    let mut has_any = false;
    let mut total = 0u64;
    for n in values.flatten() {
        has_any = true;
        total += n;
    }
    if has_any {
        Some(total)
    } else {
        None
    }
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
        if files.is_empty() {
            None
        } else {
            Some(files)
        }
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
                    total_nano_aiu: None,
                    token_details: None,
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
            entry.total_nano_aiu =
                sum_opt_u64([entry.total_nano_aiu, detail.total_nano_aiu].into_iter());
            entry.token_details = combine_token_details(
                [entry.token_details.as_ref(), detail.token_details.as_ref()].into_iter(),
            );
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
