use super::*;
use crate::bridge::{BridgeMessagePayload, BridgeSessionConfig, ConnectionMode};
use std::sync::Arc;
use std::sync::Mutex;

fn stub_session(id: &str) -> Arc<copilot_sdk::Session> {
    Arc::new(copilot_sdk::Session::new(
        id.to_string(),
        None,
        |_method, _params| Box::pin(async { Ok(serde_json::Value::Null) }),
    ))
}

fn recording_session(
    id: &str,
    calls: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
) -> Arc<copilot_sdk::Session> {
    Arc::new(copilot_sdk::Session::new(
        id.to_string(),
        None,
        move |method, params| {
            let calls = Arc::clone(&calls);
            let method = method.to_string();
            Box::pin(async move {
                calls
                    .lock()
                    .unwrap()
                    .push((method, params.unwrap_or(serde_json::Value::Null)));
                Ok(serde_json::json!({ "messageId": "message-1" }))
            })
        },
    ))
}

#[tokio::test]
async fn track_created_session_records_runtime_handle_only() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    mgr.connection_mode = Some(ConnectionMode::Stdio);

    let info = mgr.track_created_session(
        stub_session("launcher-session"),
        BridgeSessionConfig {
            model: Some("gpt-5.4".to_string()),
            working_directory: Some("C:\\repo".to_string()),
            system_message: None,
            reasoning_effort: Some("medium".to_string()),
            agent: Some("reviewer".to_string()),
        },
    );

    assert_eq!(info.session_id, "launcher-session");
    assert_eq!(mgr.sessions.len(), 1);
    assert_eq!(info.working_directory.as_deref(), Some("C:\\repo"));
    assert_eq!(info.model.as_deref(), Some("gpt-5.4"));
}

#[tokio::test]
async fn send_message_uses_session_specific_payload_with_empty_attachments() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    mgr.sessions.insert(
        "launcher-session".to_string(),
        recording_session("launcher-session", Arc::clone(&calls)),
    );

    let message_id = mgr
        .send_message(
            "launcher-session",
            BridgeMessagePayload {
                prompt: "Run the launch prompt".to_string(),
                mode: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(message_id, "message-1");
    let recorded = calls.lock().unwrap();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].0, "session.send");
    assert_eq!(recorded[0].1["sessionId"], "launcher-session");
    assert_eq!(recorded[0].1["prompt"], "Run the launch prompt");
    assert_eq!(recorded[0].1["attachments"], serde_json::json!([]));
}
