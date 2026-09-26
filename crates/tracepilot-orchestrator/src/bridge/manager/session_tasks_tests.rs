use super::fake_cli::{FAKE_MESSAGE_ID, FakeCli, fake_session};
use super::*;
use crate::bridge::{BridgeMessagePayload, BridgeSessionConfig, BridgeSessionMode, ConnectionMode};
use serde_json::json;
use std::time::Duration;

fn launcher_config() -> BridgeSessionConfig {
    BridgeSessionConfig {
        model: Some("gpt-5.4".to_string()),
        working_directory: Some("C:\\repo".to_string()),
        system_message: Some("Be brief.".to_string()),
        reasoning_effort: Some("medium".to_string()),
        agent: Some("reviewer".to_string()),
    }
}

#[tokio::test]
async fn track_created_session_records_runtime_handle_only() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    mgr.connection_mode = Some(ConnectionMode::Stdio);
    let (session, _fake) = fake_session("launcher-session").await;

    let info = mgr.track_created_session(session, launcher_config());

    assert_eq!(info.session_id, "launcher-session");
    assert_eq!(mgr.sessions.len(), 1);
    assert_eq!(info.working_directory.as_deref(), Some("C:\\repo"));
    assert_eq!(info.model.as_deref(), Some("gpt-5.4"));
}

#[tokio::test]
async fn create_launcher_session_sends_config_and_permission_policy() {
    for auto_approve in [false, true] {
        let (mut mgr, _rx, _status_rx) = BridgeManager::new();
        let (client, fake) = FakeCli::start();
        mgr.client = Some(client);

        let info = mgr
            .create_launcher_session(launcher_config(), auto_approve)
            .await
            .expect("create against fake peer");

        let params = fake
            .last_params("session.create")
            .expect("session.create sent");
        assert_eq!(params["model"], "gpt-5.4");
        assert_eq!(params["workingDirectory"], "C:\\repo");
        assert_eq!(params["reasoningEffort"], "medium");
        assert_eq!(params["agent"], "reviewer");
        assert_eq!(params["clientName"], "tracepilot");
        assert_eq!(params["systemMessage"]["mode"], "append");
        assert_eq!(params["systemMessage"]["content"], "Be brief.");
        // Without Auto-approve no handler is installed, so the runtime denies
        // tool permissions instead of routing them to TracePilot (F14).
        assert_eq!(
            params["requestPermission"], auto_approve,
            "auto_approve={auto_approve}"
        );
        assert!(mgr.sessions.contains_key(&info.session_id));
    }
}

#[tokio::test]
async fn resume_session_joins_as_observer_and_forwards_events() {
    let (mut mgr, mut events_rx, _status_rx) = BridgeManager::new();
    let (client, fake) = FakeCli::start();
    mgr.client = Some(client);

    let info = mgr
        .resume_session("live-session", Some("C:\\repo"), None)
        .await
        .expect("resume against fake peer");
    assert_eq!(info.session_id, "live-session");
    assert!(info.is_active);

    let params = fake
        .last_params("session.resume")
        .expect("session.resume sent");
    assert_eq!(params["sessionId"], "live-session");
    assert_eq!(params["clientName"], "tracepilot");
    assert_eq!(params["workingDirectory"], "C:\\repo");
    // Observer semantics (F3): prompts stay with the terminal that owns it.
    for flag in [
        "requestPermission",
        "requestUserInput",
        "requestElicitation",
        "requestExitPlanMode",
    ] {
        assert_eq!(params[flag], false, "{flag} must be false for an observer");
    }
    // The owning client already chose streaming (F5).
    assert!(
        params.get("streaming").is_none(),
        "streaming must be left unset"
    );
    assert!(
        !fake.methods().iter().any(|m| m == "session.setForeground"),
        "stdio mode must not touch the foreground session"
    );

    fake.push_event(
        "live-session",
        "tool.execution_partial_result",
        json!({ "toolCallId": "call-1", "partialOutput": "tick 1\n" }),
    );
    let event = tokio::time::timeout(Duration::from_secs(2), events_rx.recv())
        .await
        .expect("event forwarded within 2s")
        .expect("bridge channel open");

    assert_eq!(event.session_id, "live-session");
    assert_eq!(event.event_type, "tool.execution_partial_result");
    assert!(event.ephemeral);
    // Official SDK payloads are already flat JSON — no unwrapping needed.
    assert_eq!(event.data["partialOutput"], "tick 1\n");
    assert_eq!(mgr.metrics_snapshot().events_forwarded, 1);
    assert!(mgr.get_session_state("live-session").is_some());
}

#[tokio::test]
async fn resume_session_in_tcp_mode_sets_foreground() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let (client, fake) = FakeCli::start();
    mgr.client = Some(client);
    mgr.connection_mode = Some(ConnectionMode::Tcp);

    mgr.resume_session("tui-session", None, None)
        .await
        .expect("resume against fake peer");

    let params = fake
        .last_params("session.setForeground")
        .expect("setForeground sent in TCP mode");
    assert_eq!(params["sessionId"], "tui-session");
}

#[tokio::test]
async fn send_message_returns_message_id_and_maps_delivery_mode() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let (session, fake) = fake_session("launcher-session").await;
    mgr.sessions.insert("launcher-session".to_string(), session);

    for (mode, expected) in [
        (None, None),
        (Some("immediate"), Some("immediate")),
        (Some("enqueue"), Some("enqueue")),
        (Some("autopilot"), None),
    ] {
        let message_id = mgr
            .send_message(
                "launcher-session",
                BridgeMessagePayload {
                    prompt: "Run the launch prompt".to_string(),
                    mode: mode.map(String::from),
                },
            )
            .await
            .unwrap();
        assert_eq!(message_id, FAKE_MESSAGE_ID);

        let params = fake.last_params("session.send").expect("session.send sent");
        assert_eq!(params["sessionId"], "launcher-session");
        assert_eq!(params["prompt"], "Run the launch prompt");
        assert_eq!(
            params.get("mode").and_then(|m| m.as_str()),
            expected,
            "{mode:?}"
        );
    }
}

#[tokio::test]
async fn set_session_mode_uses_mode_set_rpc() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let (session, fake) = fake_session("mode-session").await;
    mgr.sessions.insert("mode-session".to_string(), session);

    mgr.set_session_mode("mode-session", BridgeSessionMode::Plan)
        .await
        .expect("mode set against fake peer");

    let params = fake.last_params("session.mode.set").expect("mode.set sent");
    assert_eq!(params["sessionId"], "mode-session");
    assert_eq!(params["mode"], "plan");
}

#[tokio::test]
async fn set_session_model_uses_camel_case_switch_to_in_every_mode() {
    for mode in [ConnectionMode::Stdio, ConnectionMode::Tcp] {
        let (mut mgr, _rx, _status_rx) = BridgeManager::new();
        mgr.connection_mode = Some(mode);
        mgr.cli_url = (mode == ConnectionMode::Tcp).then(|| "127.0.0.1:1".to_string());
        let (session, fake) = fake_session("model-session").await;
        mgr.sessions.insert("model-session".to_string(), session);

        mgr.set_session_model("model-session", "gpt-5.4", Some("high".to_string()))
            .await
            .expect("model switch against fake peer");

        let params = fake
            .last_params("session.model.switchTo")
            .expect("session.model.switchTo sent");
        assert_eq!(params["sessionId"], "model-session");
        assert_eq!(params["modelId"], "gpt-5.4");
        assert_eq!(params["reasoningEffort"], "high");
    }
}
