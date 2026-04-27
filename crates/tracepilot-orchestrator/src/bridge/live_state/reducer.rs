use super::{PendingRequestSummary, SessionLiveState, SessionRuntimeStatus, ToolProgressSummary};
use crate::bridge::BridgeEvent;
use serde_json::Value;

pub fn apply_event(state: &mut SessionLiveState, event: &BridgeEvent) {
    state.last_event_id = event.id.clone();
    state.last_event_type = Some(event.event_type.clone());
    state.last_event_timestamp = Some(event.timestamp.clone());
    if let Some(turn_id) = turn_id(event) {
        state.current_turn_id = Some(turn_id);
    }

    match event.event_type.as_str() {
        "assistant.turn_start" | "user.message" => state.status = SessionRuntimeStatus::Running,
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
    match string_field(
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
            TextKind::Assistant => state.assistant_text.push_str(&delta),
            TextKind::Reasoning => state.reasoning_text.push_str(&delta),
        },
        None if event.event_type.ends_with("_delta") => warn(state, event, "missing text delta"),
        None => {}
    }
}

fn record_error(state: &mut SessionLiveState, event: &BridgeEvent) {
    state.status = SessionRuntimeStatus::Error;
    state.last_error = string_field(&event.data, &["message", "error", "details"])
        .or_else(|| Some(event.data.to_string()));
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
        .cloned();
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
            &["summary", "message", "prompt", "toolName", "name"],
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

fn number_field(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_f64))
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
    const MAX_REDUCER_WARNINGS: usize = 8;
    if state.reducer_warnings.len() > MAX_REDUCER_WARNINGS {
        let overflow = state.reducer_warnings.len() - MAX_REDUCER_WARNINGS;
        state.reducer_warnings.drain(0..overflow);
    }
}
