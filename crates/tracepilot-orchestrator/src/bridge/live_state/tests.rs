use super::*;
use crate::bridge::BridgeEvent;
use serde_json::json;

fn event(event_type: &str, data: serde_json::Value) -> BridgeEvent {
    BridgeEvent {
        session_id: "s1".into(),
        event_type: event_type.into(),
        timestamp: "2026-04-27T00:00:00Z".into(),
        id: Some(format!("evt-{event_type}")),
        parent_id: Some("turn-1".into()),
        ephemeral: false,
        data,
    }
}

#[test]
fn message_delta_appends_assistant_text() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event(
        "assistant.message_delta",
        json!({"messageId": "msg-1", "deltaContent": "hi"}),
    ));
    assert_eq!(state.status, SessionRuntimeStatus::Running);
    assert_eq!(state.assistant_text, "hi");
    assert_eq!(state.current_turn_id.as_deref(), Some("turn-1"));
}

#[test]
fn reasoning_delta_appends_reasoning_text() {
    let store = LiveStateStore::new();
    store.apply_event(&event(
        "assistant.reasoning_delta",
        json!({"reasoningId": "r1", "deltaContent": "thinking"}),
    ));
    let state = store.apply_event(&event(
        "assistant.reasoning_delta",
        json!({"reasoningId": "r1", "deltaContent": "..."}),
    ));
    assert_eq!(state.reasoning_text, "thinking...");
}

#[test]
fn usage_is_snapshotted() {
    let store = LiveStateStore::new();
    let usage = json!({"inputTokens": 10, "outputTokens": 2});
    let state = store.apply_event(&event("assistant.usage", usage.clone()));
    assert_eq!(state.usage, Some(usage));
}

#[test]
fn idle_and_shutdown_are_terminal_statuses() {
    let store = LiveStateStore::new();
    let idle = store.apply_event(&event("session.idle", json!({})));
    assert_eq!(idle.status, SessionRuntimeStatus::Idle);
    let shutdown = store.apply_event(&event("session.shutdown", json!({})));
    assert_eq!(shutdown.status, SessionRuntimeStatus::Shutdown);
}

#[test]
fn permission_and_external_tool_requests_are_pending() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event(
        "permission.requested",
        json!({"requestId": "p1", "summary": "allow edit"}),
    ));
    assert_eq!(state.status, SessionRuntimeStatus::WaitingForPermission);
    assert_eq!(
        state
            .pending_permission
            .as_ref()
            .and_then(|p| p.request_id.as_deref()),
        Some("p1")
    );

    let external = store.apply_event(&event(
        "external_tool.requested",
        json!({"requestId": "x1", "toolName": "shell"}),
    ));
    assert_eq!(
        external
            .pending_permission
            .as_ref()
            .and_then(|p| p.request_id.as_deref()),
        Some("x1")
    );
}

#[test]
fn user_input_request_is_pending() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event(
        "tool.user_requested",
        json!({"toolName": "ask_user", "prompt": "choose"}),
    ));
    assert_eq!(state.status, SessionRuntimeStatus::WaitingForInput);
    assert_eq!(
        state
            .pending_user_input
            .as_ref()
            .and_then(|p| p.summary.as_deref()),
        Some("choose")
    );
}

#[test]
fn tool_progress_is_compacted_by_tool_call_id() {
    let store = LiveStateStore::new();
    store.apply_event(&event(
        "tool.execution_progress",
        json!({"toolCallId": "t1", "toolName": "read_file", "progressMessage": "reading"}),
    ));
    let state = store.apply_event(&event(
        "tool.execution_partial_result",
        json!({"toolCallId": "t1", "partialOutput": "three lines"}),
    ));
    assert_eq!(state.tools.len(), 1);
    assert_eq!(state.tools[0].status, "partial");
    assert_eq!(state.tools[0].message.as_deref(), Some("reading"));
    assert_eq!(state.tools[0].partial_result, Some(json!("three lines")));
}

#[test]
fn malformed_known_payload_records_warning_without_panicking() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event(
        "assistant.message_delta",
        json!({"unexpected": true}),
    ));
    assert_eq!(state.assistant_text, "");
    assert!(
        state
            .last_error
            .as_deref()
            .unwrap_or("")
            .contains("missing text delta")
    );
    assert_eq!(state.reducer_warnings.len(), 1);
}

#[test]
fn unknown_event_only_updates_metadata() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event("custom.event", json!({"x": 1})));
    assert_eq!(state.status, SessionRuntimeStatus::Unknown);
    assert_eq!(state.last_event_type.as_deref(), Some("custom.event"));
}
