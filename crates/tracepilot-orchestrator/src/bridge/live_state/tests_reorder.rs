use super::*;
use crate::bridge::BridgeEvent;
use serde_json::{Value, json};

fn event_at(event_type: &str, timestamp: &str, data: serde_json::Value) -> BridgeEvent {
    BridgeEvent {
        session_id: "s1".into(),
        event_type: event_type.into(),
        timestamp: timestamp.into(),
        id: Some(format!("evt-{event_type}-{timestamp}")),
        parent_id: Some("turn-1".into()),
        ephemeral: false,
        data,
    }
}

/// Repro for the SDK race: pinned Copilot SDK `tokio::spawn`s a fresh task per
/// `session.event` notification, so adjacent deltas can race into
/// `event_tx.send` in non-source order. The reducer must sort by
/// `event.timestamp` before committing.
#[test]
fn out_of_order_deltas_are_reordered_by_timestamp() {
    let store = LiveStateStore::new();
    // Source order: "hell" (t1) then "ow" (t2) then " world" (t3).
    // Wire order: t1, t3, t2.
    store.apply_event(&event_at(
        "assistant.message_delta",
        "2026-04-27T00:00:00.001Z",
        json!({"deltaContent": "hell"}),
    ));
    store.apply_event(&event_at(
        "assistant.message_delta",
        "2026-04-27T00:00:00.003Z",
        json!({"deltaContent": " world"}),
    ));
    let state = store.apply_event(&event_at(
        "assistant.message_delta",
        "2026-04-27T00:00:00.002Z",
        json!({"deltaContent": "ow"}),
    ));
    assert_eq!(state.assistant_text, "hellow world");
}

/// When the reorder window can't recover (e.g. the final event arrives while
/// the pending tail is still garbled), the canonical `assistant.message`
/// content snap-replaces if it's longer than what we accumulated.
#[test]
fn assistant_message_snap_replaces_garbled_pending_tail() {
    let store = LiveStateStore::new();
    store.apply_event(&event_at(
        "assistant.message_delta",
        "2026-04-27T00:00:00.002Z",
        json!({"deltaContent": "world"}),
    ));
    store.apply_event(&event_at(
        "assistant.message_delta",
        "2026-04-27T00:00:00.001Z",
        json!({"deltaContent": "hello "}),
    ));
    let state = store.apply_event(&event_at(
        "assistant.message",
        "2026-04-27T00:00:00.010Z",
        json!({"content": "hello world (canonical)"}),
    ));
    assert_eq!(state.assistant_text, "hello world (canonical)");
}

/// Reasoning deltas use the same buffer logic.
#[test]
fn out_of_order_reasoning_deltas_are_reordered() {
    let store = LiveStateStore::new();
    store.apply_event(&event_at(
        "assistant.reasoning_delta",
        "2026-04-27T00:00:00.002Z",
        json!({"deltaContent": "B"}),
    ));
    let state = store.apply_event(&event_at(
        "assistant.reasoning_delta",
        "2026-04-27T00:00:00.001Z",
        json!({"deltaContent": "A"}),
    ));
    assert_eq!(state.reasoning_text, "AB");
}

/// Late deltas arriving AFTER `assistant.message` finalizes the stream must
/// be dropped — appending them would re-corrupt the canonical text.
#[test]
fn late_delta_after_finalize_is_ignored() {
    let store = LiveStateStore::new();
    // Establish a turn so subsequent events are accepted onto it.
    store.apply_event(&BridgeEvent {
        session_id: "s1".into(),
        event_type: "assistant.turn_start".into(),
        timestamp: "2026-04-27T00:00:00.000Z".into(),
        id: Some("turn-1".into()),
        parent_id: Some("turn-1".into()),
        ephemeral: false,
        data: json!({"turnId": "turn-1"}),
    });
    store.apply_event(&event_at(
        "assistant.message_delta",
        "2026-04-27T00:00:00.001Z",
        json!({"deltaContent": "hello "}),
    ));
    store.apply_event(&event_at(
        "assistant.message",
        "2026-04-27T00:00:00.010Z",
        json!({"content": "hello world"}),
    ));
    let state = store.apply_event(&event_at(
        "assistant.message_delta",
        "2026-04-27T00:00:00.002Z",
        json!({"deltaContent": "world"}),
    ));
    assert_eq!(state.assistant_text, "hello world");
}

/// A previous-turn delta that arrives after the next `assistant.turn_start`
/// must be rejected — its parent_id no longer matches the active turn.
#[test]
fn previous_turn_delta_is_isolated_after_rotation() {
    let store = LiveStateStore::new();
    let turn1_start = BridgeEvent {
        session_id: "s1".into(),
        event_type: "assistant.turn_start".into(),
        timestamp: "2026-04-27T00:00:00.000Z".into(),
        id: Some("turn-1".into()),
        parent_id: Some("turn-1".into()),
        ephemeral: false,
        data: json!({"turnId": "turn-1"}),
    };
    store.apply_event(&turn1_start);
    store.apply_event(&BridgeEvent {
        session_id: "s1".into(),
        event_type: "assistant.message_delta".into(),
        timestamp: "2026-04-27T00:00:00.001Z".into(),
        id: Some("d1".into()),
        parent_id: Some("turn-1".into()),
        ephemeral: false,
        data: json!({"deltaContent": "first "}),
    });
    store.apply_event(&BridgeEvent {
        session_id: "s1".into(),
        event_type: "assistant.message".into(),
        timestamp: "2026-04-27T00:00:00.010Z".into(),
        id: Some("m1".into()),
        parent_id: Some("turn-1".into()),
        ephemeral: false,
        data: json!({"content": "first turn"}),
    });
    store.apply_event(&BridgeEvent {
        session_id: "s1".into(),
        event_type: "assistant.turn_start".into(),
        timestamp: "2026-04-27T00:00:01.000Z".into(),
        id: Some("turn-2".into()),
        parent_id: Some("turn-2".into()),
        ephemeral: false,
        data: json!({"turnId": "turn-2"}),
    });
    store.apply_event(&BridgeEvent {
        session_id: "s1".into(),
        event_type: "assistant.message_delta".into(),
        timestamp: "2026-04-27T00:00:01.001Z".into(),
        id: Some("d2".into()),
        parent_id: Some("turn-2".into()),
        ephemeral: false,
        data: json!({"deltaContent": "second"}),
    });
    // Straggler from the PREVIOUS turn arriving after rotation:
    let state = store.apply_event(&BridgeEvent {
        session_id: "s1".into(),
        event_type: "assistant.message_delta".into(),
        timestamp: "2026-04-27T00:00:00.002Z".into(),
        id: Some("d1-late".into()),
        parent_id: Some("turn-1".into()),
        ephemeral: false,
        data: json!({"deltaContent": "STRAGGLER"}),
    });
    assert_eq!(state.assistant_text, "second");
    assert_eq!(state.current_turn_id.as_deref(), Some("turn-2"));
}

fn event(event_type: &str, data: Value) -> BridgeEvent {
    event_at(event_type, "2026-09-26T00:00:00.000Z", data)
}

/// Copilot CLI 1.0.8x reports shell results as `{ content, detailedContent }`;
/// the live preview keeps the text so it hands over to the persisted result
/// without switching to a JSON dump.
#[test]
fn tool_complete_object_result_keeps_text() {
    let store = LiveStateStore::new();
    store.apply_event(&event(
        "tool.execution_partial_result",
        json!({"toolCallId": "t1", "partialOutput": "tick 1\n"}),
    ));
    let state = store.apply_event(&event(
        "tool.execution_complete",
        json!({"toolCallId": "t1", "success": true,
               "result": {"content": "short", "detailedContent": "tick 1\ntick 2\n"}}),
    ));
    assert_eq!(
        state.tools[0]
            .partial_result
            .as_ref()
            .and_then(Value::as_str),
        Some("tick 1\ntick 2\n")
    );
}

/// `session.usage_info` feeds the context meter and no longer overwrites the
/// per-call `assistant.usage` payload.
#[test]
fn usage_info_updates_context_without_clobbering_call_usage() {
    let store = LiveStateStore::new();
    store.apply_event(&event("assistant.usage", json!({"inputTokens": 10})));
    let state = store.apply_event(&event(
        "session.usage_info",
        json!({"currentTokens": 18941, "tokenLimit": 200000}),
    ));
    assert_eq!(state.context_tokens, Some(18941));
    assert_eq!(state.context_limit, Some(200000));
    assert_eq!(state.usage, Some(json!({"inputTokens": 10})));

    let idle = store.apply_event(&event("assistant.idle", json!({})));
    assert_eq!(idle.status, SessionRuntimeStatus::Idle);
}
