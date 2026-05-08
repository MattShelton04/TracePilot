use super::super::{SessionLiveState, SessionRuntimeStatus};
use super::permission::{
    handle_permission_requested, handle_permission_resolved, handle_user_input_requested,
    handle_user_input_resolved, is_user_input_request, is_user_input_resolved,
};
use super::text::{TextKind, append_delta, apply_full_text, record_error, start_turn};
use super::tool::upsert_tool;
use crate::bridge::BridgeEvent;

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
            handle_permission_requested(state, event);
        }
        "permission.resolved" | "external_tool.resolved" => {
            handle_permission_resolved(state);
        }
        "tool.execution_start" => upsert_tool(state, event, "running"),
        "tool.execution_progress" => upsert_tool(state, event, "running"),
        "tool.execution_partial_result" => upsert_tool(state, event, "partial"),
        "tool.execution_complete" => upsert_tool(state, event, "complete"),
        other if is_user_input_request(other, &event.data) => {
            handle_user_input_requested(state, event);
        }
        other if is_user_input_resolved(other) => {
            handle_user_input_resolved(state);
        }
        _ => {}
    }
}
