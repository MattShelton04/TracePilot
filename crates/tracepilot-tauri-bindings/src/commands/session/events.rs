//! Event-level commands: freshness probe, paginated events, lazy tool-result.

use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::with_session_locator;
use crate::types::{EventCache, EventItem, EventsResponse, FreshnessResponse};
use tracepilot_core::parsing::events::TypedEvent;

use super::shared::{load_cached_typed_events, source_stamp, system_time_to_unix_millis};

/// Lightweight freshness probe: the session's `source_version` plus the
/// legacy event-log size and mtime.
#[tauri::command]
#[specta::specta]
pub async fn check_session_freshness(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<FreshnessResponse> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, |session| {
        let stamp = source_stamp(&session)?;
        Ok(FreshnessResponse {
            events_file_size: stamp.events_file_size,
            events_file_mtime: system_time_to_unix_millis(stamp.events_file_mtime),
            source_version: stamp.version,
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

    with_session_locator(&state, sid, move |session| {
        let (all_events, _) = load_cached_typed_events(&cache, &session)?;

        let all_event_types: Vec<String> = {
            let mut types = std::collections::BTreeSet::new();
            for event in all_events.iter() {
                types.insert(event.event_type.to_string());
            }
            types.into_iter().collect()
        };

        let (events, total_count, has_more) =
            page_events(&all_events, event_type.as_deref(), offset, limit);

        Ok(EventsResponse {
            events,
            total_count,
            has_more,
            all_event_types,
        })
    })
    .await
}

/// One page of the session's events, optionally of one type: the page's
/// items, how many events match, and whether more follow. Each item keeps its
/// 0-based position among all the session's events, so a filtered page still
/// says which event it is.
fn page_events(
    all_events: &[TypedEvent],
    event_type: Option<&str>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> (Vec<EventItem>, usize, bool) {
    let matching: Vec<(usize, &TypedEvent)> = all_events
        .iter()
        .enumerate()
        .filter(|(_, e)| event_type.is_none_or(|t| e.event_type.to_string() == t))
        .collect();

    let total_count = matching.len();
    let offset = offset.unwrap_or(0) as usize;
    let limit = limit.unwrap_or(total_count as u32) as usize;
    let start = offset.min(total_count);
    let end = start.saturating_add(limit).min(total_count);

    let items = matching[start..end]
        .iter()
        .map(|&(index, event)| EventItem {
            index,
            event_type: event.event_type.to_string(),
            timestamp: event.raw.timestamp.as_ref().map(|ts| ts.to_rfc3339()),
            id: event.raw.id.clone(),
            parent_id: event.raw.parent_id.clone(),
            data: event.raw.data.clone(),
        })
        .collect();
    (items, total_count, end < total_count)
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

    with_session_locator(&state, sid, move |session| {
        let (events, _) = load_cached_typed_events(&cache, &session)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    fn events(types: &[&str]) -> Vec<TypedEvent> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        let lines: Vec<String> = types
            .iter()
            .enumerate()
            .map(|(i, t)| {
                serde_json::json!({"type": t, "id": format!("e{i}"), "data": {}}).to_string()
            })
            .collect();
        std::fs::write(&path, lines.join("\n")).unwrap();
        tracepilot_core::parsing::events::parse_typed_events(&path)
            .unwrap()
            .events
    }

    fn indexes(items: &[EventItem]) -> Vec<usize> {
        items.iter().map(|e| e.index).collect()
    }

    #[test]
    fn filtered_pages_keep_each_event_s_position_in_the_session() {
        let all = events(&[
            "user.message",
            "tool.execution_start",
            "assistant.message",
            "tool.execution_start",
            "tool.execution_start",
        ]);

        let (items, total, more) = page_events(&all, None, None, None);
        assert_eq!(indexes(&items), [0, 1, 2, 3, 4]);
        assert_eq!((total, more), (5, false));

        let (items, total, more) = page_events(&all, Some("tool.execution_start"), None, None);
        assert_eq!(indexes(&items), [1, 3, 4]);
        assert_eq!(items[0].id.as_deref(), Some("e1"));
        assert_eq!((total, more), (3, false));

        // A later page of a filter still counts from the session's first event.
        let (items, total, more) =
            page_events(&all, Some("tool.execution_start"), Some(1), Some(1));
        assert_eq!(indexes(&items), [3]);
        assert_eq!((total, more), (3, true));

        let (items, total, more) =
            page_events(&all, Some("tool.execution_start"), Some(9), Some(1));
        assert!(items.is_empty());
        assert_eq!((total, more), (3, false));
    }
}
