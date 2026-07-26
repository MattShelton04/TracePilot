use super::model::{
    ContextToolCallContribution, ContextToolTypeContribution, ToolCallDraft, TurnDelta,
};
use std::collections::HashMap;

pub(super) fn add_message_delta(delta: &mut TurnDelta, content: &str) {
    delta.message_tokens += estimate_tokens(content);
}

pub(super) fn add_tool_delta(delta: &mut TurnDelta, content: &str) {
    delta.tool_tokens += estimate_tokens(content);
}

pub(super) fn finish_tool_contributions(
    drafts: Vec<ToolCallDraft>,
) -> (
    Vec<ContextToolCallContribution>,
    Vec<ContextToolTypeContribution>,
) {
    let mut calls = drafts
        .into_iter()
        .map(|draft| ContextToolCallContribution {
            turn: draft.turn,
            tool_call_id: draft.tool_call_id,
            tool_name: draft.tool_name,
            argument_tokens: draft.argument_tokens,
            result_tokens: draft.result_tokens,
            total_tokens: draft.argument_tokens + draft.result_tokens,
            success: draft.success,
            arguments_preview: draft.arguments_preview,
            result_preview: draft.result_preview,
        })
        .collect::<Vec<_>>();
    calls.sort_by_key(|call| std::cmp::Reverse(call.total_tokens));

    let session_total = calls.iter().map(|call| call.total_tokens).sum::<u64>();
    let mut by_type = HashMap::<String, ContextToolTypeContribution>::new();
    for call in &calls {
        let entry =
            by_type
                .entry(call.tool_name.clone())
                .or_insert_with(|| ContextToolTypeContribution {
                    tool_name: call.tool_name.clone(),
                    call_count: 0,
                    error_count: 0,
                    argument_tokens: 0,
                    result_tokens: 0,
                    total_tokens: 0,
                    percentage: 0.0,
                });
        entry.call_count += 1;
        entry.error_count += usize::from(call.success == Some(false));
        entry.argument_tokens += call.argument_tokens;
        entry.result_tokens += call.result_tokens;
        entry.total_tokens += call.total_tokens;
    }
    let mut tool_types = by_type.into_values().collect::<Vec<_>>();
    for item in &mut tool_types {
        item.percentage = if session_total == 0 {
            0.0
        } else {
            item.total_tokens as f64 / session_total as f64 * 100.0
        };
    }
    tool_types.sort_by_key(|item| std::cmp::Reverse(item.total_tokens));
    calls.truncate(50);
    (calls, tool_types)
}

pub(super) fn estimate_tokens(content: &str) -> u64 {
    (content.len() as u64).div_ceil(4)
}

pub(super) fn preview(content: &str) -> Option<String> {
    preview_with_limit(content, 2_000)
}

pub(super) fn context_result_content(result: &serde_json::Value) -> String {
    match result {
        serde_json::Value::String(content) => content.to_owned(),
        serde_json::Value::Object(object) => object
            .get("content")
            .and_then(serde_json::Value::as_str)
            .filter(|content| !content.trim().is_empty())
            .or_else(|| {
                object
                    .get("detailedContent")
                    .and_then(serde_json::Value::as_str)
                    .filter(|content| !content.trim().is_empty())
            })
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| serde_json::to_string(result).unwrap_or_default()),
        _ => serde_json::to_string(result).unwrap_or_default(),
    }
}

fn preview_with_limit(content: &str, limit: usize) -> Option<String> {
    if content.is_empty() {
        return None;
    }
    let mut value = content.chars().take(limit).collect::<String>();
    if content.chars().count() > limit {
        value.push_str("\n…[truncated]");
    }
    Some(value)
}
