use super::super::{PendingRequestSummary, SessionLiveState, SessionRuntimeStatus};
use super::shared::string_field;
use crate::bridge::BridgeEvent;
use serde_json::Value;

pub(super) fn request_summary(event: &BridgeEvent, kind: &str) -> PendingRequestSummary {
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

pub(super) fn is_user_input_request(event_type: &str, data: &Value) -> bool {
    event_type.contains("ask_user")
        || event_type == "user_input.requested"
        || (event_type == "tool.user_requested"
            && string_field(data, &["toolName", "tool_name", "name"]).as_deref()
                == Some("ask_user"))
}

pub(super) fn is_user_input_resolved(event_type: &str) -> bool {
    event_type == "user_input.resolved" || event_type == "ask_user.resolved"
}

pub(super) fn handle_permission_requested(state: &mut SessionLiveState, event: &BridgeEvent) {
    state.status = SessionRuntimeStatus::WaitingForPermission;
    state.pending_permission = Some(request_summary(event, "permission"));
}

pub(super) fn handle_permission_resolved(state: &mut SessionLiveState) {
    state.pending_permission = None;
    state.status = SessionRuntimeStatus::Running;
}

pub(super) fn handle_user_input_requested(state: &mut SessionLiveState, event: &BridgeEvent) {
    state.status = SessionRuntimeStatus::WaitingForInput;
    state.pending_user_input = Some(request_summary(event, "user_input"));
}

pub(super) fn handle_user_input_resolved(state: &mut SessionLiveState) {
    state.pending_user_input = None;
    state.status = SessionRuntimeStatus::Running;
}
