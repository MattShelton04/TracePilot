use super::*;
use crate::bridge::BridgeEvent;
use crate::bridge::live_state::reducer::MAX_PARTIAL_RESULT_CHARS;
use serde_json::{Value, json};

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
    // Exceed the 64 KiB partial-result cap with a single jumbo payload.
    let large = "x".repeat(80 * 1024);
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

#[test]
fn turn_start_clears_reducer_warnings() {
    let store = LiveStateStore::new();
    // Trigger a warning by sending a malformed tool event
    let mut state = store.apply_event(&event("tool.execution_start", json!("not an object")));
    assert!(
        !state.reducer_warnings.is_empty(),
        "Expected warning to be recorded"
    );

    // Start a new turn
    state = store.apply_event(&event("assistant.turn_start", json!({"turnId": "turn-2"})));
    assert!(
        state.reducer_warnings.is_empty(),
        "Expected warnings to be cleared on turn_start"
    );
}

// ─── Regression: deltas + final assistant.message must NOT duplicate text ───
//
// Pinned Copilot SDK emits `assistant.message_delta` with `deltaContent`
// followed by a final `assistant.message` event carrying the FULL `content`.
// Earlier reducer logic appended both, producing duplicated streamed text in
// the live preview.
#[test]
fn assistant_message_final_after_deltas_does_not_duplicate_text() {
    let store = LiveStateStore::new();
    store.apply_event(&event(
        "assistant.message_delta",
        json!({"messageId": "m1", "deltaContent": "Hello "}),
    ));
    store.apply_event(&event(
        "assistant.message_delta",
        json!({"messageId": "m1", "deltaContent": "world"}),
    ));
    let state = store.apply_event(&event(
        "assistant.message",
        json!({"messageId": "m1", "content": "Hello world"}),
    ));
    assert_eq!(state.assistant_text, "Hello world");
}

#[test]
fn assistant_reasoning_final_after_deltas_does_not_duplicate_text() {
    let store = LiveStateStore::new();
    store.apply_event(&event(
        "assistant.reasoning_delta",
        json!({"reasoningId": "r1", "deltaContent": "thinking "}),
    ));
    store.apply_event(&event(
        "assistant.reasoning_delta",
        json!({"reasoningId": "r1", "deltaContent": "hard"}),
    ));
    let state = store.apply_event(&event(
        "assistant.reasoning",
        json!({"reasoningId": "r1", "content": "thinking hard"}),
    ));
    assert_eq!(state.reasoning_text, "thinking hard");
}

/// When deltas were suppressed (e.g. server emitted only the final message)
/// the final `content` must populate the live preview so the user sees it.
#[test]
fn assistant_message_without_deltas_populates_text() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event(
        "assistant.message",
        json!({"messageId": "m1", "content": "Standalone full message"}),
    ));
    assert_eq!(state.assistant_text, "Standalone full message");
}

/// `assistant.message_delta` must NOT pick up the `content` field. (Some
/// callers historically logged the full content under `content` on deltas;
/// treating that as a delta produced runaway duplication.)
#[test]
fn assistant_message_delta_ignores_content_field() {
    let store = LiveStateStore::new();
    let state = store.apply_event(&event(
        "assistant.message_delta",
        // No deltaContent — just a stale `content` field. We must ignore it.
        json!({"messageId": "m1", "content": "irrelevant"}),
    ));
    assert_eq!(state.assistant_text, "");
}

// ─── Tool partial-output streaming regression ───────────────────────────────

/// Cumulative partial_output snapshots (each event extends the previous):
/// the live tool entry should carry the latest snapshot, never duplicated.
#[test]
fn tool_partial_result_handles_cumulative_snapshots() {
    let store = LiveStateStore::new();
    store.apply_event(&event(
        "tool.execution_partial_result",
        json!({"toolCallId": "t1", "partialOutput": "line 1\n"}),
    ));
    let state = store.apply_event(&event(
        "tool.execution_partial_result",
        json!({"toolCallId": "t1", "partialOutput": "line 1\nline 2\n"}),
    ));
    assert_eq!(
        state.tools[0]
            .partial_result
            .as_ref()
            .and_then(Value::as_str),
        Some("line 1\nline 2\n")
    );
}

/// Incremental partial_output chunks (each event is a delta): they must be
/// concatenated, not lost like the old `replace`-based code did.
#[test]
fn tool_partial_result_accumulates_incremental_chunks() {
    let store = LiveStateStore::new();
    store.apply_event(&event(
        "tool.execution_partial_result",
        json!({"toolCallId": "t1", "partialOutput": "line 1\n"}),
    ));
    let state = store.apply_event(&event(
        "tool.execution_partial_result",
        // not a prefix of "line 1\n" — treated as an incremental delta
        json!({"toolCallId": "t1", "partialOutput": "line 2\n"}),
    ));
    assert_eq!(
        state.tools[0]
            .partial_result
            .as_ref()
            .and_then(Value::as_str),
        Some("line 1\nline 2\n")
    );
}

/// Final `result` from `tool.execution_complete` should replace the streamed
/// partial output (the persisted tool result will take over from disk).
#[test]
fn tool_complete_result_replaces_partial_preview() {
    let store = LiveStateStore::new();
    store.apply_event(&event(
        "tool.execution_partial_result",
        json!({"toolCallId": "t1", "partialOutput": "streaming…"}),
    ));
    let state = store.apply_event(&event(
        "tool.execution_complete",
        json!({"toolCallId": "t1", "success": true, "result": "final output"}),
    ));
    assert_eq!(
        state.tools[0]
            .partial_result
            .as_ref()
            .and_then(Value::as_str),
        Some("final output")
    );
    assert_eq!(state.tools[0].status, "complete");
}

/// Regression: when accumulated incremental partial output crosses the
/// `MAX_PARTIAL_RESULT_CHARS` cap, the reducer compacts it to
/// `{truncated: true, preview: ...}`. The next incremental string chunk must
/// continue extending that preview rather than replacing it with only the
/// new chunk (which would lose the entire stdout history).
#[test]
fn tool_partial_result_extends_preview_after_cap() {
    let store = LiveStateStore::new();
    let big = "a".repeat(MAX_PARTIAL_RESULT_CHARS - 100);
    store.apply_event(&event(
        "tool.execution_partial_result",
        json!({"toolCallId": "t1", "partialOutput": big}),
    ));
    // Push past the cap; the stored value is now a compacted preview object.
    let state_mid = store.apply_event(&event(
        "tool.execution_partial_result",
        json!({"toolCallId": "t1", "partialOutput": "X".repeat(500)}),
    ));
    let preview_mid = state_mid.tools[0]
        .partial_result
        .as_ref()
        .and_then(|v| v.as_object())
        .and_then(|o| o.get("preview"))
        .and_then(Value::as_str)
        .unwrap()
        .to_string();
    assert!(preview_mid.contains("XXXXX"));

    // Next incremental chunk must keep extending the accumulated preview's
    // tail — i.e., the reducer must not clobber it with just "Z...".
    let state = store.apply_event(&event(
        "tool.execution_partial_result",
        json!({"toolCallId": "t1", "partialOutput": "Z".repeat(50)}),
    ));
    let preview = state.tools[0]
        .partial_result
        .as_ref()
        .and_then(|v| v.as_object())
        .and_then(|o| o.get("preview"))
        .and_then(Value::as_str)
        .unwrap();
    assert!(
        preview.contains("XXXXX"),
        "preview should still contain prior X chunk after cap-crossing merge: {preview:?}"
    );
    assert!(preview.ends_with(&"Z".repeat(50)));
}
