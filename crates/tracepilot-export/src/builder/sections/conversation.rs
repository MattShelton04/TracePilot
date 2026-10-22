use std::collections::HashMap;

use crate::document::{ConversationTurn, SectionId};
use crate::options::{ExportOptions, RedactionOptions};
use crate::redaction::{RedactionStats, collect_active_patterns, redact_json_value};
use tracepilot_core::parsing::events::{TypedEvent, TypedEventData};
use tracepilot_core::turns::{compute_args_summary, reconstruct_turns};

pub(in crate::builder) fn build_conversation(
    options: &ExportOptions,
    typed_events: Option<&[TypedEvent]>,
    reconstructed_turns: Option<Vec<ConversationTurn>>,
    available: &mut Vec<SectionId>,
) -> Option<Vec<ConversationTurn>> {
    if !options.includes(SectionId::Conversation) {
        return None;
    }
    let events = typed_events?;
    let mut turns = reconstructed_turns.unwrap_or_else(|| reconstruct_turns(events));

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

    fill_args_summaries(&mut turns, &options.redaction);

    if !turns.is_empty() {
        available.push(SectionId::Conversation);
    }
    Some(turns)
}

/// Give each tool call the one-line argument summary the app's turn view shows
/// (a command, a path, a search pattern), which renderers fall back to when a
/// call has no intention summary.
///
/// A "no tool details" export drops the summary with the arguments, in the
/// content filter. When redaction is on, it summarizes redacted arguments: a
/// summary cuts long commands short, and a cut through a secret or path could
/// leave a fragment its pattern no longer matches. Redaction still runs over
/// the summary afterwards like every other field.
fn fill_args_summaries(turns: &mut [ConversationTurn], redaction: &RedactionOptions) {
    let patterns = collect_active_patterns(redaction);
    for tc in turns.iter_mut().flat_map(|turn| turn.tool_calls.iter_mut()) {
        if tc.args_summary.is_some() {
            continue;
        }
        let Some(args) = tc.arguments.as_ref() else {
            continue;
        };
        let summary = if patterns.is_empty() {
            compute_args_summary(&tc.tool_name, args)
        } else {
            let mut redacted = args.clone();
            redact_json_value(&mut redacted, &patterns, &mut RedactionStats::default());
            compute_args_summary(&tc.tool_name, &redacted)
        };
        if !summary.is_empty() {
            tc.args_summary = Some(summary);
        }
    }
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
/// Mirrors the core `extract_result_content` logic but without truncating any tool.
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
