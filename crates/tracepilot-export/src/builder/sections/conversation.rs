use std::collections::HashMap;

use crate::document::{ConversationTurn, SectionId};
use crate::options::ExportOptions;
use tracepilot_core::parsing::events::{TypedEvent, TypedEventData};
use tracepilot_core::turns::reconstruct_turns;

pub(in crate::builder) fn build_conversation(
    options: &ExportOptions,
    typed_events: Option<&[TypedEvent]>,
    available: &mut Vec<SectionId>,
) -> Option<Vec<ConversationTurn>> {
    if !options.includes(SectionId::Conversation) {
        return None;
    }
    let events = typed_events?;
    let mut turns = reconstruct_turns(events);

    // Optionally replace truncated result_content with full content from events
    if options.content_detail.include_full_tool_results && !turns.is_empty() {
        let full_results = build_full_result_map(events);
        for turn in &mut turns {
            for tc in &mut turn.tool_calls {
                if let Some(tc_id) = tc.tool_call_id.as_deref()
                    && let Some(full) = full_results.get(tc_id)
                {
                    tc.result_content = Some(full.clone());
                }
            }
        }
    }

    if !turns.is_empty() {
        available.push(SectionId::Conversation);
    }
    Some(turns)
}

/// Build a map from tool_call_id → full (non-truncated) result string.
fn build_full_result_map(events: &[TypedEvent]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for event in events {
        if let TypedEventData::ToolExecutionComplete(data) = &event.typed_data
            && let (Some(id), Some(result)) = (&data.tool_call_id, &data.result)
            && let Some(text) = extract_full_result(result)
        {
            map.insert(id.clone(), text);
        }
    }
    map
}

/// Extract the full result text from a tool execution result value.
/// Mirrors the core `extract_result_preview` logic but without truncation.
fn extract_full_result(result: &serde_json::Value) -> Option<String> {
    match result {
        serde_json::Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        serde_json::Value::Object(obj) => obj
            .get("content")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                obj.get("detailedContent")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
            })
            .map(|s| s.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_full_result_string_value() {
        let val = json!("Hello, world!");
        assert_eq!(extract_full_result(&val), Some("Hello, world!".into()));
    }

    #[test]
    fn extract_full_result_empty_string() {
        let val = json!("  ");
        assert_eq!(extract_full_result(&val), None);
    }

    #[test]
    fn extract_full_result_object_with_content() {
        let val = json!({"content": "full result text", "other": 42});
        assert_eq!(extract_full_result(&val), Some("full result text".into()));
    }

    #[test]
    fn extract_full_result_object_with_detailed_content_fallback() {
        let val = json!({"detailedContent": "detailed text"});
        assert_eq!(extract_full_result(&val), Some("detailed text".into()));
    }

    #[test]
    fn extract_full_result_object_prefers_content_over_detailed() {
        let val = json!({"content": "primary", "detailedContent": "fallback"});
        assert_eq!(extract_full_result(&val), Some("primary".into()));
    }

    #[test]
    fn extract_full_result_null() {
        let val = json!(null);
        assert_eq!(extract_full_result(&val), None);
    }

    #[test]
    fn extract_full_result_object_empty_content() {
        let val = json!({"content": "", "detailedContent": "fallback"});
        assert_eq!(extract_full_result(&val), Some("fallback".into()));
    }
}
