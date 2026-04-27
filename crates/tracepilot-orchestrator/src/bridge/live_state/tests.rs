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
        "user_input.requested",
        json!({"requestId": "u1", "question": "choose", "choices": ["yes", "no"]}),
    ));
    assert_eq!(state.status, SessionRuntimeStatus::WaitingForInput);
    assert_eq!(
        state
            .pending_user_input
            .as_ref()
            .and_then(|p| p.request_id.as_deref()),
        Some("u1")
    );
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
fn missing_delta_payload_is_metadata_only() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event(
        "assistant.message_delta",
        json!({"unexpected": true}),
    ));
    assert_eq!(state.assistant_text, "");
    assert_eq!(state.last_error, None);
    assert!(state.reducer_warnings.is_empty());
}

#[test]
fn full_message_events_without_text_are_metadata_only() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event(
        "assistant.message",
        json!({"messageId": "msg-1", "role": "assistant"}),
    ));
    assert_eq!(state.status, SessionRuntimeStatus::Running);
    assert_eq!(state.assistant_text, "");
    assert!(state.reducer_warnings.is_empty());
    assert_eq!(state.last_error, None);
}

#[test]
fn nested_delta_payload_appends_assistant_text() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event(
        "assistant.message_delta",
        json!({"event": {"message": {"deltaContent": "nested hi"}}}),
    ));
    assert_eq!(state.assistant_text, "nested hi");
    assert!(state.reducer_warnings.is_empty());
}

#[test]
fn unrelated_nested_text_is_not_promoted_to_assistant_text() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event(
        "assistant.message_delta",
        json!({"tool": {"message": "not assistant text"}, "payload": {"content": "also wrong"}}),
    ));
    assert_eq!(state.assistant_text, "");
    assert!(state.reducer_warnings.is_empty());
}

#[test]
fn turn_start_resets_live_preview_and_tools() {
    let store = LiveStateStore::new();
    store.apply_event(&event(
        "assistant.message_delta",
        json!({"deltaContent": "old"}),
    ));
    store.apply_event(&event(
        "tool.execution_progress",
        json!({"toolCallId": "t1", "progressMessage": "running"}),
    ));
    let state = store.apply_event(&event("assistant.turn_start", json!({})));
    assert_eq!(state.assistant_text, "");
    assert_eq!(state.reasoning_text, "");
    assert!(state.tools.is_empty());
}

#[test]
fn live_text_preview_is_bounded() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event(
        "assistant.message_delta",
        json!({"deltaContent": "x".repeat(20 * 1024)}),
    ));
    assert!(state.assistant_text.len() <= 16 * 1024);
}

#[test]
fn tool_summaries_and_partial_results_are_bounded() {
    let store = LiveStateStore::new();
    let large = "x".repeat(3 * 1024);
    let mut state = store.apply_event(&event(
        "tool.execution_partial_result",
        json!({"toolCallId": "t0", "partialOutput": large}),
    ));
    assert_eq!(
        state.tools[0]
            .partial_result
            .as_ref()
            .and_then(|value| value.get("truncated"))
            .and_then(serde_json::Value::as_bool),
        Some(true)
    );
    for i in 1..40 {
        state = store.apply_event(&event(
            "tool.execution_progress",
            json!({"toolCallId": format!("t{i}")}),
        ));
    }
    assert!(state.tools.len() <= 32);
    assert_eq!(
        state
            .tools
            .first()
            .and_then(|tool| tool.tool_call_id.as_deref()),
        Some("t8")
    );
}

#[test]
fn unknown_event_only_updates_metadata() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event("custom.event", json!({"x": 1})));
    assert_eq!(state.status, SessionRuntimeStatus::Unknown);
    assert_eq!(state.last_event_type.as_deref(), Some("custom.event"));
}
