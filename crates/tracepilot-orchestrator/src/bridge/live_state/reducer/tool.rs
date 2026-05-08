use super::super::{SessionLiveState, SessionRuntimeStatus, ToolProgressSummary};
use super::shared::{number_field, string_field, truncate_string, warn};
use crate::bridge::BridgeEvent;
use serde_json::{Value, json};

const MAX_TOOLS: usize = 32;
// 64 KiB lets us stream meaningfully long shell/powershell stdout into the live
// preview without losing earlier chunks; once the SDK emits
// `tool.execution_complete` the persisted result takes over from disk.
pub(in crate::bridge::live_state) const MAX_PARTIAL_RESULT_CHARS: usize = 64 * 1024;

pub(super) fn upsert_tool(
    state: &mut SessionLiveState,
    event: &BridgeEvent,
    fallback_status: &str,
) {
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
    // Treat the final-completion `result` separately from in-flight
    // `partial_output`: completion replaces the live preview, but partials are
    // merged so we don't lose earlier streamed output if a server emits
    // incremental chunks (some do, some send cumulative snapshots).
    let partial_payload = event
        .data
        .get("partialResult")
        .or_else(|| event.data.get("partialOutput"))
        .or_else(|| event.data.get("partial_result"))
        .or_else(|| event.data.get("partial_output"));
    let final_result = event.data.get("result");
    let summary = ToolProgressSummary {
        tool_call_id: tool_call_id.clone(),
        tool_name,
        status,
        message,
        progress,
        partial_result: None, // Filled in by the merge step below.
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
        if let Some(result) = final_result {
            existing.partial_result = Some(compact_partial_result(result));
        } else if let Some(incoming) = partial_payload {
            existing.partial_result = Some(merge_partial_result(
                existing.partial_result.as_ref(),
                incoming,
            ));
        }
        existing.updated_at = summary.updated_at;
        return;
    }
    let mut summary = summary;
    if let Some(result) = final_result {
        summary.partial_result = Some(compact_partial_result(result));
    } else if let Some(incoming) = partial_payload {
        summary.partial_result = Some(merge_partial_result(None, incoming));
    }
    state.tools.push(summary);
    if state.tools.len() > MAX_TOOLS {
        let overflow = state.tools.len() - MAX_TOOLS;
        state.tools.drain(0..overflow);
    }
}

/// Merge a streamed partial-output payload into the previous one.
///
/// SDK servers vary: some emit `partial_output` as the *cumulative* snapshot,
/// others as *incremental* deltas. We don't want to lose history in the
/// incremental case (the previous behaviour, which always replaced, dropped
/// earlier stdout) or to produce duplicate suffixes in the cumulative case.
///
/// Strategy when both old and new are strings:
/// * If `new.starts_with(old)` — new is a cumulative snapshot that extends old; keep `new`.
/// * If `old.starts_with(new)` — new is a re-send of an earlier prefix; keep `old`.
/// * Otherwise — treat new as an incremental chunk and append.
///
/// For non-string payloads (objects/arrays produced by structured tools) we
/// keep the latest snapshot — those are typically replacement payloads.
pub(super) fn merge_partial_result(existing: Option<&Value>, incoming: &Value) -> Value {
    let incoming_compacted = compact_partial_result(incoming);
    let Some(existing) = existing else {
        return incoming_compacted;
    };
    // The existing payload may already be a compacted `{truncated, preview}`
    // object from a prior over-cap merge. Treat its `preview` as the
    // accumulated string so further incremental chunks keep extending it
    // instead of clobbering the preview with the new chunk alone.
    let old_str = existing.as_str().or_else(|| compacted_preview(existing));
    let (Some(old_str), Some(new_str)) = (old_str, incoming.as_str()) else {
        return incoming_compacted;
    };
    let merged = if new_str.starts_with(old_str) {
        new_str.to_string()
    } else if old_str.starts_with(new_str) {
        old_str.to_string()
    } else {
        let mut s = String::with_capacity(old_str.len() + new_str.len());
        s.push_str(old_str);
        s.push_str(new_str);
        s
    };
    compact_partial_result(&Value::String(merged))
}

pub(super) fn compact_partial_result(value: &Value) -> Value {
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

/// Extract the `preview` string from a compacted `{truncated: true, preview}`
/// object so cap-crossing incremental merges keep extending the accumulated
/// stdout rather than replacing it with only the latest chunk.
pub(super) fn compacted_preview(value: &Value) -> Option<&str> {
    let obj = value.as_object()?;
    if obj.get("truncated").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    obj.get("preview").and_then(Value::as_str)
}
