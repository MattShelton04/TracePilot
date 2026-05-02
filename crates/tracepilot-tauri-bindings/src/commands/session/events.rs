//! Event-level commands: freshness probe, paginated events, lazy tool-result.

use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::with_session_path;
use crate::types::{EventCache, EventItem, EventsResponse, FreshnessResponse};
use tracepilot_core::parsing::EVENTS_JSONL;

use super::shared::{load_cached_typed_events, system_time_to_unix_millis};

/// Lightweight freshness probe— returns just the events.jsonl file size.
#[tauri::command]
#[specta::specta]
pub async fn check_session_freshness(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<FreshnessResponse> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_path(&state, sid, |path| {
        let meta = std::fs::metadata(path.join(EVENTS_JSONL)).ok();
        let file_size = meta.as_ref().map_or(0, |m| m.len());
        let file_mtime = meta.and_then(|m| m.modified().ok());
        Ok(FreshnessResponse {
            events_file_size: file_size,
            events_file_mtime: system_time_to_unix_millis(file_mtime),
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_events(
    state: tauri::State<'_, SharedConfig>,
    cache: tauri::State<'_, EventCache>,
    session_id: String,
    offset: Option<u32>,
    limit: Option<u32>,
    event_type: Option<String>,
) -> CmdResult<EventsResponse> {
    // Clamp explicit limit to a safe upper bound; None preserves "return all".
    let limit = crate::validators::clamp_limit(limit, crate::validators::MAX_EVENTS_PAGE_LIMIT);
    let sid = crate::validators::validate_session_id(&session_id)?;
    let cache = cache.inner().clone();
    let cache_session_id = session_id.clone();

    with_session_path(&state, sid, move |path| {
        let events_path = path.join(EVENTS_JSONL);
        let (all_events, _, _) = load_cached_typed_events(&cache, &cache_session_id, &events_path)?;

        let all_event_types: Vec<String> = {
            let mut types = std::collections::BTreeSet::new();
            for event in all_events.iter() {
                types.insert(event.event_type.to_string());
            }
            types.into_iter().collect()
        };

        let events: Vec<_> = if let Some(ref filter_type) = event_type {
            all_events
                .iter()
                .filter(|e| &e.event_type.to_string() == filter_type)
                .collect()
        } else {
            all_events.iter().collect()
        };

        let total_count = events.len();
        let offset = offset.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(total_count as u32) as usize;
        let start = offset.min(total_count);
        let end = start.saturating_add(limit).min(total_count);

        let event_items = events[start..end]
            .iter()
            .map(|event| EventItem {
                event_type: event.event_type.to_string(),
                timestamp: event.raw.timestamp.as_ref().map(|ts| ts.to_rfc3339()),
                id: event.raw.id.clone(),
                parent_id: event.raw.parent_id.clone(),
                data: event.raw.data.clone(),
            })
            .collect();

        Ok(EventsResponse {
            events: event_items,
            total_count,
            has_more: end < total_count,
            all_event_types,
        })
    })
    .await
}

/// Lazy-load the full result payload for a specific tool call.
#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(%session_id, %tool_call_id))]
pub async fn get_tool_result(
    state: tauri::State<'_, SharedConfig>,
    cache: tauri::State<'_, EventCache>,
    session_id: String,
    tool_call_id: String,
) -> CmdResult<Option<serde_json::Value>> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    let cache = cache.inner().clone();
    let cache_session_id = session_id.clone();

    with_session_path(&state, sid, move |path| {
        let events_path = path.join(EVENTS_JSONL);
        let (events, _, _) = load_cached_typed_events(&cache, &cache_session_id, &events_path)?;

        let mut last_result: Option<serde_json::Value> = None;
        for event in events.iter() {
            if let tracepilot_core::parsing::events::TypedEventData::ToolExecutionComplete(
                ref data,
            ) = event.typed_data
                && data.tool_call_id.as_deref() == Some(&tool_call_id) {
                    last_result = data.result.clone();
                }
        }
        Ok(last_result)
    })
    .await
}
