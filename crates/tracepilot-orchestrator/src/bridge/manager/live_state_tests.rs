use super::*;
use crate::bridge::{BridgeEvent, SessionRuntimeStatus};
use serde_json::json;

fn bridge_event(session_id: &str, event_type: &str, data: serde_json::Value) -> BridgeEvent {
    BridgeEvent {
        session_id: session_id.to_string(),
        event_type: event_type.to_string(),
        timestamp: "2026-04-27T00:00:00Z".to_string(),
        id: Some(format!("evt-{session_id}")),
        parent_id: Some("turn-1".to_string()),
        ephemeral: false,
        data,
    }
}

#[test]
fn hydrate_includes_live_session_states() {
    let (mgr, _rx, _status_rx) = BridgeManager::new();
    mgr.reduce_and_emit_session_state(&bridge_event(
        "live-1",
        "assistant.message_delta",
        json!({"messageId": "msg-1", "deltaContent": "hello"}),
    ));

    let snapshot = mgr.hydrate();

    assert_eq!(snapshot.session_states.len(), 1);
    assert_eq!(snapshot.session_states[0].assistant_text, "hello");
}

#[test]
fn live_state_reducer_keeps_multiple_sessions_isolated() {
    let (mgr, _rx, _status_rx) = BridgeManager::new();

    mgr.reduce_and_emit_session_state(&bridge_event(
        "live-a",
        "assistant.message_delta",
        json!({"messageId": "msg-a", "deltaContent": "alpha"}),
    ));
    mgr.reduce_and_emit_session_state(&bridge_event(
        "live-b",
        "assistant.message_delta",
        json!({"messageId": "msg-b", "deltaContent": "bravo"}),
    ));
    mgr.reduce_and_emit_session_state(&bridge_event("live-a", "session.idle", json!({})));

    let state_a = mgr.get_session_state("live-a").unwrap();
    let state_b = mgr.get_session_state("live-b").unwrap();

    assert_eq!(state_a.status, SessionRuntimeStatus::Idle);
    assert_eq!(state_a.assistant_text, "alpha");
    assert_eq!(state_b.status, SessionRuntimeStatus::Running);
    assert_eq!(state_b.assistant_text, "bravo");
    assert_eq!(mgr.list_session_states().len(), 2);
}

#[test]
fn bridge_event_reducer_emits_state_and_keeps_raw_forwarding_available() {
    let (mgr, mut raw_rx, _status_rx) = BridgeManager::new();
    let mut state_rx = mgr.subscribe_session_state();
    let event = bridge_event("live-raw", "session.idle", json!({}));

    mgr.reduce_and_emit_session_state(&event);
    mgr.event_tx.send(event.clone()).unwrap();

    let state = state_rx.try_recv().unwrap();
    assert_eq!(state.status, SessionRuntimeStatus::Idle);
    assert_eq!(raw_rx.try_recv().unwrap().event_type, event.event_type);
    assert_eq!(
        mgr.get_session_state("live-raw")
            .unwrap()
            .last_event_id
            .as_deref(),
        Some("evt-live-raw")
    );
}
