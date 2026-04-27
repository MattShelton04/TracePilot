use super::*;
use crate::bridge::{BridgeConnectConfig, BridgeConnectionState, BridgeError, ConnectionMode};

fn stub_session(id: &str) -> std::sync::Arc<copilot_sdk::Session> {
    std::sync::Arc::new(copilot_sdk::Session::new(
        id.to_string(),
        None,
        |_method, _params| Box::pin(async { Ok(serde_json::Value::Null) }),
    ))
}

#[tokio::test]
async fn connect_is_idempotent_for_same_config_and_preserves_sessions() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    mgr.set_preference_reader(std::sync::Arc::new(|| false));
    let sid = "sess-connected".to_string();
    mgr.state = BridgeConnectionState::Connected;
    mgr.connection_mode = Some(ConnectionMode::Tcp);
    mgr.cli_url = Some("127.0.0.1:60123".to_string());
    mgr.connection_cwd = Some("C:\\work".to_string());
    mgr.sessions.insert(sid.clone(), stub_session(&sid));

    mgr.connect(BridgeConnectConfig {
        cli_url: Some("127.0.0.1:60123".to_string()),
        cwd: Some("C:\\work".to_string()),
        log_level: Some("debug".to_string()),
        github_token: Some("not-stored-or-compared".to_string()),
    })
    .await
    .expect("matching reconnect should be a no-op");

    assert_eq!(mgr.state, BridgeConnectionState::Connected);
    assert_eq!(mgr.sessions.len(), 1);
    assert!(mgr.sessions.contains_key(&sid));
}

#[tokio::test]
async fn connect_rejects_different_config_while_connected() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-connected".to_string();
    mgr.state = BridgeConnectionState::Connected;
    mgr.connection_mode = Some(ConnectionMode::Tcp);
    mgr.cli_url = Some("127.0.0.1:60123".to_string());
    mgr.connection_cwd = Some("C:\\work".to_string());
    mgr.sessions.insert(sid.clone(), stub_session(&sid));

    let err = mgr
        .connect(BridgeConnectConfig {
            cli_url: Some("127.0.0.1:60124".to_string()),
            cwd: Some("C:\\work".to_string()),
            log_level: None,
            github_token: None,
        })
        .await
        .expect_err("different connected config must be explicit");

    assert!(matches!(err, BridgeError::AlreadyConnected));
    assert_eq!(mgr.sessions.len(), 1);
    assert!(mgr.sessions.contains_key(&sid));
}
