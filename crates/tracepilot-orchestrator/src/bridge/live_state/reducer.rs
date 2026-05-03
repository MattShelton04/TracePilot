use super::{
    PendingDelta, PendingRequestSummary, SessionLiveState, SessionRuntimeStatus,
    ToolProgressSummary,
};
use crate::bridge::BridgeEvent;
use serde_json::{Value, json};

const MAX_TEXT_PREVIEW_CHARS: usize = 16 * 1024;
const MAX_TOOLS: usize = 32;
// 64 KiB lets us stream meaningfully long shell/powershell stdout into the live
// preview without losing earlier chunks; once the SDK emits
// `tool.execution_complete` the persisted result takes over from disk.
pub(super) const MAX_PARTIAL_RESULT_CHARS: usize = 64 * 1024;
const MAX_REDUCER_WARNINGS: usize = 8;
// Reorder window for delta events. Pinned Copilot SDK `tokio::spawn`s a fresh
// task per notification so adjacent deltas can race into `event_tx.send` in
// non-source order. Mirror the frontend `DELTA_REORDER_WINDOW`.
const DELTA_REORDER_WINDOW: usize = 4;

pub fn apply_event(state: &mut SessionLiveState, event: &BridgeEvent) {
    state.last_event_id = event.id.clone();
    state.last_event_type = Some(event.event_type.clone());
    state.last_event_timestamp = Some(event.timestamp.clone());
    // NOTE: `current_turn_id` is updated ONLY by `assistant.turn_start` (in
    // `start_turn`). Updating it from every event would let a late delta from
    // a previous turn flip the active-turn pointer back, contaminating the
    // new turn's text. See `tests_reorder::previous_turn_delta_is_isolated`.

    match event.event_type.as_str() {
        "assistant.turn_start" => start_turn(state, event),
        "user.message" => state.status = SessionRuntimeStatus::Running,
        "assistant.message_delta" => append_delta(state, event, TextKind::Assistant),
        "assistant.reasoning_delta" => append_delta(state, event, TextKind::Reasoning),
        "assistant.message" => apply_full_text(state, event, TextKind::Assistant),
        "assistant.reasoning" => apply_full_text(state, event, TextKind::Reasoning),
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

/// Apply an `assistant.message_delta` / `assistant.reasoning_delta` event by
/// inserting its delta payload into a small reorder buffer keyed by
/// `event.timestamp`, then committing entries that drop out of the window.
/// The visible `*_text` is recomputed as `committed + pending sorted joined`.
fn append_delta(state: &mut SessionLiveState, event: &BridgeEvent, kind: TextKind) {
    state.status = SessionRuntimeStatus::Running;
    if !belongs_to_active_turn(state, event) {
        return;
    }
    let finalized = match kind {
        TextKind::Assistant => state.assistant_finalized,
        TextKind::Reasoning => state.reasoning_finalized,
    };
    if finalized {
        // Final event already drained + snap-replaced this stream. A late
        // delta would re-corrupt the canonical text — drop it.
        return;
    }
    let Some(delta) = event_text_field(
        &event.data,
        &[
            "deltaContent",
            "delta_content",
            "chunkContent",
            "chunk_content",
            "delta",
        ],
    ) else {
        return;
    };
    let incoming = PendingDelta {
        delta,
        timestamp: event.timestamp.clone(),
    };
    let (committed, pending, visible) = match kind {
        TextKind::Assistant => (
            &mut state.assistant_committed,
            &mut state.assistant_pending,
            &mut state.assistant_text,
        ),
        TextKind::Reasoning => (
            &mut state.reasoning_committed,
            &mut state.reasoning_pending,
            &mut state.reasoning_text,
        ),
    };
    insert_pending_sorted(pending, incoming);
    while pending.len() > DELTA_REORDER_WINDOW {
        let drained = pending.remove(0);
        append_capped(committed, &drained.delta);
    }
    rebuild_visible(committed, pending, visible);
}

fn insert_pending_sorted(pending: &mut Vec<PendingDelta>, incoming: PendingDelta) {
    // Stable insertion in ascending timestamp order.
    let pos = pending
        .iter()
        .position(|p| incoming.timestamp < p.timestamp)
        .unwrap_or(pending.len());
    pending.insert(pos, incoming);
}

fn rebuild_visible(committed: &str, pending: &[PendingDelta], visible: &mut String) {
    visible.clear();
    visible.push_str(committed);
    for p in pending {
        visible.push_str(&p.delta);
    }
    drain_to_tail(visible, MAX_TEXT_PREVIEW_CHARS);
}

/// Apply a final `assistant.message` / `assistant.reasoning` event. Drains the
/// reorder buffer into `committed`, then snap-replaces if the canonical
/// `content` is longer than what we accumulated (covers tail garble).
fn apply_full_text(state: &mut SessionLiveState, event: &BridgeEvent, kind: TextKind) {
    state.status = SessionRuntimeStatus::Running;
    if !belongs_to_active_turn(state, event) {
        return;
    }
    let Some(content) = event_text_field(
        &event.data,
        &[
            "content",
            "chunkContent",
            "chunk_content",
            "text",
            "message",
            "value",
        ],
    ) else {
        return;
    };
    let (committed, pending, visible) = match kind {
        TextKind::Assistant => (
            &mut state.assistant_committed,
            &mut state.assistant_pending,
            &mut state.assistant_text,
        ),
        TextKind::Reasoning => (
            &mut state.reasoning_committed,
            &mut state.reasoning_pending,
            &mut state.reasoning_text,
        ),
    };
    // Drain pending into committed.
    for p in pending.drain(..) {
        append_capped(committed, &p.delta);
    }
    // Snap-replace if the final content is longer (in chars).
    if content.chars().count() > committed.chars().count() {
        committed.clear();
        append_capped(committed, &content);
    }
    rebuild_visible(committed, pending, visible);
    // Mark this stream finalized so any straggler delta arriving after the
    // canonical text is dropped instead of re-corrupting it.
    match kind {
        TextKind::Assistant => state.assistant_finalized = true,
        TextKind::Reasoning => state.reasoning_finalized = true,
    }
}

/// Returns true if `event` belongs to the currently active turn (or no active
/// turn has been observed yet, in which case we accept everything to remain
/// permissive on connection-attach / reattach paths).
fn belongs_to_active_turn(state: &SessionLiveState, event: &BridgeEvent) -> bool {
    let Some(active) = state.current_turn_id.as_deref() else {
        return true;
    };
    let event_turn = turn_id(event);
    match event_turn.as_deref() {
        Some(t) => t == active,
        // Event has no parent/turn id of its own — accept it on the active
        // turn (deltas/finals without parentId can't be cross-turn anyway).
        None => true,
    }
}

fn start_turn(state: &mut SessionLiveState, event: &BridgeEvent) {
    state.status = SessionRuntimeStatus::Running;
    state.current_turn_id = turn_id(event);
    state.assistant_text.clear();
    state.reasoning_text.clear();
    state.assistant_committed.clear();
    state.reasoning_committed.clear();
    state.assistant_pending.clear();
    state.reasoning_pending.clear();
    state.assistant_finalized = false;
    state.reasoning_finalized = false;
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
fn merge_partial_result(existing: Option<&Value>, incoming: &Value) -> Value {
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
    drain_to_tail(target, MAX_TEXT_PREVIEW_CHARS);
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

/// Extract the `preview` string from a compacted `{truncated: true, preview}`
/// object so cap-crossing incremental merges keep extending the accumulated
/// stdout rather than replacing it with only the latest chunk.
fn compacted_preview(value: &Value) -> Option<&str> {
    let obj = value.as_object()?;
    if obj.get("truncated").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    obj.get("preview").and_then(Value::as_str)
}

/// Keep only the trailing `max_len` characters of `value`. For streaming
/// stdout/tool output the tail is what the user is actively watching, so we
/// drop the *oldest* bytes when over the cap rather than the latest ones.
fn truncate_string(value: &str, max_len: usize) -> String {
    if value.len() <= max_len {
        return value.to_string();
    }
    let start = find_tail_start(value, max_len);
    format!("…{}", &value[start..])
}

/// Truncate a string in-place to keep only the trailing `max_len` bytes,
/// respecting UTF-8 character boundaries.
fn drain_to_tail(s: &mut String, max_len: usize) {
    if s.len() <= max_len {
        return;
    }
    let start = find_tail_start(s, max_len);
    s.drain(..start);
}

/// Find the byte index to start from to keep the trailing `max_len` bytes
/// while respecting UTF-8 character boundaries.
fn find_tail_start(s: &str, max_len: usize) -> usize {
    let mut start = s.len().saturating_sub(max_len);
    while start < s.len() && !s.is_char_boundary(start) {
        start += 1;
    }
    start
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
