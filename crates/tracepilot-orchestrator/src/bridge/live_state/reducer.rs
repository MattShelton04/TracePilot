use super::{PendingRequestSummary, SessionLiveState, SessionRuntimeStatus, ToolProgressSummary};
use crate::bridge::BridgeEvent;
use serde_json::{Value, json};

const MAX_TEXT_PREVIEW_CHARS: usize = 16 * 1024;
const MAX_TOOLS: usize = 32;
const MAX_PARTIAL_RESULT_CHARS: usize = 2048;
const MAX_REDUCER_WARNINGS: usize = 8;

pub fn apply_event(state: &mut SessionLiveState, event: &BridgeEvent) {
    state.last_event_id = event.id.clone();
    state.last_event_type = Some(event.event_type.clone());
    state.last_event_timestamp = Some(event.timestamp.clone());
    if let Some(turn_id) = turn_id(event) {
        state.current_turn_id = Some(turn_id);
    }

    match event.event_type.as_str() {
        "assistant.turn_start" => start_turn(state),
        "user.message" => state.status = SessionRuntimeStatus::Running,
        "assistant.message" | "assistant.message_delta" => {
            append_text(state, event, TextKind::Assistant)
        }
        "assistant.reasoning" | "assistant.reasoning_delta" => {
            append_text(state, event, TextKind::Reasoning)
        }
        "assistant.usage" | "session.usage_info" => state.usage = Some(event.data.clone()),
        "session.idle" | "assistant.turn_end" => state.status = SessionRuntimeStatus::Idle,
        "session.shutdown" => state.status = SessionRuntimeStatus::Shutdown,
        "session.error" => record_error(state, event),
        "permission.requested" | "external_tool.requested" => {
            state.status = SessionRuntimeStatus::WaitingForPermission;
            state.pending_permission = Some(request_summary(event, "permission"));
        }
        "permission.resolved" | "external_tool.resolved" => {
            state.pending_permission = None;
            state.status = SessionRuntimeStatus::Running;
        }
        "tool.execution_start" => upsert_tool(state, event, "running"),
        "tool.execution_progress" => upsert_tool(state, event, "running"),
        "tool.execution_partial_result" => upsert_tool(state, event, "partial"),
        "tool.execution_complete" => upsert_tool(state, event, "complete"),
        other if is_user_input_request(other, &event.data) => {
            state.status = SessionRuntimeStatus::WaitingForInput;
            state.pending_user_input = Some(request_summary(event, "user_input"));
        }
        other if is_user_input_resolved(other) => {
            state.pending_user_input = None;
            state.status = SessionRuntimeStatus::Running;
        }
        _ => {}
    }
}

enum TextKind {
    Assistant,
    Reasoning,
}

fn append_text(state: &mut SessionLiveState, event: &BridgeEvent, kind: TextKind) {
    state.status = SessionRuntimeStatus::Running;
    match event_text_field(
        &event.data,
        &[
            "deltaContent",
            "delta_content",
            "chunkContent",
            "chunk_content",
            "delta",
            "text",
            "content",
            "message",
            "value",
        ],
    ) {
        Some(delta) => match kind {
            TextKind::Assistant => append_capped(&mut state.assistant_text, &delta),
            TextKind::Reasoning => append_capped(&mut state.reasoning_text, &delta),
        },
        None => {}
    }
}

fn start_turn(state: &mut SessionLiveState) {
    state.status = SessionRuntimeStatus::Running;
    state.assistant_text.clear();
    state.reasoning_text.clear();
    state.tools.clear();
    state.usage = None;
    state.pending_permission = None;
    state.pending_user_input = None;
    state.last_error = None;
    state.reducer_warnings.clear();
}

fn record_error(state: &mut SessionLiveState, event: &BridgeEvent) {
    state.status = SessionRuntimeStatus::Error;
    state.last_error = Some(
        string_field(&event.data, &["message", "error", "details"])
            .unwrap_or_else(|| event.data.to_string()),
    );
}

fn upsert_tool(state: &mut SessionLiveState, event: &BridgeEvent, fallback_status: &str) {
    state.status = SessionRuntimeStatus::Running;
    if !event.data.is_object() {
        warn(state, event, "tool event payload is not an object");
    }
    let tool_call_id = string_field(&event.data, &["toolCallId", "tool_call_id", "id"]);
    let tool_name = string_field(&event.data, &["toolName", "tool_name", "name"]);
    let status = string_field(&event.data, &["status"]).unwrap_or_else(|| fallback_status.into());
    let message = string_field(
        &event.data,
        &[
            "message",
            "progressMessage",
            "progress_message",
            "progress",
            "summary",
        ],
    );
    let progress = number_field(&event.data, &["percent", "progress", "percentage"]);
    let partial_result = event
        .data
        .get("partialResult")
        .or_else(|| event.data.get("partialOutput"))
        .or_else(|| event.data.get("partial_result"))
        .or_else(|| event.data.get("partial_output"))
        .or_else(|| event.data.get("result"))
        .map(compact_partial_result);
    let summary = ToolProgressSummary {
        tool_call_id: tool_call_id.clone(),
        tool_name,
        status,
        message,
        progress,
        partial_result,
        updated_at: event.timestamp.clone(),
    };
    if let Some(id) = tool_call_id
        && let Some(existing) = state
            .tools
            .iter_mut()
            .find(|t| t.tool_call_id.as_deref() == Some(&id))
    {
        existing.tool_name = summary.tool_name.or_else(|| existing.tool_name.clone());
        existing.status = summary.status;
        existing.message = summary.message.or_else(|| existing.message.clone());
        existing.progress = summary.progress.or(existing.progress);
        existing.partial_result = summary
            .partial_result
            .or_else(|| existing.partial_result.clone());
        existing.updated_at = summary.updated_at;
        return;
    }
    state.tools.push(summary);
    if state.tools.len() > MAX_TOOLS {
        let overflow = state.tools.len() - MAX_TOOLS;
        state.tools.drain(0..overflow);
    }
}

fn request_summary(event: &BridgeEvent, kind: &str) -> PendingRequestSummary {
    PendingRequestSummary {
        request_id: string_field(
            &event.data,
            &["requestId", "request_id", "id", "toolCallId"],
        ),
        kind: kind.to_string(),
        summary: string_field(
            &event.data,
            &[
                "summary", "question", "message", "prompt", "toolName", "name",
            ],
        ),
        payload: event.data.clone(),
        requested_at: event.timestamp.clone(),
    }
}

fn is_user_input_request(event_type: &str, data: &Value) -> bool {
    event_type.contains("ask_user")
        || event_type == "user_input.requested"
        || (event_type == "tool.user_requested"
            && string_field(data, &["toolName", "tool_name", "name"]).as_deref()
                == Some("ask_user"))
}

fn is_user_input_resolved(event_type: &str) -> bool {
    event_type == "user_input.resolved" || event_type == "ask_user.resolved"
}

fn turn_id(event: &BridgeEvent) -> Option<String> {
    string_field(&event.data, &["turnId", "turn_id"])
        .or_else(|| event.parent_id.clone())
        .or_else(|| {
            (event.event_type == "assistant.turn_start")
                .then(|| event.id.clone())
                .flatten()
        })
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(s) = value.get(*key).and_then(Value::as_str) {
            return Some(s.to_string());
        }
    }
    value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn event_text_field(value: &Value, keys: &[&str]) -> Option<String> {
    string_field(value, keys)
        .or_else(|| string_at_any_key_path(value, &["message"], keys))
        .or_else(|| string_at_any_key_path(value, &["event", "message"], keys))
        .or_else(|| string_at_any_key_path(value, &["event", "delta"], keys))
        .or_else(|| string_at_any_key_path(value, &["data", "message"], keys))
        .or_else(|| string_at_any_key_path(value, &["data", "delta"], keys))
}

fn string_at_any_key_path(value: &Value, path: &[&str], keys: &[&str]) -> Option<String> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    keys.iter()
        .find_map(|key| current.get(*key).and_then(Value::as_str))
        .map(str::to_string)
}

fn number_field(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_f64))
}

fn append_capped(target: &mut String, delta: &str) {
    target.push_str(delta);
    if target.len() <= MAX_TEXT_PREVIEW_CHARS {
        return;
    }
    let mut start = target.len().saturating_sub(MAX_TEXT_PREVIEW_CHARS);
    while start < target.len() && !target.is_char_boundary(start) {
        start += 1;
    }
    target.drain(..start);
}

fn compact_partial_result(value: &Value) -> Value {
    match value {
        Value::String(s) if s.len() > MAX_PARTIAL_RESULT_CHARS => {
            json!({ "truncated": true, "preview": truncate_string(s, MAX_PARTIAL_RESULT_CHARS) })
        }
        Value::String(_) | Value::Null | Value::Bool(_) | Value::Number(_) => value.clone(),
        Value::Array(_) | Value::Object(_) => match serde_json::to_string(value) {
            Ok(serialized) if serialized.len() > MAX_PARTIAL_RESULT_CHARS => {
                json!({ "truncated": true, "preview": truncate_string(&serialized, MAX_PARTIAL_RESULT_CHARS) })
            }
            _ => value.clone(),
        },
    }
}

fn truncate_string(value: &str, max_len: usize) -> String {
    if value.len() <= max_len {
        return value.to_string();
    }
    let end = value
        .char_indices()
        .map(|(idx, _)| idx)
        .take_while(|idx| *idx <= max_len)
        .last()
        .unwrap_or(0);
    format!("{}…", &value[..end])
}

fn warn(state: &mut SessionLiveState, event: &BridgeEvent, warning: &str) {
    let msg = format!("{}: {}", event.event_type, warning);
    if !state
        .reducer_warnings
        .iter()
        .any(|existing| existing == &msg)
    {
        state.reducer_warnings.push(msg);
    }
    if state.reducer_warnings.len() > MAX_REDUCER_WARNINGS {
        let overflow = state.reducer_warnings.len() - MAX_REDUCER_WARNINGS;
        state.reducer_warnings.drain(0..overflow);
    }
}
